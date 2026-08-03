// test/mcp.server.test.mjs
// Protocol-level E2E for the MCP stdio server (src/server.ts -> dist/server.js).
// Drives the compiled server with a real JSON-RPC handshake over stdio — no
// network (BASE is never contacted here). The build is produced by `pretest`.
import { test, before } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { rpc, callTool, HANDSHAKE, DIST } from './mcp-harness.mjs';

before(() => {
  assert.ok(existsSync(DIST), 'dist/server.js must exist (run via `npm test`, which builds first)');
});

test('initialize returns serverInfo and tools/list exposes all four tools', async () => {
  const { responses } = await rpc(
    [...HANDSHAKE, { jsonrpc: '2.0', id: 2, method: 'tools/list' }],
    { wantIds: [1, 2] }
  );
  const init = responses.find((m) => m.id === 1);
  assert.equal(init?.result?.serverInfo?.name, 'chaptrone-mcp', 'serverInfo.name');

  const names = (responses.find((m) => m.id === 2)?.result?.tools || []).map((t) => t.name).sort();
  assert.deepEqual(names, ['get_employee_dashboard', 'log_signal', 'say', 'verify_user']);
});

test('tools/call say returns a valid text content block with a /stream-voice URL', async () => {
  const r = await callTool('say', { text: 'hello raul' }, { id: 3 });
  const block = r?.result?.content?.[0];
  assert.equal(block?.type, 'text', 'MCP content must be type=text (never the invalid type=json)');
  assert.match(block?.text || '', /\/stream-voice\?text=hello%20raul/);
});

test('tools/call say rejects input over the 1800-char cap (schema validation wired)', async () => {
  const r = await callTool('say', { text: 'x'.repeat(2000) }, { id: 4 });
  const rejected = !!r?.error || r?.result?.isError === true;
  assert.ok(rejected, 'over-long text must be rejected by the zod max(1800) schema');
});
