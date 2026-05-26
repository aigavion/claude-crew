// PreToolUse — two jobs:
//  1. On file edits: declare the file to the crew and warn if a peer is editing it too.
//  2. On `git commit/push/merge`: run the collision check and warn (or ask/block per
//     config) if your changes overlap peers' work or your branch is behind upstream.
// Always fails open: any error => allow the tool, never break the user's workflow.

import path from 'node:path';
import { readInput, emit } from '../lib/hookio.js';
import { resolveIdentity } from '../lib/identity.js';
import { CrewClient } from '../lib/client.js';
import { localChangedFiles, detectCollisions, formatCollisionWarning } from '../lib/collision.js';

const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

const input = await readInput();
const cwd = input.cwd || process.cwd();
const tool = input.tool_name;
const ti = input.tool_input || {};

try {
  const id = resolveIdentity(cwd, input.session_id);
  const client = new CrewClient(id);
  await client.heartbeat({ changedFiles: localChangedFiles(cwd) }).catch(() => {});

  const root = id.info ? id.info.repoRoot : cwd;
  const toRel = (file) => {
    try {
      const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
      return path.relative(root, abs).replace(/\\/g, '/');
    } catch {
      return String(file).replace(/\\/g, '/');
    }
  };

  if (EDIT_TOOLS.includes(tool)) {
    const file = ti.file_path || ti.notebook_path;
    if (file) {
      const rel = toRel(file);
      const r = await client.declareFile(rel, 'editing').catch(() => ({}));
      if (r && r.conflict) {
        emit({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: `[crew] Heads-up: peer "${r.conflict.name}" is also editing ${rel}. Coordinate via /crew:say or expect to merge.`,
          },
        });
      }
    }
    emit({});
  }

  if (tool === 'Bash' && /\bgit\s+(commit|push|merge)\b/.test(String(ti.command || ''))) {
    const report = await detectCollisions(client, cwd);
    const warn = formatCollisionWarning(report);
    if (warn) {
      const mode = id.cfg.collisionMode || 'warn';
      if (mode === 'block') {
        emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: warn } });
      } else if (mode === 'ask') {
        emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: warn } });
      } else {
        emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: warn } });
      }
    }
    emit({});
  }

  emit({});
} catch {
  emit({});
}
