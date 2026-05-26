// SessionStart — auto-connect this instance to the crew (no command needed) and tell
// the model who else is here and how to coordinate. Also stashes the session id in
// CREW_INSTANCE via $CLAUDE_ENV_FILE so the crew CLI shares this session's identity.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInput, emit } from '../lib/hookio.js';
import { resolveIdentity } from '../lib/identity.js';
import { CrewClient } from '../lib/client.js';
import { localChangedFiles } from '../lib/collision.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');

const input = await readInput();
const cwd = input.cwd || process.cwd();
const sessionId = input.session_id || null;

// Make the CLI (and any Bash the model runs) use this same session's identity.
try {
  if (sessionId && process.env.CLAUDE_ENV_FILE) {
    fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export CREW_INSTANCE=${sessionId}\n`);
  }
} catch {
  /* non-fatal */
}

try {
  const id = resolveIdentity(cwd, sessionId);
  const client = new CrewClient(id);
  const r = await client.register({ changedFiles: localChangedFiles(cwd) });
  const others = (r.roster || []).filter((p) => p.id !== id.peerId);

  let ctx = `[crew] You are connected to the crew as "${id.name}" on branch "${id.branch}".`;
  if (others.length) {
    ctx +=
      ` ${others.length} other instance(s) here: ` +
      others.map((p) => `${p.name} (${p.branch})`).join(', ') +
      '. Coordinate so you do not duplicate or clobber their work.';
  } else {
    ctx += ' No other instances yet; others that open in this repo will appear automatically.';
  }
  ctx +=
    ` To coordinate, use the /crew:* commands, or run the crew CLI directly:` +
    ` \`node "${CLI}" say "<msg>"\` to message peers, \`node "${CLI}" tasks\` to see the shared board,` +
    ` \`node "${CLI}" task-claim <id>\` to claim work. Incoming messages are delivered to you automatically.`;
  if (r.unreadCount) ctx += ` You have ${r.unreadCount} unread message(s) (run /crew:sync).`;

  emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } });
} catch {
  emit({});
}
