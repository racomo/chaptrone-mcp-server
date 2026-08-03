# chaptrone-mcp-server

Integration layer between **Goose** (desktop) and the **Chaptr One** backend.
It ships two independent servers:

| Server | File | Run with | Purpose |
| --- | --- | --- | --- |
| **HTTP bridge** | `src/server.js` | `npm start` | Health check + `/mcp/manifest.json` for Goose to load as an HTTP extension. This is what Render runs. |
| **MCP stdio server** | `src/server.ts` → `dist/server.js` | `npm run build` then `npm run start:mcp` | Native MCP server exposing the tools below over stdio. |

## MCP tools (stdio server)

- **log_signal** → `POST /api/behavior/log`
- **get_employee_dashboard** → `GET /api/dashboard/employee/:id`
- **say** → returns a playable `/stream-voice` URL
- **verify_user** → rubric scoring (uses OpenAI if `OPENAI_API_KEY` is set, else a deterministic mock)

## Setup

```bash
npm ci
cp .env.example .env   # set CHAPTR_ONE_BASE, optional CHAPTRONE_MCP_KEY / OPENAI_API_KEY
```

## Scripts

```bash
npm start          # run the HTTP bridge (src/server.js)      — Render entrypoint
npm run build      # compile src/server.ts -> dist/server.js  (CommonJS)
npm run start:mcp  # run the compiled MCP stdio server
npm run dev:mcp    # build + run the MCP server in one step
npm test           # build the MCP server + run the full node:test suite
```

### Point Goose at the MCP server

After `npm run build`, register `node /abs/path/to/dist/server.js` as a stdio
MCP command in Goose. Environment variables (`CHAPTR_ONE_BASE`, `CHAPTRONE_MCP_KEY`,
`OPENAI_API_KEY`, `OPENAI_MODEL`) are read from the process environment.

## Tests

`npm test` runs the Node built-in test runner over `test/*.test.mjs`:

- `bridge.e2e.test.mjs` — boots the HTTP bridge and asserts its manifest + endpoints.
- `mcp.server.test.mjs` — spawns the MCP server and drives a real JSON-RPC
  handshake over stdio (initialize / tools/list / tools/call).
- `mcp.tools.integration.test.mjs` — points the MCP server at a local mock of the
  Chaptr One backend (via `CHAPTR_ONE_BASE`) and asserts `log_signal`,
  `get_employee_dashboard`, and `verify_user` end-to-end.

`pretest` compiles the MCP server (`tsc`) so the suite always runs against fresh output.

See [`E2E_TESTING.md`](./E2E_TESTING.md) for the full report.
