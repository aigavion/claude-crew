// Drives mcp/server.js like a real MCP client would. Run: node test/mcp-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const server = spawn(process.execPath, [path.join(dir, '..', 'mcp', 'server.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const responses = [];
server.stdout.on('data', (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) responses.push(JSON.parse(line));
  }
});

const send = (o) => server.stdin.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'crew_roster', arguments: {} } });
send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'crew_task_add', arguments: { title: 'demo task' } } });

await sleep(1500);
server.kill();

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

const init = responses.find((r) => r.id === 1);
const list = responses.find((r) => r.id === 2);
const roster = responses.find((r) => r.id === 3);
const add = responses.find((r) => r.id === 4);

check('initialize returns serverInfo.name=crew', init?.result?.serverInfo?.name === 'crew');
check('initialize echoes protocolVersion', init?.result?.protocolVersion === '2025-06-18');
check('tools/list returns tools', (list?.result?.tools || []).length >= 8);
check('crew_roster returns text content', roster?.result?.content?.[0]?.type === 'text');
check('crew_task_add returns confirmation', /Added task/.test(add?.result?.content?.[0]?.text || ''));

console.log(failures === 0 ? '\nMCP ALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
