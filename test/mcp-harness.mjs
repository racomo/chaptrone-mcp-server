// test/mcp-harness.mjs
// Shared helpers for driving the compiled MCP stdio server (dist/server.js).
// The build is produced once by the `pretest` script (tsc) before any test runs.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = join(ROOT, 'dist', 'server.js');

export const HANDSHAKE = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.0.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
];

// Spawn a fresh server, send `messages`, resolve once responses for every id in
// `wantIds` have arrived (or reject on timeout). `env` is merged over process.env
// so a test can point the server at a mock backend via CHAPTR_ONE_BASE, etc.
export function rpc(messages, { wantIds, env = {}, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [DIST], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    const got = new Map();
    let buf = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('rpc timeout; got ids ' + [...got.keys()])); }, timeoutMs);
    const finish = () => { clearTimeout(timer); child.kill(); resolve({ responses: [...got.values()] }); };

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id != null) got.set(m.id, m);
        if (wantIds.every((id) => got.has(id))) finish();
      }
    });
    child.on('error', reject);
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
  });
}

// Convenience: full handshake + a single tools/call, waiting on the call's id.
export function callTool(name, args, { id = 9, env = {} } = {}) {
  return rpc(
    [...HANDSHAKE, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }],
    { wantIds: [id], env }
  ).then(({ responses }) => responses.find((m) => m.id === id));
}
