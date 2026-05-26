// broker.js — the single coordination daemon for one repo/scope.
//
// Run as:  node broker.js <storeDir>
//
// One broker per repo (keyed by getStoreDir). Every Claude Code instance's hooks
// and MCP server talk to it over localhost HTTP. It holds presence, messages,
// tasks, and file-claims in memory; durable data (messages + tasks) is snapshotted
// atomically to state.json so a broker restart doesn't lose history. Presence and
// file-claims are intentionally ephemeral — peers re-register on their next hook.
//
// Zero dependencies. Single-threaded Node == every request handler is atomic, which
// is what makes task-claim race-free without locks.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const storeDir = process.argv[2];
if (!storeDir) {
  process.stderr.write('broker: missing storeDir argument\n');
  process.exit(1);
}

const BROKER_FILE = path.join(storeDir, 'broker.json');
const STATE_FILE = path.join(storeDir, 'state.json');
const LOG_FILE = path.join(storeDir, 'broker.log');

const PEER_TTL_MS = 300000; // 5 min without a heartbeat => considered gone
const REAP_INTERVAL_MS = 30000;
const EMPTY_GRACE_MS = 60000; // exit this long after the last peer leaves
const FILE_CLAIM_TTL_MS = 120000; // a file "in progress" claim is fresh for 2 min

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- state
/** @type {Map<string, any>} */
const peers = new Map(); // peerId -> presence record
let messages = []; // {id, from, fromName, to, text, ts, readBy:[]}
let tasks = []; // {id, title, status, owner, ownerName, createdBy, createdByName, ts, notes}
const fileClaims = new Map(); // file -> Map<peerId, {name, ts}>  (multiple peers may claim one file)
let seq = 0;

function nextId(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (Array.isArray(raw.messages)) messages = raw.messages;
    if (Array.isArray(raw.tasks)) tasks = raw.tasks;
    if (typeof raw.seq === 'number') seq = raw.seq;
  } catch {
    /* no prior state */
  }
}

let saveTimer = null;
function saveState() {
  // Debounce + atomic write (tmp then rename) so concurrent reads never see a torn file.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmp = `${STATE_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ messages, tasks, seq }));
      fs.renameSync(tmp, STATE_FILE);
    } catch (e) {
      log(`saveState failed: ${e.message}`);
    }
  }, 50);
}

// ---------------------------------------------------------------- helpers
function activePeers() {
  const now = Date.now();
  return [...peers.values()].filter((p) => now - p.lastSeen < PEER_TTL_MS);
}

function peerName(peerId) {
  const p = peers.get(peerId);
  return p ? p.name : peerId;
}

function isForMe(msg, peer) {
  if (!msg.to) return msg.from !== peer.id; // broadcast (don't echo your own)
  return msg.to === peer.id || (peer.name && msg.to.toLowerCase() === peer.name.toLowerCase());
}

function unreadFor(peer) {
  return messages.filter((m) => isForMe(m, peer) && !m.readBy.includes(peer.id));
}

function markRead(peer, msgs) {
  let changed = false;
  for (const m of msgs) {
    if (!m.readBy.includes(peer.id)) {
      m.readBy.push(peer.id);
      changed = true;
    }
  }
  if (changed) saveState();
}

function rosterView() {
  return activePeers().map((p) => ({
    id: p.id,
    name: p.name,
    branch: p.branch,
    cwd: p.cwd,
    currentTask: p.currentTask || null,
    changedFiles: p.changedFiles || [],
    lastSeen: p.lastSeen,
  }));
}

// ---------------------------------------------------------------- lifecycle
let shutdownTimer = null;
function scheduleShutdownIfEmpty() {
  if (activePeers().length > 0) {
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
    return;
  }
  if (shutdownTimer) return;
  shutdownTimer = setTimeout(() => {
    if (activePeers().length === 0) {
      log('no peers remaining, shutting down');
      cleanupAndExit(0);
    } else {
      shutdownTimer = null;
    }
  }, EMPTY_GRACE_MS);
}

function cleanupAndExit(code) {
  try {
    const info = JSON.parse(fs.readFileSync(BROKER_FILE, 'utf8'));
    if (info.pid === process.pid) fs.rmSync(BROKER_FILE, { force: true });
  } catch {
    /* ignore */
  }
  process.exit(code);
}

setInterval(() => {
  const now = Date.now();
  let reaped = false;
  for (const [id, p] of peers) {
    if (now - p.lastSeen >= PEER_TTL_MS) {
      peers.delete(id);
      reaped = true;
    }
  }
  for (const [file, claimants] of fileClaims) {
    for (const [pid, c] of claimants) {
      if (now - c.ts >= FILE_CLAIM_TTL_MS) claimants.delete(pid);
    }
    if (claimants.size === 0) fileClaims.delete(file);
  }
  if (reaped) scheduleShutdownIfEmpty();
}, REAP_INTERVAL_MS).unref();

