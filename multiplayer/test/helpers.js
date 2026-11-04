// Shared helpers for the multiplayer tests: a throwaway Redis in Docker and
// real server processes. Nothing here mocks Colyseus or Redis.

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SERVER_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

export function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

export function dockerAvailable() {
	const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
	return r.status === 0;
}

export function redisServerBinary() {
	return spawnSync('redis-server', ['--version'], { encoding: 'utf8' }).status === 0;
}

/** Start a disposable Redis on a free port. Returns { uri, stop }. */
export async function startRedis() {
	const port = await freePort();
	let stop;
	if (redisServerBinary()) {
		const child = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
		stop = async () => { child.kill('SIGTERM'); };
	} else if (dockerAvailable()) {
		const name = `mp-test-redis-${process.pid}-${port}`;
		const r = spawnSync('docker', ['run', '-d', '--rm', '--name', name, '-p', `127.0.0.1:${port}:6379`, 'redis:7-alpine'], { encoding: 'utf8' });
		if (r.status !== 0) throw new Error(`docker could not start redis: ${r.stderr}`);
		stop = async () => { spawnSync('docker', ['rm', '-f', name]); };
	} else {
		return null;
	}
	const uri = `redis://127.0.0.1:${port}`;
	await waitForPort(port, 20_000);
	return { uri, stop };
}

export async function waitForPort(port, timeoutMs) {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		const ok = await new Promise((resolve) => {
			const s = net.connect(port, '127.0.0.1', () => { s.destroy(); resolve(true); });
			s.on('error', () => resolve(false));
		});
		if (ok) return;
		await new Promise((r) => setTimeout(r, 150));
	}
	throw new Error(`port ${port} did not open within ${timeoutMs} ms`);
}

/** Boot src/index.js as a child process. Resolves once /health answers. */
export async function startServer({ env = {} } = {}) {
	const port = env.PORT ? Number(env.PORT) : await freePort();
	const child = spawn(process.execPath, [SERVER_ENTRY], {
		env: {
			...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
			HOLDER_PASS_SECRET: 'multiplayer-test-secret', MULTIPLAYER_SHARED_SECRET: 'multiplayer-test-secret',
			UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', ...env,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let log = '';
	child.stdout.on('data', (d) => { log += d; });
	child.stderr.on('data', (d) => { log += d; });
	const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
	const server = {
		port, child, exited, log: () => log, url: `http://127.0.0.1:${port}`,
		async stop() { child.kill('SIGTERM'); await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]); child.kill('SIGKILL'); },
	};
	const end = Date.now() + 40_000;
	while (Date.now() < end) {
		if (child.exitCode !== null) return server;
		try {
			const r = await fetch(`${server.url}/health`);
			if (r.ok) { server.health = await r.json(); return server; }
		} catch { /* not listening yet */ }
		await new Promise((r) => setTimeout(r, 200));
	}
	await server.stop();
	throw new Error(`server did not become healthy:\n${log}`);
}
