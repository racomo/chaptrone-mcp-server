// test/mcp.server.test.mjs
// Tool-level E2E for the MCP stdio server (src/server.ts -> dist/server.js).
// Builds the TypeScript, spawns the compiled server, and drives it with a real
// JSON-RPC handshake over stdio — no network (BASE is never contacted here).
import { test, before } from 'node:test';
import assert from 'node:assert';
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'server.js');

before(() => {
  // Compile so the test runs against real emitted output (idempotent).
  execSync('npx tsc', { cwd: ROOT, stdio: 'inherit' });
  assert.ok(existsSync(DIST), 'dist/server.js must exist after build');
});

// Send a set of JSON-RPC messages, resolve once responses for every id in
// `wantIds` have been received (or on timeout).
function rpc(messages, wantIds, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [DIST], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    const got = new Map();
    let buf = '';
    const done = () => {
      clearTimeout(timer);
      child.kill();
      resolve({ responses: [...got.values()] });
    };
    const timer = setTimeout(() => { child.kill(); reject(new Error('rpc timeout; got ids ' + [...got.keys()])); }, timeoutMs);

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id != null) got.set(msg.id, msg);
        if (wantIds.every((id) => got.has(id))) done();
      }
    });
    child.on('error', reject);
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
  });
}

const HANDSHAKE = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.0.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
];

test('initialize returns serverInfo and tools/list exposes all four tools', async () => {
  const { responses } = await rpc(
    [...HANDSHAKE, { jsonrpc: '2.0', id: 2, method: 'tools/list' }],
    [1, 2]
  );
  const init = responses.find((m) => m.id === 1);
  assert.equal(init?.result?.serverInfo?.name, 'chaptrone-mcp', 'serverInfo.name');

  const names = (responses.find((m) => m.id === 2)?.result?.tools || []).map((t) => t.name).sort();
  assert.deepEqual(names, ['get_employee_dashboard', 'log_signal', 'say', 'verify_user']);
});

test('tools/call say returns a valid text content block with a /stream-voice URL', async () => {
  const { responses } = await rpc(
    [...HANDSHAKE, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'say', arguments: { text: 'hello raul' } } }],
    [3]
  );
  const block = responses.find((m) => m.id === 3)?.result?.content?.[0];
  assert.equal(block?.type, 'text', 'MCP content must be type=text (never the invalid type=json)');
  assert.match(block?.text || '', /\/stream-voice\?text=hello%20raul/);
});

test('tools/call say rejects input over the 1800-char cap (schema validation wired)', async () => {
  const { responses } = await rpc(
    [...HANDSHAKE, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'say', arguments: { text: 'x'.repeat(2000) } } }],
    [4]
  );
  const r = responses.find((m) => m.id === 4);
  // Either a JSON-RPC error or an isError tool result — both prove validation ran.
  const rejected = !!r?.error || r?.result?.isError === true;
  assert.ok(rejected, 'over-long text must be rejected by the zod max(1800) schema');
});
