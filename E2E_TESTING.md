# ChaptrOne — End-to-End Testing Report

_Date: 2026-07-31 · Branch: `claude/chaprtone-e2e-testing-j6oi14`_

## Scope

This repo (`chaptrone-mcp-server`) is the integration layer between **Goose**
(desktop) and the **ChaptrOne** backend. It contains two independent pieces:

| File | Role | Runnable? |
| --- | --- | --- |
| `src/server.js` | Express **HTTP bridge** — health check + MCP manifest for Goose to load as an HTTP extension. This is what `npm start` runs. | ✅ Yes |
| `src/server.ts` | An **MCP (stdio) server** exposing `log_signal`, `get_employee_dashboard`, `say`, `verify_user`. | ❌ No — see findings |

"End-to-end" here means booting the real server process and driving it over
real HTTP, exactly as a Goose client or a Render health check would.

## How to run

```bash
npm ci
npm test        # node --test, spawns the real server and hits it over HTTP
```

## What was tested (and passed)

The suite in `test/bridge.e2e.test.mjs` boots `src/server.js` as a child
process and asserts its live behavior. **10/10 tests pass.**

- **`GET /healthz`** → `200` with `{ ok: true, service: "chptr-one", ts: <number> }`.
- **`GET /mcp/manifest.json`** → well-formed manifest: `name`, `version`,
  `authentication: "none"`, an `http(s)` `base_url`, and a non-empty `tools`
  array where every tool has a valid `operationId` / `summary` / `method` /
  rooted `path`.
- **Tool set** is exactly `generateStory`, `getVoices`, `getSession`.
- **`generateStory` input schema** is valid: `POST /api/generate-story-stream`,
  `required: ["language", "level"]`, language enum `en|es|fr|da`, level enum
  `beginner|intermediate|advanced`.
- **`GET /mcp/tools`** stays consistent with the manifest (same operationIds,
  same `base_url`).
- **CORS**: `access-control-allow-origin: *` on responses and on `OPTIONS`
  preflight.
- **Unknown routes** → `404`.
- **`express.json()`** parses a posted body without crashing.
- **Config**: `PUBLIC_BASE_URL` env var overrides `base_url` (and `contact.url`)
  in the manifest and `/mcp/tools`.

## Findings / blockers

### 1. The live ChaptrOne backend is unreachable from this environment
The manifest and MCP tools proxy to `https://chptr-one-render.onrender.com`.
That host is **blocked by the session's egress policy** (the proxy returns
`403` to the `CONNECT`), so the suite validates the bridge's own contract — the
manifest it serves and its operational endpoints — but cannot exercise the
upstream backend endpoints (`/api/get-voices`, `/api/get-session`,
`/api/generate-story-stream`, `/api/behavior/log`, `/api/dashboard/employee/:id`,
`/stream-voice`) live. Those need to be run from an environment allowed to reach
the Render host.

### 2. `src/server.ts` cannot run as written
- Its dependencies — `@modelcontextprotocol/sdk`, `zod`, `node-fetch` — are
  **not declared in `package.json`** and are not installed.
- The MCP API usage is inconsistent with the SDK: it calls `.tool()` on the
  low-level `Server` class and reads handler args as `{ input }`, which is not
  the current SDK's tool-registration shape. It has no build step wired up
  either (`tsconfig.json` emits to `dist/`, but nothing compiles it).
- Net effect: the four MCP tools (`log_signal`, `get_employee_dashboard`,
  `say`, `verify_user`) are **not currently executable**. Making them testable
  requires declaring the deps, fixing the registration API, and adding a build.
  This was left as a documented finding rather than silently rewritten.

### 3. CI was broken (now fixed)
`.github/workflows/ci.yml` ran `npm ci` (no lockfile was committed) and
`npm run build` (no such script) and uploaded a `dist/` that is never produced.
Fixed in this branch: committed `package-lock.json`, and the workflow now runs
`npm ci && npm test`.

## Changes made on this branch

- Added `test/helpers.mjs` and `test/bridge.e2e.test.mjs` (Node built-in test
  runner — no new runtime dependencies).
- Added a `test` script to `package.json`.
- Committed `package-lock.json` so `npm ci` is reproducible.
- Rewrote the CI workflow to install and run the E2E suite.

## Recommended follow-ups

1. Add the MCP SDK deps + a build step and repair `src/server.ts` so the four
   MCP tools run; then add tool-level E2E tests against a local mock backend.
2. Add a smoke test that runs against the live Render backend from an
   environment/CI job that is allowed to reach it.
3. Reconcile `README.md` (`npm run dev` / `npm run build`) with the actual
   scripts in `package.json`.