// ---------------------------------------------------------------- routes
const routes = {
  '/ping': () => ({ ok: true, pid: process.pid, startedAt: START }),

  '/register': (b) => {
    const id = b.peerId || b.peer?.id;
    if (!id) return { ok: false, error: 'peerId required' };
    const existing = peers.get(id) || { joinedAt: Date.now(), blockCount: 0 };
    const p = {
      ...existing,
      id,
      name: b.name || b.peer?.name || existing.name || id,
      branch: b.branch ?? b.peer?.branch ?? existing.branch ?? 'unknown',
      cwd: b.cwd ?? b.peer?.cwd ?? existing.cwd ?? '',
      pid: b.pid ?? b.peer?.pid ?? existing.pid,
      changedFiles: b.changedFiles ?? existing.changedFiles ?? [],
      currentTask: b.currentTask ?? existing.currentTask ?? null,
      lastSeen: Date.now(),
    };
    peers.set(id, p);
    scheduleShutdownIfEmpty();
    return { ok: true, roster: rosterView(), unreadCount: unreadFor(p).length };
  },

  '/heartbeat': (b) => {
    const p = peers.get(b.peerId);
    if (!p) return { ok: false, error: 'unknown peer', needRegister: true };
    p.lastSeen = Date.now();
    if (Array.isArray(b.changedFiles)) p.changedFiles = b.changedFiles;
    if (b.currentTask !== undefined) p.currentTask = b.currentTask;
    if (b.branch) p.branch = b.branch;
    return {
      ok: true,
      roster: rosterView(),
      unreadCount: unreadFor(p).length,
      blockCount: p.blockCount || 0,
    };
  },

  '/roster': () => ({ ok: true, peers: rosterView() }),

  '/say': (b) => {
    if (!b.text) return { ok: false, error: 'text required' };
    const msg = {
      id: nextId('msg'),
      from: b.from || 'anon',
      fromName: b.fromName || peerName(b.from) || 'anon',
      to: b.to || null,
      text: String(b.text),
      ts: Date.now(),
      readBy: [],
    };
    messages.push(msg);
    if (messages.length > 1000) messages = messages.slice(-1000);
    // Sending counts as activity: reset the sender's stop-block budget.
    const sender = peers.get(b.from);
    if (sender) sender.blockCount = 0;
    saveState();
    return { ok: true, id: msg.id };
  },

  '/inbox': (b) => {
    const p = peers.get(b.peerId);
    if (!p) return { ok: false, error: 'unknown peer' };
    const msgs = unreadFor(p);
    if (b.markRead) {
      markRead(p, msgs);
      p.blockCount = 0; // reading clears the stop-block budget
    }
    return { ok: true, messages: msgs };
  },

  // Long-poll used by the Stop hook: resolve as soon as there's something to deliver,
  // otherwise wait up to timeoutMs. Honors a per-peer block budget so an idle instance
  // can never be held open forever.
  '/poll': async (b) => {
    const p = peers.get(b.peerId);
    if (!p) return { ok: false, error: 'unknown peer' };
    const maxBlocks = b.maxBlocks ?? 3;
    if ((p.blockCount || 0) >= maxBlocks) {
      return { ok: true, messages: [], throttled: true, blockCount: p.blockCount };
    }
    const deadline = Date.now() + Math.max(0, Math.min(b.timeoutMs ?? 1500, 25000));
    for (;;) {
      p.lastSeen = Date.now();
      const msgs = unreadFor(p);
      if (msgs.length > 0) {
        markRead(p, msgs);
        p.blockCount = (p.blockCount || 0) + 1;
        return { ok: true, messages: msgs, blockCount: p.blockCount };
      }
      if (Date.now() >= deadline) return { ok: true, messages: [], blockCount: p.blockCount || 0 };
      await sleep(200);
    }
  },

  '/tasks/list': () => ({ ok: true, tasks }),

  '/tasks/add': (b) => {
    if (!b.title) return { ok: false, error: 'title required' };
    const task = {
      id: nextId('task'),
      title: String(b.title),
      status: 'open', // open | claimed | done
      owner: null,
      ownerName: null,
      createdBy: b.by || null,
      createdByName: b.byName || peerName(b.by) || null,
      ts: Date.now(),
      notes: b.notes || '',
    };
    tasks.push(task);
    saveState();
    return { ok: true, task };
  },

  // Atomic claim: only succeeds if the task is still open. Single-threaded => race-free.
  '/tasks/claim': (b) => {
    const task = tasks.find((t) => t.id === b.taskId);
    if (!task) return { ok: false, error: 'no such task' };
    if (task.status !== 'open') {
      return { ok: false, reason: 'already-claimed', task };
    }
    task.status = 'claimed';
    task.owner = b.peerId;
    task.ownerName = b.name || peerName(b.peerId);
    const p = peers.get(b.peerId);
    if (p) p.currentTask = task.title;
    saveState();
    return { ok: true, task };
  },

  '/tasks/update': (b) => {
    const task = tasks.find((t) => t.id === b.taskId);
    if (!task) return { ok: false, error: 'no such task' };
    if (b.status) task.status = b.status;
    if (b.notes !== undefined) task.notes = b.notes;
    if (b.status === 'done' && task.owner) {
      const p = peers.get(task.owner);
      if (p && p.currentTask === task.title) p.currentTask = null;
    }
    saveState();
    return { ok: true, task };
  },

  '/files/declare': (b) => {
    if (!b.file) return { ok: false, error: 'file required' };
    const key = norm(b.file);
    if (b.mode === 'release') {
      const claimants = fileClaims.get(key);
      if (claimants) {
        claimants.delete(b.peerId);
        if (claimants.size === 0) fileClaims.delete(key);
      }
      return { ok: true };
    }
    const claimants = fileClaims.get(key) || new Map();
    let conflict = null;
    for (const [pid, c] of claimants) {
      if (pid !== b.peerId && Date.now() - c.ts < FILE_CLAIM_TTL_MS) {
        conflict = { name: c.name, peerId: pid };
        break;
      }
    }
    claimants.set(b.peerId, { name: b.name || peerName(b.peerId), ts: Date.now() });
    fileClaims.set(key, claimants);
    return { ok: true, conflict };
  },

  '/files/claims': () => {
    const claims = [];
    for (const [file, claimants] of fileClaims) {
      for (const [, c] of claimants) claims.push({ file, name: c.name, ts: c.ts });
    }
    return { ok: true, claims };
  },

  // Report overlaps between my files and what other active peers are touching
  // (their declared file-claims + reported working set).
  '/collisions': (b) => {
    const mine = new Set((b.files || []).map(norm));
    const byFile = new Map(); // file -> Set<name>
    const add = (file, name) => {
      const f = norm(file);
      if (!mine.has(f)) return;
      if (!byFile.has(f)) byFile.set(f, new Set());
      byFile.get(f).add(name);
    };
    for (const [file, claimants] of fileClaims) {
      for (const [pid, c] of claimants) {
        if (pid !== b.peerId && Date.now() - c.ts < FILE_CLAIM_TTL_MS) add(file, c.name);
      }
    }
    for (const p of activePeers()) {
      if (p.id === b.peerId) continue;
      for (const f of p.changedFiles || []) add(f, p.name);
    }
    const overlaps = [...byFile.entries()].map(([file, names]) => ({ file, peers: [...names] }));
    return { ok: true, overlaps };
  },

  '/deregister': (b) => {
    peers.delete(b.peerId);
    for (const [file, claimants] of fileClaims) {
      claimants.delete(b.peerId);
      if (claimants.size === 0) fileClaims.delete(file);
    }
    scheduleShutdownIfEmpty();
    return { ok: true };
  },
};

