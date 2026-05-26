// Throwaway smoke test for broker + client. Run: node test/smoke.mjs
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { CrewClient } from '../lib/client.js';

const storeDir = path.join(os.tmpdir(), 'claude-crew-test', String(Date.now()));
fs.mkdirSync(storeDir, { recursive: true });

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const A = new CrewClient({ storeDir, peerId: 'aaa', name: 'alice', branch: 'crew/alice', cwd: '/repo/a' });
const B = new CrewClient({ storeDir, peerId: 'bbb', name: 'bob', branch: 'crew/bob', cwd: '/repo/b' });

const ra = await A.register({ changedFiles: ['src/x.js'] });
check('A register ok', ra.ok);
const rb = await B.register({ changedFiles: ['src/y.js'] });
check('B register ok', rb.ok);

const roster = await A.roster();
check('roster has 2 peers', (roster.peers || []).length === 2);

await A.say('hello team');
const inboxB = await B.inbox(true);
check('B receives broadcast', (inboxB.messages || []).some((m) => m.text === 'hello team'));

const inboxA = await A.inbox(true);
check('A does not receive own broadcast', !(inboxA.messages || []).some((m) => m.text === 'hello team'));

await A.say('psst bob', 'bob');
const dmB = await B.inbox(true);
check('B receives DM by name', (dmB.messages || []).some((m) => m.text === 'psst bob'));

const t = await A.taskAdd('refactor billing');
check('task added', t.ok && t.task.id);
const claimB = await B.taskClaim(t.task.id);
check('B claims task', claimB.ok);
const claimA = await A.taskClaim(t.task.id);
check('A cannot double-claim', !claimA.ok && claimA.reason === 'already-claimed');

await A.declareFile('src/shared.js', 'editing');
const decl = await B.declareFile('src/shared.js', 'editing');
check('B sees file conflict with A', !!(decl.conflict && decl.conflict.name === 'alice'));

const col = await B.collisions(['src/shared.js', 'src/y.js']);
check('collision report flags shared.js', (col.overlaps || []).some((o) => o.file === 'src/shared.js'));

// long-poll: A polls (no msgs) while B sends mid-wait
const pollP = A.poll(2000, 3);
setTimeout(() => B.say('ping alice', 'alice'), 300);
const polled = await pollP;
check('A long-poll receives late message', (polled.messages || []).some((m) => m.text === 'ping alice'));

await A.deregister();
await B.deregister();

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
