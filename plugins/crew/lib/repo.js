// repo.js — derive a stable, repo-scoped coordination key + store path.
//
// The key insight: `git rev-parse --git-common-dir` resolves to the SAME path for
// every worktree of a repository. So hashing it gives all worktrees of one repo a
// single shared coordination store — which is exactly the peer-discovery scope we
// want. State lives under the OS temp dir, never inside the (read-only) plugin cache.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Locate the git binary. Prefer PATH, but fall back to standard install locations so
// crew still works for users who have git installed but not on their PATH (a common
// Windows case: "Git for Windows" installed without the PATH option). Cached per process.
let GIT_BIN = null;
function gitCandidates() {
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const la = process.env.LOCALAPPDATA;
    return [
      'git',
      path.join(pf, 'Git', 'cmd', 'git.exe'),
      path.join(pf, 'Git', 'bin', 'git.exe'),
      path.join(pf86, 'Git', 'cmd', 'git.exe'),
      la && path.join(la, 'Programs', 'Git', 'cmd', 'git.exe'),
    ].filter(Boolean);
  }
  return ['git', '/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
}

export function gitBin() {
  if (GIT_BIN) return GIT_BIN;
  for (const candidate of gitCandidates()) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore', timeout: 4000 });
      GIT_BIN = candidate;
      return candidate;
    } catch {
      /* try next */
    }
  }
  GIT_BIN = 'git'; // last resort; callers fail-soft on error
  return GIT_BIN;
}

/** Run a git command, returning trimmed stdout or null on any failure (fail-soft). */
export function git(args, cwd = process.cwd()) {
  try {
    return execFileSync(gitBin(), args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    }).trim();
  } catch {
    return null;
  }
}

export function sha1(s) {
  return createHash('sha1').update(String(s)).digest('hex');
}

/** Basic repo facts, or null when cwd is not inside a git repo. */
export function getRepoInfo(cwd = process.cwd()) {
  const common = git(['rev-parse', '--git-common-dir'], cwd);
  if (common == null) return null;
  const gitCommonDir = path.normalize(
    path.isAbsolute(common) ? common : path.resolve(cwd, common)
  );
  const repoRoot = path.normalize(git(['rev-parse', '--show-toplevel'], cwd) || cwd);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || 'unknown';
  return { gitCommonDir, repoRoot, branch };
}

/** Coordination key for the given scope. */
export function coordKey(cwd = process.cwd(), scope = 'repo') {
  if (scope === 'machine') return 'machine';
  if (scope === 'cwd') return sha1(path.normalize(cwd).toLowerCase()).slice(0, 16);
  const info = getRepoInfo(cwd);
  const basis = info ? info.gitCommonDir.toLowerCase() : path.normalize(cwd).toLowerCase();
  return sha1(basis).slice(0, 16);
}

/** Ensure and return the shared store directory for this repo/scope. */
export function getStoreDir(cwd = process.cwd(), scope = 'repo') {
  const dir = path.join(os.tmpdir(), 'claude-crew', coordKey(cwd, scope));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Stable per-instance id. One Claude Code instance == one working directory. */
export function peerIdForCwd(cwd = process.cwd()) {
  return sha1(path.normalize(cwd).toLowerCase()).slice(0, 12);
}
