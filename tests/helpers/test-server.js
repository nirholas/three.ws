// Boot the real server on a port claimed at run time.
//
// Several suites spawn `server/index.mjs` and probe it over HTTP. They used to
// hardcode a port each, which broke two ways: two suites picked the SAME port
// (18453 was used by both server-api-traversal and x402-probe-challenge, so any
// full-suite run raced them), and any second concurrent vitest run in the same
// worktree collided with the first. Both surface as `SocketError: other side
// closed` on a varying subset of tests, a failure that reads like a product
// bug and moves between runs.
//
// Claiming the port from the OS removes most of that, but not all: the port is
// released before the child binds it, and the child spends seconds importing
// before it listens. Another suite can take the port in that gap. Readiness used
// to accept any answer on /api/healthz, so the suite then ran against the OTHER
// suite's server and failed with ECONNREFUSED when that one shut down. A server
// is ready only once its own child prints the listening line for this port; a
// child that loses the race exits non-zero and is retried on a fresh port.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const MAX_ATTEMPTS = 3;

/** An OS-assigned free TCP port, released immediately before the caller reuses it. */
export function freePort() {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address();
			probe.close((err) => (err ? reject(err) : resolve(port)));
		});
	});
}

/**
 * Spawn one child on `port` and resolve once that child reports it is
 * listening and answers /api/healthz. Rejects with `retryable: true` when the
 * child exits before listening (a lost port race).
 */
function bootOnce({ port, env, deadline, startedAt }) {
	const base = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, ['server/index.mjs'], {
		cwd: repoRoot,
		env: { ...process.env, PORT: String(port), NODE_ENV: 'test', ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const close = () => child.kill('SIGKILL');

	// Both pipes are drained for the child's whole life so a chatty server can
	// never block on a full pipe buffer. Only the tail of stderr is kept, to
	// explain a crash.
	let listening = false;
	let stderrTail = '';
	const marker = `listening on :${port} `;
	let stdoutCarry = '';
	child.stdout.on('data', (chunk) => {
		if (listening) return;
		stdoutCarry = (stdoutCarry + chunk).slice(-4096);
		if (stdoutCarry.includes(marker)) listening = true;
	});
	child.stderr.on('data', (chunk) => {
		stderrTail = (stderrTail + chunk).slice(-2048);
	});

	let exited = null;
	child.on('exit', (code, signal) => {
		exited = signal ? `signal ${signal}` : `code ${code}`;
	});

	return (async () => {
		for (;;) {
			if (exited !== null) {
				const err = new Error(`server exited before becoming ready (${exited})${stderrTail ? `: ${stderrTail.trim().split('\n').slice(-3).join(' | ')}` : ''}`);
				err.retryable = /EADDRINUSE/.test(stderrTail);
				throw err;
			}
			if (listening) {
				try {
					const res = await fetch(`${base}/api/healthz`);
					if (res.status > 0) return { base, port, close };
				} catch { /* listening, but the first request can still race the accept loop */ }
			}
			if (Date.now() >= deadline) {
				close();
				throw new Error(
					`server did not answer /api/healthz within ${Date.now() - startedAt}ms (${base}); `
					+ 'the process was still alive, so this is a slow boot, not a crash',
				);
			}
			await new Promise((r) => setTimeout(r, 250));
		}
	})();
}

/**
 * Spawn server/index.mjs on a free port and resolve once it answers /api/healthz.
 *
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.env] extra env for the child (merged over process.env)
 * @param {number} [opts.timeoutMs] how long to wait for readiness, across retries
 * @param {number} [opts.port] port for the first attempt (tests use it to force a collision)
 * @returns {Promise<{ base: string, port: number, close: () => void }>}
 *   `base` is the origin to fetch against; call `close()` in afterAll.
 *
 * The readiness budget is deliberately far above the ~1.5s the server needs on
 * an idle machine: a full `vitest run` puts a worker on every core, so the boot
 * that takes a second alone can take tens of seconds while 1400 other suites
 * compete for the same CPU. A budget sized for the idle case turns that
 * contention into a red suite that passes the moment it is run on its own.
 */
export async function startTestServer({ env = {}, timeoutMs = 60_000, port: requestedPort } = {}) {
	const startedAt = Date.now();
	const deadline = startedAt + timeoutMs;
	for (let attempt = 1; ; attempt++) {
		const port = attempt === 1 && requestedPort ? requestedPort : await freePort();
		try {
			return await bootOnce({ port, env, deadline, startedAt });
		} catch (err) {
			if (!err.retryable || attempt >= MAX_ATTEMPTS) throw err;
		}
	}
}
