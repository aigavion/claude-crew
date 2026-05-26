// Stop — when this instance is about to go idle, briefly wait for peer messages and,
// if any arrived, block the stop so the model surfaces and acts on them. This is the
// "hear messages in the background, no polling" mechanism. It is loop-guarded by the
// broker's per-peer block budget so an idle instance always terminates.

import { readInput, emit } from '../lib/hookio.js';
import { resolveIdentity } from '../lib/identity.js';
import { CrewClient } from '../lib/client.js';
import { localChangedFiles } from '../lib/collision.js';

const input = await readInput();
const cwd = input.cwd || process.cwd();

try {
  const id = resolveIdentity(cwd, input.session_id);
  const client = new CrewClient(id);

  // Cheap presence ping that also tells us roster size + block budget.
  const hb = await client.heartbeat({ changedFiles: localChangedFiles(cwd) });
  const others = (hb.roster || []).filter((p) => p.id !== id.peerId);
  const maxBlocks = id.cfg.maxStopBlocks ?? 3;

  // Solo, or budget spent → let it stop immediately (no latency, no loops).
  if (!others.length || (hb.blockCount || 0) >= maxBlocks) {
    emit({});
  }

  // Returns immediately if messages are already queued; otherwise waits stopWaitMs.
  const r = await client.poll(id.cfg.stopWaitMs ?? 1500, maxBlocks);
  const msgs = r.messages || [];
  if (msgs.length) {
    const reason =
      'A crew peer messaged you. Handle this before finishing:\n' +
      msgs.map((m) => `• ${m.fromName}${m.to ? ' (DM to you)' : ''}: ${m.text}`).join('\n') +
      '\nRespond with crew_say if a reply is warranted, then continue.';
    emit({ decision: 'block', reason });
  } else {
    emit({});
  }
} catch {
  emit({});
}
