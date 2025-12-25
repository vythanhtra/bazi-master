import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_PORT = process.env.VERIFICATION_PORT || '4100';
const FALLBACK_PORT = '4000';

const run = async () => {
  let server = null;
  let port = DEFAULT_PORT;
  let baseUrl = `http://localhost:${port}`;

  const probeHealth = async (targetPort) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(`http://localhost:${targetPort}/health`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  if (await probeHealth(FALLBACK_PORT)) {
    port = FALLBACK_PORT;
    baseUrl = `http://localhost:${port}`;
  } else {
    server = spawn('node', ['backend/server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: port,
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const logs = [];
    const collect = (chunk) => {
      logs.push(chunk.toString());
    };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);

    const waitForReady = async () => {
      const start = Date.now();
      while (true) {
        if (await probeHealth(port)) return;
        if (Date.now() - start > 15000) {
          throw new Error(`Server did not become ready. Logs:\n${logs.join('')}`);
        }
        await delay(200);
      }
    };

    await waitForReady();
  }

  const requestReset = async (email) => {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/api/password/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const durationMs = Date.now() - start;
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body, durationMs };
  };

  try {
    const existing = await requestReset('test@example.com');
    const missing = await requestReset('does-not-exist-12345@example.com');

    const sameStatus = existing.status === missing.status;
    const sameMessage = existing.body?.message === missing.body?.message;

    console.log('Password reset request results:');
    console.log(`- Existing email: status=${existing.status} duration=${existing.durationMs}ms message=${existing.body?.message}`);
    console.log(`- Missing email:  status=${missing.status} duration=${missing.durationMs}ms message=${missing.body?.message}`);

    if (!sameStatus || !sameMessage) {
      console.error('FAIL: Responses differ between existing and non-existing emails.');
      process.exitCode = 1;
      return;
    }

    console.log('PASS: Responses match for existing and non-existing emails.');
  } finally {
    if (server) {
      server.kill('SIGTERM');
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
