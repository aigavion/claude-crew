// SessionEnd — deregister this instance so peers' rosters update promptly. Worktree
// cleanup is deliberately left to the interactive /crew:leave command (SessionEnd
// cannot prompt and must not be destructive).

import { readInput, emit } from '../lib/hookio.js';
import { resolveIdentity } from '../lib/identity.js';
import { CrewClient } from '../lib/client.js';

const input = await readInput();
const cwd = input.cwd || process.cwd();

try {
  const id = resolveIdentity(cwd);
  const client = new CrewClient(id);
  await client.deregister();
} catch {
  /* ignore */
}
emit({});
