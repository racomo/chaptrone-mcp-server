// test/bridge.e2e.test.mjs
//
// End-to-end tests for the ChaptrOne HTTP bridge (src/server.js).
//
// These boot the *real* Express server as a child process and exercise it over
// real HTTP — no mocking of the app itself — so they verify routing, JSON
// serialization, CORS, and env-driven config exactly as a Goose client or
// Render health check would see them.
//
// NOTE: The tools the manifest advertises proxy to the live ChaptrOne backend
// at https://chptr-one-render.onrender.com. That host is not reachable from CI
// (blocked by egress policy), so these tests validate the bridge's own
// contract — the manifest it serves and its operational endpoints — rather than
// the upstream backend. See E2E_TESTING.md for the full backend picture.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

describe('ChaptrOne HTTP bridge — E2E', () => {
  let server;

  before(async () => {
    server = await startServer({ port: 10561 });
  });

  after(async () => {
    await server?.stop();
  });

  test('GET /healthz returns a healthy payload', async () => {
    const res = await fetch(`${server.baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'chptr-one');
    assert.equal(typeof body.ts, 'number');
    assert.ok(body.ts > 0, 'ts should be a positive epoch millis value');
  });

  test('GET /mcp/manifest.json returns a well-formed manifest', async () => {
    const res = await fetch(`${server.baseUrl}/mcp/manifest.json`);
    assert.equal(res.status, 200);

    const m = await res.json();
    assert.equal(m.name, 'chaptrone-mcp');
    assert.equal(typeof m.version, 'string');
    assert.equal(m.authentication, 'none');
    assert.match(m.base_url, /^https?:\/\//);
    assert.ok(Array.isArray(m.tools) && m.tools.length > 0, 'tools must be a non-empty array');

    // Every tool must declare the fields a client needs to call it.
    for (const tool of m.tools) {
      assert.equal(typeof tool.operationId, 'string', 'tool.operationId');
      assert.equal(typeof tool.summary, 'string', `${tool.operationId}.summary`);
      assert.match(tool.method, /^(GET|POST|PUT|PATCH|DELETE)$/, `${tool.operationId}.method`);
      assert.match(tool.path, /^\//, `${tool.operationId}.path must be rooted`);
    }
  });

  test('manifest advertises the expected tool set', async () => {
    const m = await (await fetch(`${server.baseUrl}/mcp/manifest.json`)).json();
    const ops = m.tools.map((t) => t.operationId).sort();
    assert.deepEqual(ops, ['generateStory', 'getSession', 'getVoices']);
  });

  test('generateStory tool declares a valid input schema', async () => {
    const m = await (await fetch(`${server.baseUrl}/mcp/manifest.json`)).json();
    const gen = m.tools.find((t) => t.operationId === 'generateStory');

    assert.ok(gen, 'generateStory tool present');
    assert.equal(gen.method, 'POST');
    assert.equal(gen.path, '/api/generate-story-stream');

    const schema = gen.input_schema;
    assert.equal(schema.type, 'object');
    assert.deepEqual(schema.required, ['language', 'level']);
    assert.deepEqual(schema.properties.language.enum, ['en', 'es', 'fr', 'da']);
    assert.deepEqual(schema.properties.level.enum, ['beginner', 'intermediate', 'advanced']);
  });

  test('GET /mcp/tools stays consistent with the manifest', async () => {
    const [tools, manifest] = await Promise.all([
      (await fetch(`${server.baseUrl}/mcp/tools`)).json(),
      (await fetch(`${server.baseUrl}/mcp/manifest.json`)).json(),
    ]);

    assert.deepEqual(
      tools.tools.sort(),
      manifest.tools.map((t) => t.operationId).sort(),
      '/mcp/tools list should mirror manifest operationIds',
    );
    assert.equal(tools.base_url, manifest.base_url, 'base_url should match across endpoints');
  });

  test('responses include permissive CORS headers', async () => {
    const res = await fetch(`${server.baseUrl}/healthz`, {
      headers: { Origin: 'https://goose.example' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  test('CORS preflight (OPTIONS) is answered', async () => {
    const res = await fetch(`${server.baseUrl}/mcp/manifest.json`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://goose.example',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.ok(res.status === 204 || res.status === 200, `preflight status ${res.status}`);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  test('unknown routes return 404', async () => {
    const res = await fetch(`${server.baseUrl}/definitely-not-a-route`);
    assert.equal(res.status, 404);
  });

  test('JSON body middleware accepts a posted body without crashing', async () => {
    // No POST route is defined, so we expect a clean 404 — the point is that
    // express.json() parses the body instead of throwing/hanging.
    const res = await fetch(`${server.baseUrl}/mcp/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    assert.equal(res.status, 404);
  });
});

describe('ChaptrOne HTTP bridge — configuration', () => {
  test('PUBLIC_BASE_URL env var overrides base_url in the manifest', async () => {
    const custom = 'https://staging.chaptrone.example';
    const server = await startServer({ port: 10562, env: { PUBLIC_BASE_URL: custom } });
    try {
      const m = await (await fetch(`${server.baseUrl}/mcp/manifest.json`)).json();
      assert.equal(m.base_url, custom);
      assert.equal(m.contact.url, custom);

      const tools = await (await fetch(`${server.baseUrl}/mcp/tools`)).json();
      assert.equal(tools.base_url, custom);
    } finally {
      await server.stop();
    }
  });
});
