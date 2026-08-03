// test/mcp.tools.integration.test.mjs
// End-to-end for the three network-backed MCP tools against a LOCAL mock of the
// Chaptr One backend (the live Render host is unreachable from CI — E2E report
// finding 1). The MCP server is pointed at the mock via CHAPTR_ONE_BASE, so
// log_signal / get_employee_dashboard / verify_user exercise their real HTTP
// paths, header auth, and response handling — no live host required.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { callTool, DIST } from './mcp-harness.mjs';

let server, BASE;
const received = []; // every request the mock backend sees

before(async () => {
  assert.ok(existsSync(DIST), 'dist/server.js must exist (run via `npm test`, which builds first)');

  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body });

      if (req.method === 'POST' && req.url === '/api/behavior/log') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.method === 'GET' && req.url.startsWith('/api/dashboard/employee/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          user_id: decodeURIComponent(req.url.split('/').pop()),
          cognitive_growth_index: 0.5,
          stage: 'reframe',
        }));
      }
      res.writeHead(404); res.end('not found');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => { if (server) server.close(); });

test('log_signal POSTs to /api/behavior/log (with x-mcp-key) and returns ok', async () => {
  const env = { CHAPTR_ONE_BASE: BASE, CHAPTRONE_MCP_KEY: 'secret-123' };
  const r = await callTool('log_signal',
    { user_id: 'u-1', stage: 'awareness', awareness_score: 0.7 },
    { id: 10, env });

  assert.equal(r?.result?.content?.[0]?.text, 'ok', 'tool should report ok on 200');
  assert.notEqual(r?.result?.isError, true);

  const hit = received.find((x) => x.method === 'POST' && x.url === '/api/behavior/log');
  assert.ok(hit, 'backend must have received the POST');
  assert.equal(hit.headers['x-mcp-key'], 'secret-123', 'shared secret header must be forwarded');
  const sent = JSON.parse(hit.body);
  assert.equal(sent.user_id, 'u-1');
  assert.equal(sent.stage, 'awareness');
  // zod defaults are applied before the call
  assert.equal(sent.sentiment, 'positive');
  assert.equal(sent.emotion, 'curious');
});

test('get_employee_dashboard GETs the summary and returns it as JSON', async () => {
  const r = await callTool('get_employee_dashboard', { user_id: 'u-2' },
    { id: 11, env: { CHAPTR_ONE_BASE: BASE } });

  const payload = r?.result?.structuredContent
    || JSON.parse(r?.result?.content?.[0]?.text || '{}');
  assert.equal(payload.user_id, 'u-2');
  assert.equal(payload.cognitive_growth_index, 0.5);

  const hit = received.find((x) => x.method === 'GET' && x.url === '/api/dashboard/employee/u-2');
  assert.ok(hit, 'backend must have received the dashboard GET with the encoded id');
});

test('verify_user (mock mode) scores from the dashboard CGI with the default rubric', async () => {
  // No OPENAI_API_KEY -> deterministic mock: score = clamp(cgi + 0.1) = 0.6.
  const r = await callTool('verify_user', { user_id: 'u-3' },
    { id: 12, env: { CHAPTR_ONE_BASE: BASE, OPENAI_API_KEY: '' } });

  const payload = r?.result?.structuredContent
    || JSON.parse(r?.result?.content?.[0]?.text || '{}');
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'mock');
  assert.equal(payload.weighted_score, 0.6, 'cgi 0.5 + 0.1 optimism');
  assert.equal(payload.details.length, 3, 'default rubric has three items');
  assert.deepEqual(payload.details.map((d) => d.id).sort(), ['application', 'fluency', 'reflection']);
});
