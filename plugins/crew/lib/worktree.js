// worktree.js — create/remove "session branch" git worktrees, cross-platform.
//
// Each crew member ideally works in their own worktree (a distinct working dir on
// its own branch) so instances never clobber each other's files on disk; collisions
// become a git-merge concern, which is where the commit guard helps. node_modules
// are linked from the main checkout (junction on Windows, symlink on POSIX) so a
// fresh worktree doesn't need a full reinstall.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gitBin } from './repo.js';

function gitRun(args, cwd) {
  // Throws on failure so callers can report. Uses crew's git resolver (PATH or standard
  // install locations) so worktree commands work even when git isn't on PATH.
  return execFileSync(gitBin(), args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Find node_modules directories in the main checkout (shallow, depth-limited). */
export function findNodeModules(root, maxDepth = 3) {
  const found = [];
  const skip = new Set(['.git', '.crew-worktrees', '.next', 'dist', 'build', 'coverage']);
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules') {
        found.push(path.relative(root, path.join(dir, e.name)));
        continue; // don't descend into node_modules
      }
      if (skip.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  }
  walk(root, 0);
  return found;
}

/** Link each main-checkout node_modules into the worktree at the same relative path. */
export function linkNodeModules(root, worktreePath, strategy = 'link') {
  if (strategy === 'skip') return { linked: [], strategy };
  const linked = [];
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  for (const rel of findNodeModules(root)) {
    const target = path.join(root, rel);
    const dest = path.join(worktreePath, rel);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) continue;
      if (strategy === 'install') continue; // caller runs npm install instead
      fs.symlinkSync(target, dest, linkType);
      linked.push(rel);
    } catch {
      /* best-effort; a missing link just means that app needs its own install */
    }
  }
  return { linked, strategy };
}

/**
 * Create a session worktree + branch.
 * @returns {{worktreePath:string, branch:string, linked:string[]}}
 */
export function createWorktree(repoRoot, name, { baseDir = '.crew-worktrees', nodeModulesStrategy = 'link' } = {}) {
  const safe = String(name).replace(/[^A-Za-z0-9._-]/g, '-');
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
  const branch = `crew/${safe}-${stamp}`;
  const absBase = path.isAbsolute(baseDir) ? baseDir : path.join(repoRoot, baseDir);
  fs.mkdirSync(absBase, { recursive: true });
  const worktreePath = path.join(absBase, safe);

  gitRun(['worktree', 'add', '-b', branch, worktreePath], repoRoot);
  const { linked } = linkNodeModules(repoRoot, worktreePath, nodeModulesStrategy);
  return { worktreePath, branch, linked };
}

/** Remove a worktree (force, since it may contain linked node_modules). */
export function removeWorktree(repoRoot, worktreePath) {
  gitRun(['worktree', 'remove', '--force', worktreePath], repoRoot);
}

/** List existing crew worktrees as [{path, branch}]. */
export function listWorktrees(repoRoot) {
  const out = gitRun(['worktree', 'list', '--porcelain'], repoRoot);
  const items = [];
  let cur = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9) };
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
    else if (line === '') {
      if (cur.path) items.push(cur);
      cur = {};
    }
  }
  if (cur.path) items.push(cur);
  return items.filter((w) => /[\\/]\.crew-worktrees[\\/]/.test(w.path) || (w.branch || '').startsWith('crew/'));
}
