// server.js — a zero-dependency MCP stdio server exposing the crew coordination
// tools. Newline-delimited JSON-RPC 2.0 over stdin/stdout (per the MCP spec);
// stdout carries ONLY protocol messages, logs go to stderr.
//
// These tools are what let one Claude instance deliberately act on the crew:
// message a peer, claim a task, declare files, check for collisions. Incoming
// messages are delivered automatically by the hooks (see hooks-scripts/).

import { resolveIdentity } from '../lib/identity.js';
import { CrewClient } from '../lib/client.js';
import { git, getRepoInfo } from '../lib/repo.js';

const SERVER_INFO = { name: 'crew', version: '0.1.0' };
const DEFAULT_PROTOCOL = '2025-06-18';

const id = resolveIdentity(process.cwd());
const client = new CrewClient(id);

function logErr(msg) {
  process.stderr.write(`[crew-mcp] ${msg}\n`);
}

// Keep this instance present while the MCP server is alive.
client.register().catch((e) => logErr(`register failed: ${e.message}`));
const hb = setInterval(() => {
  client.heartbeat({ changedFiles: changedFiles() }).catch(() => {});
}, 60000);
hb.unref();

function changedFiles() {
  const info = getRepoInfo(id.cwd);
  if (!info) return [];
  const out = git(['diff', '--name-only', 'HEAD'], id.cwd);
  const staged = git(['diff', '--name-only', '--cached'], id.cwd);
  const set = new Set();
  for (const block of [out, staged]) {
    if (block) for (const line of block.split('\n')) if (line.trim()) set.add(line.trim());
  }
  return [...set];
}

// ----------------------------------------------------------------- tools
const TOOLS = [
  {
    name: 'crew_roster',
    description:
      'List the other active Claude Code instances ("peers") working on this repo right now, including each one\'s branch, working directory, current task, and files they are changing. Use this to see who else is here before starting work.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'crew_say',
    description:
      'Send a message to your peers (other Claude Code instances on this repo). Omit "to" to broadcast to everyone, or set it to a peer name to direct-message. Peers receive it automatically at their next checkpoint. Use this to coordinate: announce what you are about to work on, ask a peer to hold off on a file, or answer a question.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message text.' },
        to: { type: 'string', description: 'Optional peer name to DM. Omit to broadcast.' },
      },
      required: ['message'],
    },
  },
  {
    name: 'crew_inbox',
    description: 'Read messages other peers have sent you and mark them read.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'crew_tasks_list',
    description: 'List the shared task board: every task with its status (open/claimed/done) and owner.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'crew_task_add',
    description: 'Add a task to the shared board so peers can see it and claim it instead of duplicating work.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title.' },
        notes: { type: 'string', description: 'Optional details.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'crew_task_claim',
    description:
      'Claim an open task by its id so peers know you own it. Fails if another peer already claimed it (claims are atomic). Call crew_tasks_list first to get ids.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'Task id from crew_tasks_list.' } },
      required: ['taskId'],
    },
  },
  {
    name: 'crew_task_update',
    description: 'Update a task: change its status (open/claimed/done) or notes.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        status: { type: 'string', enum: ['open', 'claimed', 'done'] },
        notes: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'crew_declare_files',
    description:
      'Announce the files you are about to work on so peers are warned before they edit the same ones. (Editing also declares files automatically, but use this to claim ahead of time.)',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative file paths.' },
        release: { type: 'boolean', description: 'Set true to release a previous claim on these files.' },
      },
      required: ['files'],
    },
  },
  {
    name: 'crew_check_collisions',
    description:
      'Check whether your current changes overlap with files other peers are touching. Call this before committing/pushing. With no arguments it uses your current git working set.',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Optional explicit file list; defaults to your git diff.' },
      },
    },
  },
];