function norm(f) {
  return String(f).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------- server
const server = http.createServer((req, res) => {
  const handler = routes[req.url];
  if (req.method !== 'POST' || !handler) {
    res.writeHead(404).end('{}');
    return;
  }
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 5_000_000) req.destroy(); // guard against runaway payloads
  });
  req.on('end', async () => {
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      res.writeHead(400).end('{"ok":false,"error":"bad json"}');
      return;
    }
    try {
      const out = await handler(parsed);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      log(`handler ${req.url} error: ${e.stack || e.message}`);
      res.writeHead(500).end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
});

const START = Date.now();

// Refuse to start if a live broker already owns this store (avoids duplicates).
try {
  const info = JSON.parse(fs.readFileSync(BROKER_FILE, 'utf8'));
  const probe = http.request(
    { host: '127.0.0.1', port: info.port, path: '/ping', method: 'POST', timeout: 500 },
    (r) => {
      if (r.statusCode === 200) {
        log('another broker already live, exiting');
        process.exit(0);
      }
    }
  );
  probe.on('error', () => start());
  probe.on('timeout', () => {
    probe.destroy();
    start();
  });
  probe.end('{}');
} catch {
  start();
}

function start() {
  loadState();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const tmp = `${BROKER_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ port, pid: process.pid, startedAt: START }));
    fs.renameSync(tmp, BROKER_FILE);
    log(`broker listening on 127.0.0.1:${port} (pid ${process.pid})`);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => cleanupAndExit(0));
}
