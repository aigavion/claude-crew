// identity.js — answer "who am I" for this Claude Code instance.
//
// Identity is per-SESSION: every hook receives a `session_id` that is unique to its
// terminal, even when two instances run in the same folder. That's what lets you open
// `claude` in three terminals in one repo and have them auto-discover each other as
// three distinct peers — no names, worktrees, or launch flags required.
//
// The CLI (used by slash commands) doesn't get session_id on stdin, so the SessionStart
// hook stashes it in CREW_INSTANCE via $CLAUDE_ENV_FILE; the CLI reads that back. Both
// paths hash the same session id to the same peer id, so hooks and commands agree.

import path from 'node:path';
import fs from 'node:fs';
import { getRepoInfo, getStoreDir, peerIdForCwd, sha1 } from './repo.js';
import { loadConfig } from './config.js';

// Peer id priority:
//   1. explicit session id (hooks) or CREW_INSTANCE env (CLI) — unique per terminal
//   2. CREW_NAME — name-based, for the launch-time `CREW_NAME=Bob claude` style
//   3. working directory — last-resort fallback (one peer per folder)
export function resolvePeerId(cwd = process.cwd(), sessionId = null) {
  const inst = sessionId || process.env.CREW_INSTANCE;
  if (inst) return sha1('inst:' + inst).slice(0, 12);
  if (process.env.CREW_NAME) return sha1('name:' + process.env.CREW_NAME.trim().toLowerCase()).slice(0, 12);
  return peerIdForCwd(cwd);
}

function nameFile(storeDir, peerId) {
  return path.join(storeDir, 'names', peerId);
}

export function readName(storeDir, peerId) {
  try {
    return fs.readFileSync(nameFile(storeDir, peerId), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function writeName(storeDir, peerId, name) {
  try {
    fs.mkdirSync(path.join(storeDir, 'names'), { recursive: true });
    fs.writeFileSync(nameFile(storeDir, peerId), String(name).trim());
  } catch {
    /* fail-soft */
  }
}

export function clearName(storeDir, peerId) {
  try {
    fs.rmSync(nameFile(storeDir, peerId), { force: true });
  } catch {
    /* ignore */
  }
}

export function resolveIdentity(cwd = process.cwd(), sessionId = null) {
  const cfg = loadConfig(cwd);
  const info = getRepoInfo(cwd);
  const storeDir = getStoreDir(cwd, cfg.peerScope);
  const peerId = resolvePeerId(cwd, sessionId);
  const branch = info ? info.branch : 'unknown';
  // A distinct default name per peer so same-folder instances don't all look alike;
  // overridden by config, env, or a name set via /crew <name>.
  const fallback = `${path.basename(cwd) || 'peer'}-${peerId.slice(0, 4)}`;
  const name = cfg.displayName || readName(storeDir, peerId) || fallback;
  return { cfg, info, storeDir, peerId, name, branch, cwd };
}