// ----------------------------------------------------------------- handlers
async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'crew_roster': {
      const r = await client.roster();
      return formatRoster(r.peers || []);
    }
    case 'crew_say': {
      if (!args.message) return 'Error: message is required.';
      await client.say(args.message, args.to || null);
      return args.to ? `Sent to ${args.to}.` : 'Broadcast to all peers.';
    }
    case 'crew_inbox': {
      const r = await client.inbox(true);
      const msgs = r.messages || [];
      if (!msgs.length) return 'No new messages.';
      return msgs.map((m) => `From ${m.fromName}${m.to ? ' (DM)' : ''}: ${m.text}`).join('\n');
    }
    case 'crew_tasks_list': {
      const r = await client.tasksList();
      return formatTasks(r.tasks || []);
    }
    case 'crew_task_add': {
      if (!args.title) return 'Error: title is required.';
      const r = await client.taskAdd(args.title, args.notes || '');
      return `Added task ${r.task.id}: ${r.task.title}`;
    }
    case 'crew_task_claim': {
      const r = await client.taskClaim(args.taskId);
      if (r.ok) return `Claimed "${r.task.title}" (${r.task.id}).`;
      return `Could not claim: ${r.reason || r.error}${r.task ? ` — owned by ${r.task.ownerName}` : ''}.`;
    }
    case 'crew_task_update': {
      const r = await client.taskUpdate(args.taskId, { status: args.status, notes: args.notes });
      if (!r.ok) return `Error: ${r.error}`;
      return `Updated "${r.task.title}" → ${r.task.status}.`;
    }
    case 'crew_declare_files': {
      const files = args.files || [];
      const mode = args.release ? 'release' : 'editing';
      const conflicts = [];
      for (const f of files) {
        const r = await client.declareFile(f, mode);
        if (r.conflict) conflicts.push(`${f} (also ${r.conflict.name})`);
      }
      if (conflicts.length) return `Declared. ⚠ Conflicts: ${conflicts.join(', ')}`;
      return args.release ? 'Released.' : `Declared ${files.length} file(s).`;
    }
    case 'crew_check_collisions': {
      const files = args.files && args.files.length ? args.files : changedFiles();
      if (!files.length) return 'No local changes to check.';
      const r = await client.collisions(files);
      const overlaps = r.overlaps || [];
      if (!overlaps.length) return `No collisions across ${files.length} changed file(s). Safe to commit.`;
      return (
        '⚠ Overlapping files with peers:\n' +
        overlaps.map((o) => `  ${o.file} — also ${o.peers.join(', ')}`).join('\n') +
        '\nConsider pulling/rebasing or coordinating via crew_say before you push.'
      );
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function formatRoster(peers) {
  if (!peers.length) return 'No peers active. You are working solo right now.';
  return (
    `${peers.length} peer(s) active:\n` +
    peers
      .map(
        (p) =>
          `  • ${p.name} [${p.branch}]${p.currentTask ? ` — task: ${p.currentTask}` : ''}` +
          `${p.changedFiles?.length ? ` — editing ${p.changedFiles.length} file(s)` : ''}`
      )
      .join('\n')
  );
}

function formatTasks(tasks) {
  if (!tasks.length) return 'Task board is empty.';
  const icon = { open: '○', claimed: '◐', done: '●' };
  return tasks
    .map((t) => `  ${icon[t.status] || '?'} [${t.id}] ${t.title}${t.ownerName ? ` (${t.ownerName})` : ''}`)
    .join('\n');
}

// ----------------------------------------------------------------- JSON-RPC loop
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(reqId, result) {
  send({ jsonrpc: '2.0', id: reqId, result });
}
function replyError(reqId, code, message) {
  send({ jsonrpc: '2.0', id: reqId, error: { code, message } });
}

async function handle(msg) {
  const { id: reqId, method, params } = msg;
  // Notifications (no id) need no response.
  if (reqId === undefined || reqId === null) {
    return;
  }
  switch (method) {
    case 'initialize':
      reply(reqId, {
        protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    case 'ping':
      reply(reqId, {});
      return;
    case 'tools/list':
      reply(reqId, { tools: TOOLS });
      return;
    case 'tools/call': {
      const name = params?.name;
      try {
        const text = await callTool(name, params?.arguments);
        reply(reqId, { content: [{ type: 'text', text }] });
      } catch (e) {
        reply(reqId, { content: [{ type: 'text', text: `crew error: ${e.message}` }], isError: true });
      }
      return;
    }
    default:
      replyError(reqId, -32601, `method not found: ${method}`);
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      logErr(`bad json line: ${line.slice(0, 120)}`);
      continue;
    }
    handle(msg).catch((e) => logErr(`handle error: ${e.message}`));
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
