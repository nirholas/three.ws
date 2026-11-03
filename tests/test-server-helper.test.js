// startTestServer() claims a free port, releases it, then spawns the server on
// it. Under a full vitest run another suite can take that port in between. The
// server used to swallow its EADDRINUSE through the uncaughtException logger and
// stay alive without listening, and readiness accepted whatever answered
// /api/healthz on the port, so a suite ran its requests against another suite's
// server and failed with ECONNREFUSED once that server shut down.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { freePort, startTestServer } from './helpers/test-server.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cleanup = [];
afterEach(async () => {
	while (cleanup.length) await cleanup.pop()();
});

async function impostorOn(port) {
	const impostor = createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'text/plain' });
		res.end('impostor');
	});
	await new Promise((resolve) => impostor.listen(port, '127.0.0.1', resolve));
	cleanup.push(() => new Promise((resolve) => impostor.close(resolve)));
	return impostor;
}

describe('server/index.mjs on a port that is already taken', () => {
	it('exits non-zero instead of idling without a listener', async () => {
		const port = await freePort();
		await impostorOn(port);
		const child = spawn(process.execPath, ['server/index.mjs'], {
			cwd: repoRoot,
			env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
			stdio: 'ignore',
		});
		cleanup.push(() => child.kill('SIGKILL'));
		const code = await new Promise((resolve) => {
			child.on('exit', (c) => resolve(c));
			setTimeout(() => resolve('still running'), 45_000).unref();
		});
		expect(code).toBe(1);
	}, 60_000);
});

describe('startTestServer', () => {
	it('never hands back a port some other process answers on', async () => {
		const taken = await freePort();
		await impostorOn(taken);
		const server = await startTestServer({ port: taken, timeoutMs: 60_000 });
		cleanup.push(() => server.close());
		expect(server.port).not.toBe(taken);
		const res = await fetch(`${server.base}/api/healthz`);
		expect(await res.text()).not.toBe('impostor');
	}, 120_000);
});
