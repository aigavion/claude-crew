// identity.js — one place to answer "who am I" so the hooks and the MCP server of
// the same Claude Code instance agree. Identity is keyed by the working directory,
// which is why running each instance in its own git worktree (distinct cwd) is the
// supported multi-instance mode: same folder => same peer id.

import path from 'node:path';
import fs from 'node:fs';
import { getRepoInfo, getStoreDir, peerIdForCwd, sha1 } from './repo.js';
import { loadConfig } from './config.js';

// Resolve this instance's peer id. Priority:
//   1. CREW_INSTANCE — an explicit unique id (lets a launcher run many peers anywhere).
//   2. CREW_NAME — name-based, so two sessions in the SAME folder are distinct peers
//      (this is what makes `crew Bob` / `CREW_NAME=Bob claude` work without a worktree).
//   3. working directory — the default; one peer per folder (use a worktree per instance).
// All of CREW_INSTANCE/CREW_NAME are inherited by this instance's hooks AND its MCP
// server (both are children of the claude process the user launched), so they agree.
export function resolvePeerId(cwd = process.cwd()) {
  if (process.env.CREW_INSTANCE) return sha1('inst:' + process.env.CREW_INSTANCE).slice(0, 12);
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

export function resolveIdentity(cwd = process.cwd()) {
  const cfg = loadConfig(cwd);
  const info = getRepoInfo(cwd);
  const storeDir = getStoreDir(cwd, cfg.peerScope);
  const peerId = resolvePeerId(cwd);
  const branch = info ? info.branch : 'unknown';
  const name = cfg.displayName || readName(storeDir, peerId) || path.basename(cwd) || peerId;
  return { cfg, info, storeDir, peerId, name, branch, cwd };
}
