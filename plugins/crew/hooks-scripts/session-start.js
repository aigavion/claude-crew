// SessionStart — register this instance as a peer and inject the current crew roster
// so the model knows from turn one who else is here and that the crew tools exist.

import { readInput, emit } from '../lib/hookio.js';
import { resolveIdentity } from '../lib/identity.js';
import { CrewClient } from '../lib/client.js';
import { localChangedFiles } from '../lib/collision.js';

const input = await readInput();
const cwd = input.cwd || process.cwd();

try {
  const id = resolveIdentity(cwd);
  const client = new CrewClient(id);
  const r = await client.register({ changedFiles: localChangedFiles(cwd) });
  const others = (r.roster || []).filter((p) => p.id !== id.peerId);

  let ctx = `[crew] You are crew member "${id.name}" on branch "${id.branch}".`;
  if (others.length) {
    ctx +=
      ` ${others.length} other Claude Code instance(s) active on this repo: ` +
      others.map((p) => `${p.name} (${p.branch})`).join(', ') +
      '. Before working, check crew_roster and the crew_tasks_list, claim a task so you do not duplicate a peer, and use crew_say to coordinate.';
  } else {
    ctx +=
      ' No other instances are active yet. The crew tools (crew_say, crew_tasks_add/list/claim, crew_check_collisions) coordinate with peers who join later.';
  }
  if (r.unreadCount) ctx += ` You have ${r.unreadCount} unread crew message(s) — call crew_inbox.`;

  emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } });
} catch {
  emit({});
}
