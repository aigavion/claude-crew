// identity.js — one place to answer "who am I" so the hooks and the MCP server of
// the same Claude Code instance agree. Identity is keyed by the working directory,
// which is why running each instance in its own git worktree (distinct cwd) is the
// supported multi-instance mode: same folder => same peer id.

import path from 'node:path';
import fs from 'node:fs';
import { getRepoInfo, getStoreDir, peerIdForCwd } from './repo.js';
import { loadConfig } from './config.js';

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
  const peerId = peerIdForCwd(cwd);
  const branch = info ? info.branch : 'unknown';
  const name = cfg.displayName || readName(storeDir, peerId) || path.basename(cwd) || peerId;
  return { cfg, info, storeDir, peerId, name, branch, cwd };
}
