// SessionEnd — deregister this instance so peers' rosters update promptly, and drop
// its per-session name. Worktree cleanup stays with the interactive /crew:leave command.

import { readInput, emit } from '../lib/hookio.js';
import { resolveIdentity, clearName } from '../lib/identity.js';
import { CrewClient } from '../lib/client.js';

const input = await readInput();
const cwd = input.cwd || process.cwd();

try {
  const id = resolveIdentity(cwd, input.session_id);
  const client = new CrewClient(id);
  await client.deregister();
  clearName(id.storeDir, id.peerId);
} catch {
  /* ignore */
}
emit({});
