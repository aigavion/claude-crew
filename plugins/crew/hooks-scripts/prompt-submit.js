// UserPromptSubmit — whenever the human types, flush any queued peer messages into
// context so the model sees them alongside the new prompt (the catch-up path).

import { readInput, emit } from '../lib/hookio.js';
import { resolveIdentity } from '../lib/identity.js';
import { CrewClient } from '../lib/client.js';
import { localChangedFiles } from '../lib/collision.js';

const input = await readInput();
const cwd = input.cwd || process.cwd();

try {
  const id = resolveIdentity(cwd, input.session_id);
  const client = new CrewClient(id);
  await client.heartbeat({ changedFiles: localChangedFiles(cwd) }).catch(() => {});
  const r = await client.inbox(true);
  const msgs = r.messages || [];
  if (msgs.length) {
    const ctx =
      '[crew] New messages from your peers (delivered now):\n' +
      msgs.map((m) => `• ${m.fromName}${m.to ? ' (DM to you)' : ''}: ${m.text}`).join('\n');
    emit({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx } });
  } else {
    emit({});
  }
} catch {
  emit({});
}
