// config.js — resolve user configuration from .claude-crew.local.md frontmatter
// (in the repo root) and environment variables, over sensible defaults.

import fs from 'node:fs';
import path from 'node:path';
import { getRepoInfo } from './repo.js';

export const DEFAULTS = {
  collisionMode: 'warn', // warn | ask | block — what the commit guard does on overlap
  peerScope: 'repo', // repo | cwd | machine — who counts as a peer
  worktreeBaseDir: '.crew-worktrees', // where /crew:join puts session worktrees
  nodeModulesStrategy: 'link', // link | install | skip — how worktrees get node_modules
  displayName: '', // override the auto-derived peer name
  stopWaitMs: 1500, // how long the Stop hook waits for late-arriving messages
  peerTtlMs: 300000, // a peer is "active" if seen within this window
  maxStopBlocks: 3, // safety cap on consecutive Stop blocks before forcing stop
};

// Tiny flat-frontmatter parser (no YAML dependency): `key: value` lines only.
function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/);
    if (!mm) continue;
    let v = mm[2].replace(/^["']|["']$/g, '');
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (/^-?\d+$/.test(v)) v = parseInt(v, 10);
    out[mm[1]] = v;
  }
  return out;
}

export function loadConfig(cwd = process.cwd()) {
  const cfg = { ...DEFAULTS };
  const info = getRepoInfo(cwd);
  const root = info ? info.repoRoot : cwd;

  try {
    const file = path.join(root, '.claude-crew.local.md');
    if (fs.existsSync(file)) Object.assign(cfg, parseFrontmatter(fs.readFileSync(file, 'utf8')));
  } catch {
    /* fail-soft: defaults are fine */
  }

  const e = process.env;
  if (e.CREW_COLLISION_MODE) cfg.collisionMode = e.CREW_COLLISION_MODE;
  if (e.CREW_PEER_SCOPE) cfg.peerScope = e.CREW_PEER_SCOPE;
  if (e.CREW_NAME) cfg.displayName = e.CREW_NAME;
  if (e.CREW_WORKTREE_DIR) cfg.worktreeBaseDir = e.CREW_WORKTREE_DIR;
  if (e.CREW_NODE_MODULES) cfg.nodeModulesStrategy = e.CREW_NODE_MODULES;
  if (e.CREW_STOP_WAIT_MS) cfg.stopWaitMs = parseInt(e.CREW_STOP_WAIT_MS, 10) || cfg.stopWaitMs;

  return cfg;
}
