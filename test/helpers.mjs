// test/helpers.mjs
// Shared helpers for the ChaptrOne E2E suite: boot the real server as a child
// process, wait for it to accept connections, and tear it down cleanly.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, '..', 'src', 'server.js');

/**
 * Start src/server.js on the given port with optional extra env, and resolve
 * once /healthz answers (or reject after a timeout).
 *
 * @param {object} [opts]
 * @param {number} [opts.port]   Port to listen on (default 10555).
 * @param {object} [opts.env]    Extra environment variables for the child.
 * @returns {Promise<{baseUrl: string, port: number, stop: () => Promise<void>, child: import('node:child_process').ChildProcess}>}
 */
export async function startServer({ port = 10555, env = {} } = {}) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  // If the process dies during startup, surface why.
  const exited = once(child, 'exit').then(([code]) => {
    throw new Error(`server exited early (code ${code})\n${stderr}`);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const ready = waitForHealth(`${baseUrl}/healthz`, 5000);

  await Promise.race([ready, exited]);

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), delay(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  };

  return { baseUrl, port, stop, child };
}

/** Poll a URL until it returns any HTTP response or the deadline passes. */
async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = new Error(`health returned HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await delay(100);
  }
  throw new Error(`server did not become healthy within ${timeoutMs}ms: ${lastErr}`);
}
