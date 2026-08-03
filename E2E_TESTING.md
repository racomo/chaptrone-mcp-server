# ChaptrOne — End-to-End Testing Report

_Date: 2026-07-31 · Branch: `claude/chaprtone-e2e-testing-j6oi14`_

## Scope

This repo (`chaptrone-mcp-server`) is the integration layer between **Goose**
(desktop) and the **ChaptrOne** backend. It contains two independent pieces:

| File | Role | Runnable? |
| --- | --- | --- |
| `src/server.js` | Express **HTTP bridge** — health check + MCP manifest for Goose to load as an HTTP extension. This is what `npm start` runs. | ✅ Yes |
| `src/server.ts` | An **MCP (stdio) server** exposing `log_signal`, `get_employee_dashboard`, `say`, `verify_user`. | ✅ Yes — `npm run build` → `npm run start:mcp` (see finding 2) |

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

### 2. `src/server.ts` — was un-runnable, now FIXED
Originally the MCP server could not start: its deps (`@modelcontextprotocol/sdk`,
`zod`, `node-fetch`) were undeclared and uninstalled; it called `.tool()` on the
low-level `Server` class with a `{ input }` handler shape that the SDK does not
use; it returned invalid `type: "json"` content blocks; and no build step
compiled the TypeScript. Repaired on this branch:

- **Deps declared + installed** — `@modelcontextprotocol/sdk@^1.30`, `zod@^3`
  as runtime deps; `typescript` + `@types/node` as dev deps. `node-fetch` was
  **dropped** in favour of Node 20's global `fetch`.
- **Correct SDK API** — migrated to the high-level `McpServer` + `registerTool`,
  with raw-shape `inputSchema`s and handlers that receive parsed args directly.
- **Valid MCP content** — the invalid `type: "json"` blocks are gone; tools
  return `type: "text"` (with `structuredContent` where a JSON payload helps).
- **Build wired** — `tsconfig` now emits CommonJS (`module: Node16`) so the
  compiled server coexists with the CommonJS Express bridge without flipping the
  package to ESM. `npm run build` → `dist/server.js`; `npm run start:mcp` runs it.
- **Proven** — `test/mcp.server.test.mjs` compiles the server, spawns it, and
  drives a real JSON-RPC handshake over stdio: `initialize` returns `serverInfo`,
  `tools/list` returns all four tools, `tools/call say` returns a valid text
  content block, and over-long input is rejected by the zod schema. **All pass.**

The four tools still proxy to the Render backend, which remains unreachable from
this environment (finding 1), so their network paths are exercised by a live run,
not by CI.

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
- **Repaired the MCP stdio server** (`src/server.ts`) — see finding 2 — added
  its deps + a `build` step, migrated to `McpServer`/`registerTool`, fixed the
  content blocks, and added `test/mcp.server.test.mjs`. **13/13 tests pass.**
- Reconciled `README.md` and `package.json` scripts with the two-server reality
  (`start` = HTTP bridge, `build` + `start:mcp` = MCP stdio server).

## Recommended follow-ups

1. Add a smoke test that runs against the live Render backend from an
   environment/CI job that is allowed to reach it (exercises the tool network
   paths that finding 1 blocks here).
2. Consider a local mock backend so `log_signal` / `get_employee_dashboard` /
   `verify_user` can be asserted end-to-end without the live Render host.
