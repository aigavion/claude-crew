#!/usr/bin/env node
// cli.js — deterministic crew actions invoked by slash commands (naming, worktree
// setup/teardown, status). Messaging/tasks/collision actions go through the MCP
// tools instead; this file owns the things that touch git and the filesystem.
//
// Usage: node cli.js <name|worktree|leave|status|whoami> [args...]

import path from 'node:path';
import fs from 'node:fs';
import { resolveIdentity, writeName } from './lib/identity.js';
import { CrewClient } from './lib/client.js';
import { localChangedFiles } from './lib/collision.js';
import { createWorktree, listWorktrees } from './lib/worktree.js';

const [cmd, ...rest] = process.argv.slice(2);
const cwd = process.cwd();

function rosterLines(peers, selfId) {
  const others = (peers || []).filter((p) => p.id !== selfId);
  if (!others.length) return '  (no other instances active)';
  return others
    .map((p) => `  • ${p.name} [${p.branch}]${p.currentTask ? ` — ${p.currentTask}` : ''}`)
    .join('\n');
}

async function main() {
  const id = resolveIdentity(cwd);

  if (cmd === 'whoami') {
    console.log(`name: ${id.name}\nbranch: ${id.branch}\ncwd: ${id.cwd}\npeerId: ${id.peerId}\nstore: ${id.storeDir}`);
    return;
  }

  if (cmd === 'name') {
    const newName = rest.join(' ').trim();
    if (newName) writeName(id.storeDir, id.peerId, newName);
    const eff = newName || id.name;
    const client = new CrewClient({ ...id, name: eff });
    const r = await client.register({ changedFiles: localChangedFiles(cwd) });
    console.log(`You are crew member "${eff}" on branch "${id.branch}".`);
    console.log('Active crew:');
    console.log(rosterLines(r.roster, id.peerId));
    return;
  }

  if (cmd === 'status') {
    const client = new CrewClient(id);
    const [roster, tasks, inbox] = await Promise.all([client.roster(), client.tasksList(), client.inbox(false)]);
    console.log(`crew member "${id.name}" [${id.branch}]`);
    console.log('\nActive peers:');
    console.log(rosterLines(roster.peers, id.peerId));
    console.log('\nTask board:');
    const ts = tasks.tasks || [];
    const icon = { open: '○', claimed: '◐', done: '●' };
    console.log(ts.length ? ts.map((t) => `  ${icon[t.status] || '?'} [${t.id}] ${t.title}${t.ownerName ? ` (${t.ownerName})` : ''}`).join('\n') : '  (empty)');
    console.log(`\nUnread messages: ${(inbox.messages || []).length} (use crew_inbox to read)`);
    return;
  }

  if (cmd === 'worktree') {
    const name = rest.join(' ').trim();
    if (!name) return fail('usage: worktree <name>');
    if (!id.info) return fail('not inside a git repository');
    const { worktreePath, branch, linked } = createWorktree(id.info.repoRoot, name, {
      baseDir: id.cfg.worktreeBaseDir,
      nodeModulesStrategy: id.cfg.nodeModulesStrategy,
    });
    ensureGitignore(id.info.repoRoot, id.cfg.worktreeBaseDir);
    console.log(`Created worktree for "${name}":`);
    console.log(`  path:   ${worktreePath}`);
    console.log(`  branch: ${branch}`);
    console.log(`  node_modules linked: ${linked.length} location(s)`);
    console.log('\nOpen a new Claude Code instance there to start working as a peer:');
    console.log(`  cd "${worktreePath}"`);
    console.log('  claude');
    console.log(`Then run /crew:join ${name} inside it.`);
    return;
  }

  if (cmd === 'leave') {
    const client = new CrewClient(id);
    await client.deregister().catch(() => {});
    console.log(`"${id.name}" left the crew.`);
    const inWorktree = /[\\/]\.crew-worktrees[\\/]/.test(cwd);
    if (inWorktree) {
      console.log('\nThis session is in a crew worktree. To remove it after you close Claude here, from the main checkout run:');
      console.log(`  git worktree remove --force "${cwd}"`);
    } else if (id.info) {
      const wts = listWorktrees(id.info.repoRoot);
      if (wts.length) {
        console.log('\nExisting crew worktrees you can remove when done:');
        for (const w of wts) console.log(`  git worktree remove --force "${w.path}"   (${w.branch})`);
      }
    }
    return;
  }

  fail(`unknown command: ${cmd || '(none)'} — use name|worktree|leave|status|whoami`);
}

function ensureGitignore(root, dir) {
  try {
    const gi = path.join(root, '.gitignore');
    const entry = dir.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    let text = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
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
