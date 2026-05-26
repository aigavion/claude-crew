#!/usr/bin/env node
// cli.js — the engine behind every crew slash command. Hooks handle automatic
// presence + message delivery; this handles the deliberate actions (connect, message,
// tasks, worktrees, collision check). Identity comes from CREW_INSTANCE (set by the
// SessionStart hook via $CLAUDE_ENV_FILE), so a command agrees with this session's hooks.
//
// Usage: node cli.js <command> [args...]
//   status | whoami | name <name> | say <text...> | dm <name> <text...> | inbox
//   tasks | task-add <title...> | task-claim <id> | task-done <id>
//   check | worktree <name> | leave

import path from 'node:path';
import fs from 'node:fs';
import { resolveIdentity, writeName, clearName } from './lib/identity.js';
import { CrewClient } from './lib/client.js';
import { localChangedFiles } from './lib/collision.js';
import { createWorktree, listWorktrees } from './lib/worktree.js';

const [cmd, ...rest] = process.argv.slice(2);
const cwd = process.cwd();
const argstr = rest.join(' ').trim();

function rosterLines(peers, selfId) {
  const others = (peers || []).filter((p) => p.id !== selfId);
  if (!others.length) return '  (no other instances connected)';
  return others
    .map((p) => `  • ${p.name} [${p.branch}]${p.currentTask ? ` — ${p.currentTask}` : ''}`)
    .join('\n');
}

const TASK_ICON = { open: '○', claimed: '◐', done: '●' };
function taskLines(tasks) {
  if (!tasks || !tasks.length) return '  (empty)';
  return tasks
    .map((t) => `  ${TASK_ICON[t.status] || '?'} [${t.id}] ${t.title}${t.ownerName ? ` (${t.ownerName})` : ''}`)
    .join('\n');
}

