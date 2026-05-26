// collision.js — figure out, from git, what this instance has changed, and whether
// any of it overlaps what peers are touching or has fallen behind upstream.

import { git, getRepoInfo } from './repo.js';

/** Files this instance has changed vs HEAD (staged + unstaged), repo-relative. */
export function localChangedFiles(cwd = process.cwd()) {
  const info = getRepoInfo(cwd);
  if (!info) return [];
  const set = new Set();
  for (const args of [
    ['diff', '--name-only', 'HEAD'],
    ['diff', '--name-only', '--cached'],
  ]) {
    const out = git(args, cwd);
    if (out) for (const line of out.split('\n')) if (line.trim()) set.add(line.trim());
  }
  // Include untracked files too — a peer may already track a file you just created.
  const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd);
  if (untracked) for (const line of untracked.split('\n')) if (line.trim()) set.add(line.trim());
  return [...set];
}

/** How many commits the current branch is behind its upstream, or null if none. */
export function behindUpstream(cwd = process.cwd()) {
  const counts = git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], cwd);
  if (!counts) return null; // no upstream configured
  const m = counts.split(/\s+/);
  const behind = parseInt(m[1], 10);
  return Number.isFinite(behind) ? behind : null;
}

/**
 * Full collision report for the commit guard.
 * @param {import('./client.js').CrewClient} client
 */
export async function detectCollisions(client, cwd = process.cwd()) {
  const files = localChangedFiles(cwd);
  let overlaps = [];
  try {
    if (files.length) {
      const r = await client.collisions(files);
      overlaps = r.overlaps || [];
    }
  } catch {
    /* broker down: degrade to no-overlap, never block the user's git */
  }
  const behind = behindUpstream(cwd);
  return { files, overlaps, behind };
}

/** Render a short human warning, or null when there's nothing to warn about. */
export function formatCollisionWarning({ overlaps, behind }) {
  const parts = [];
  if (overlaps && overlaps.length) {
    parts.push(
      'Files you changed are also being touched by peers:\n' +
        overlaps.map((o) => `  • ${o.file} — also ${o.peers.join(', ')}`).join('\n')
    );
  }
  if (behind && behind > 0) {
    parts.push(`Your branch is ${behind} commit(s) behind its upstream — pull/rebase first.`);
  }
  if (!parts.length) return null;
  return (
    '⚠ crew collision check:\n' +
    parts.join('\n') +
    '\nCoordinate with crew_say or pull/rebase before pushing to avoid clobbering peers.'
  );
}
