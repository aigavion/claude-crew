// client.js — talk to the repo's broker; spawn it (detached) if none is running.
//
// Both the short-lived hook processes and the long-lived MCP server use this. The
// broker is spawned detached + unref'd so it outlives whichever process started it.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROKER_SCRIPT = path.join(__dirname, 'broker.js');

function brokerFile(storeDir) {
  return path.join(storeDir, 'broker.json');
}

function post(port, urlPath, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data || '{}'));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('broker request timeout'));
    });
    req.end(payload);
  });
}

function readBroker(storeDir) {
  try {
    return JSON.parse(fs.readFileSync(brokerFile(storeDir), 'utf8'));
  } catch {
    return null;
  }
}

async function ping(port) {
  try {
    const r = await post(port, '/ping', {}, 600);
    return !!r.ok;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function spawnBroker(storeDir) {
  const lock = path.join(storeDir, 'spawn.lock');
  let haveLock = false;
  try {
    // Clear a stale lock (a previous spawn that crashed).
    try {
      const st = fs.statSync(lock);
      if (Date.now() - st.mtimeMs > 10000) fs.rmSync(lock, { force: true });
    } catch {
      /* no lock */
    }
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      haveLock = true;
    } catch {
      haveLock = false; // someone else is spawning; we'll just wait below
    }

    if (haveLock) {
      const child = spawn(process.execPath, [BROKER_SCRIPT, storeDir], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    }

    // Wait for the broker to come up (whoever spawned it).
    for (let i = 0; i < 60; i++) {
      const info = readBroker(storeDir);
      if (info && (await ping(info.port))) return info;
      await sleep(100);
    }
    return null;
  } finally {
    if (haveLock) fs.rmSync(lock, { force: true });
  }
}

async function resolve(storeDir) {
  const info = readBroker(storeDir);
  if (info && (await ping(info.port))) return info;
  return spawnBroker(storeDir);
}

export class CrewClient {
  /** @param {{storeDir:string, peerId?:string, name?:string, branch?:string, cwd?:string}} opts */
  constructor(opts) {
    this.storeDir = opts.storeDir;
    this.peerId = opts.peerId;
    this.name = opts.name;
    this.branch = opts.branch;
    this.cwd = opts.cwd;
    this._port = null;
  }

  async _call(urlPath, body, timeoutMs) {
    if (this._port == null) {
      const info = await resolve(this.storeDir);
      if (!info) throw new Error('crew broker unavailable');
      this._port = info.port;
    }
    try {
      return await post(this._port, urlPath, body, timeoutMs);
    } catch (e) {
      // Broker may have died/restarted on a new port — re-resolve once.
      this._port = null;
      const info = await resolve(this.storeDir);
      if (!info) throw e;
      this._port = info.port;
      return post(this._port, urlPath, body, timeoutMs);
    }
  }

  register(extra = {}) {
    return this._call('/register', {
      peerId: this.peerId,
      name: this.name,
      branch: this.branch,
      cwd: this.cwd,
      pid: process.pid,
      ...extra,
    });
  }
  heartbeat(extra = {}) {
    return this._call('/heartbeat', { peerId: this.peerId, branch: this.branch, ...extra });
  }
  roster() {
    return this._call('/roster', {});
  }
  say(text, to = null) {
    return this._call('/say', { from: this.peerId, fromName: this.name, to, text });
  }
  inbox(markRead = false) {
    return this._call('/inbox', { peerId: this.peerId, markRead });
  }
  poll(timeoutMs, maxBlocks) {
    return this._call('/poll', { peerId: this.peerId, name: this.name, timeoutMs, maxBlocks }, timeoutMs + 5000);
  }
  tasksList() {
    return this._call('/tasks/list', {});
  }
  taskAdd(title, notes = '') {
    return this._call('/tasks/add', { title, notes, by: this.peerId, byName: this.name });
  }
  taskClaim(taskId) {
    return this._call('/tasks/claim', { taskId, peerId: this.peerId, name: this.name });
  }
  taskUpdate(taskId, fields) {
    return this._call('/tasks/update', { taskId, ...fields });
  }
  declareFile(file, mode = 'editing') {
    return this._call('/files/declare', { peerId: this.peerId, name: this.name, file, mode });
  }
  fileClaims() {
    return this._call('/files/claims', {});
  }
  collisions(files) {
    return this._call('/collisions', { peerId: this.peerId, files });
  }
  deregister() {
    return this._call('/deregister', { peerId: this.peerId });
  }
}