async function main() {
  const id = resolveIdentity(cwd);
  // Most commands want presence guaranteed; register up front (idempotent upsert).
  const ensure = (name = id.name) => {
    const c = new CrewClient({ ...id, name });
    return c.register({ changedFiles: localChangedFiles(cwd) }).then(() => c).catch(() => c);
  };

  switch (cmd) {
    case 'whoami':
      console.log(`name: ${id.name}\nbranch: ${id.branch}\ncwd: ${id.cwd}\npeerId: ${id.peerId}\nstore: ${id.storeDir}`);
      return;

    case 'name': {
      const newName = argstr;
      if (newName) writeName(id.storeDir, id.peerId, newName);
      const eff = newName || id.name;
      const client = await ensure(eff);
      const r = await client.roster().catch(() => ({ peers: [] }));
      console.log(`Connected as "${eff}" on branch "${id.branch}".`);
      console.log('Crew online:');
      console.log(rosterLines(r.peers, id.peerId));
      return;
    }

    case 'status': {
      const client = await ensure();
      const [roster, tasks, inbox] = await Promise.all([
        client.roster().catch(() => ({ peers: [] })),
        client.tasksList().catch(() => ({ tasks: [] })),
        client.inbox(false).catch(() => ({ messages: [] })),
      ]);
      console.log(`You are "${id.name}" [${id.branch}]`);
      console.log('\nCrew online:');
      console.log(rosterLines(roster.peers, id.peerId));
      console.log('\nTask board:');
      console.log(taskLines(tasks.tasks));
      console.log(`\nUnread messages: ${(inbox.messages || []).length} (run /crew:sync to read)`);
      return;
    }

    case 'say': {
      if (!argstr) return fail('usage: say <text...>');
      const client = await ensure();
      await client.say(argstr, null);
      console.log(`Broadcast to crew: ${argstr}`);
      return;
    }

    case 'dm': {
      const to = rest[0];
      const text = rest.slice(1).join(' ').trim();
      if (!to || !text) return fail('usage: dm <name> <text...>');
      const client = await ensure();
      await client.say(text, to);
      console.log(`Sent to ${to}: ${text}`);
      return;
    }

    case 'inbox': {
      const client = await ensure();
      const r = await client.inbox(true).catch(() => ({ messages: [] }));
      const msgs = r.messages || [];
      if (!msgs.length) console.log('No new messages.');
      else console.log(msgs.map((m) => `${m.fromName}${m.to ? ' (DM)' : ''}: ${m.text}`).join('\n'));
      return;
    }

    case 'tasks': {
      const client = await ensure();
      const r = await client.tasksList().catch(() => ({ tasks: [] }));
      console.log('Task board:');
      console.log(taskLines(r.tasks));
      return;
    }

    case 'task-add': {
      if (!argstr) return fail('usage: task-add <title...>');
      const client = await ensure();
      const r = await client.taskAdd(argstr);
      console.log(`Added [${r.task.id}] ${r.task.title}`);
      return;
    }

    case 'task-claim': {
      const client = await ensure();
      const r = await client.taskClaim(rest[0]);
      if (r.ok) console.log(`Claimed "${r.task.title}".`);
      else console.log(`Could not claim: ${r.reason || r.error}${r.task ? ` — owned by ${r.task.ownerName}` : ''}.`);
      return;
    }

    case 'task-done': {
      const client = await ensure();
      const r = await client.taskUpdate(rest[0], { status: 'done' });
      console.log(r.ok ? `Marked "${r.task.title}" done.` : `Error: ${r.error}`);
      return;
    }

    case 'check': {
      const client = await ensure();
      const files = localChangedFiles(cwd);
      if (!files.length) return console.log('No local changes to check.');
      const r = await client.collisions(files).catch(() => ({ overlaps: [] }));
      const overlaps = r.overlaps || [];
      if (!overlaps.length) console.log(`No collisions across ${files.length} changed file(s). Safe to commit.`);
      else {
        console.log('⚠ Overlapping files with peers:');
        for (const o of overlaps) console.log(`  ${o.file} — also ${o.peers.join(', ')}`);
        console.log('Coordinate (/crew:say) or pull/rebase before pushing.');
      }
      return;
    }

    case 'worktree': {
      if (!argstr) return fail('usage: worktree <name>');
      if (!id.info) return fail('not inside a git repository');
      const { worktreePath, branch, linked } = createWorktree(id.info.repoRoot, argstr, {
        baseDir: id.cfg.worktreeBaseDir,
        nodeModulesStrategy: id.cfg.nodeModulesStrategy,
      });
      ensureGitignore(id.info.repoRoot, id.cfg.worktreeBaseDir);
      console.log(`Created worktree for "${argstr}":`);
      console.log(`  path:   ${worktreePath}`);
      console.log(`  branch: ${branch}`);
      console.log(`  node_modules linked: ${linked.length} location(s)`);
      console.log('\nOpen a new terminal there and run claude to work as a separate peer:');
      console.log(`  cd "${worktreePath}"`);
      console.log('  claude');
      return;
    }

    case 'leave': {
      const client = await ensure();
      await client.deregister().catch(() => {});
      clearName(id.storeDir, id.peerId);
      console.log(`"${id.name}" left the crew.`);
      const inWorktree = /[\\/]\.crew-worktrees[\\/]/.test(cwd);
      if (inWorktree) {
        console.log('\nThis session is in a crew worktree. After closing Claude here, remove it from the main checkout:');
        console.log(`  git worktree remove --force "${cwd}"`);
      } else if (id.info) {
        const wts = listWorktrees(id.info.repoRoot);
        for (const w of wts) console.log(`  git worktree remove --force "${w.path}"   (${w.branch})`);
      }
      return;
    }

    default:
      fail(`unknown command: ${cmd || '(none)'}`);
  }
}

function ensureGitignore(root, dir) {
  try {
    const gi = path.join(root, '.gitignore');
    const entry = dir.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    const text = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
    if (!text.split('\n').some((l) => l.trim() === entry || l.trim() === entry.slice(0, -1))) {
      fs.appendFileSync(gi, (text && !text.endsWith('\n') ? '\n' : '') + entry + '\n');
      console.log(`(added ${entry} to .gitignore)`);
    }
  } catch {
    /* non-fatal */
  }
}

function fail(msg) {
  console.error(msg);
  process.exitCode = 1;
}

main().catch((e) => fail(e.message));
