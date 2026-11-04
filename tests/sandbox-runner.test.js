// The sandbox runner (workers/sandbox-runner) driven over its real HTTP contract:
// a real runner process, a real HTTP bridge stub, a real program. Execution
// cases need Linux namespace isolation, which this suite probes the same way
// the runner does. On a host without it the runner refuses to run a program
// (asserted below) and the execution cases are not applicable.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectIsolation } from '../api/_lib/sandbox/exec-core.js';
import { limitsFor } from '../api/_lib/sandbox/limits.js';

const isolation = detectIsolation();
const PORT = 18000 + Math.floor(Math.random() * 1000);
const TOKEN = 'runner-test-token';
let runner;
let bridgeServer;
let bridgeCalls = [];
let bridgePort;

async function waitHealthy() {
	for (let i = 0; i < 60; i++) {
		try {
			const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
			if (r.status === 200 || r.status === 503) return;
		} catch {
			/* not listening yet */
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error('runner did not start');
}

beforeAll(async () => {
	bridgeServer = http.createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			const msg = JSON.parse(body);
			bridgeCalls.push({ auth: req.headers.authorization, msg });
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({ ok: true, result: { echoed: msg.args ?? null } }));
		});
	});
	await new Promise((r) => bridgeServer.listen(0, '127.0.0.1', r));
	bridgePort = bridgeServer.address().port;
	runner = spawn('node', ['workers/sandbox-runner/server.mjs'], {
		env: { ...process.env, PORT: String(PORT), SANDBOX_RUNNER_TOKEN: TOKEN, SANDBOX_JOBS_DIR: `${process.env.TMPDIR || '/tmp'}/sandbox-runner-test-${PORT}` },
		stdio: 'ignore',
	});
	await waitHealthy();
}, 30_000);

afterAll(async () => {
	runner?.kill('SIGKILL');
	await new Promise((r) => bridgeServer?.close(r));
});

async function run(job, { files = [], limits = limitsFor('free', { timeoutSeconds: 10 }), token = TOKEN } = {}) {
	return fetch(`http://127.0.0.1:${PORT}/exec`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-sandbox-token': token },
		body: JSON.stringify({
			job,
			workspace: { files: files.map((f) => ({ path: f.path, data_base64: Buffer.from(f.text).toString('base64') })) },
			limits,
			bridge: { url: `http://127.0.0.1:${bridgePort}/api/sandbox/bridge`, token: 'exec-token' },
		}),
	});
}

async function events(res) {
	return (await res.text())
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l));
}

describe('runner HTTP contract', () => {
	it('rejects a request without the shared secret', async () => {
		const res = await run({ kind: 'code', language: 'python', code: 'print(1)' }, { token: 'wrong' });
		expect(res.status).toBe(401);
	});

	it('reports isolation on /healthz', async () => {
		const body = await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json();
		expect(body.ok).toBe(Boolean(isolation.mode));
	});

	it('refuses an unsupported language instead of running it', async () => {
		const res = await run({ kind: 'code', language: 'cobol', code: 'x' });
		expect([400, 503]).toContain(res.status);
	});
});

describe.skipIf(!isolation.mode)('runner execution', () => {
	it('runs python and returns stdout, exit code and changed files', async () => {
		const evs = await events(await run({ kind: 'code', language: 'python', code: 'print(sum(range(10)))\nopen("out.txt","w").write("hi")' }));
		const result = evs.find((e) => e.type === 'result');
		expect(result.exitCode).toBe(0);
		expect(result.stdout.text.trim()).toBe('45');
		expect(result.files.map((f) => f.path)).toEqual(['out.txt']);
		expect(Buffer.from(result.files[0].data_base64, 'base64').toString()).toBe('hi');
		expect(evs[0].type).toBe('started');
	});

	it('hands the program its input files and reports deletions', async () => {
		const evs = await events(
			await run(
				{ kind: 'code', language: 'javascript', code: 'import fs from "node:fs"; console.log(fs.readFileSync("in.txt","utf8").toUpperCase()); fs.rmSync("gone.txt");' },
				{ files: [{ path: 'in.txt', text: 'abc' }, { path: 'gone.txt', text: 'x' }] },
			),
		);
		const result = evs.find((e) => e.type === 'result');
		expect(result.stdout.text.trim()).toBe('ABC');
		expect(result.deleted).toEqual(['gone.txt']);
	});

	it('kills an infinite loop at the wall-clock cap', async () => {
		const limits = { ...limitsFor('free', { timeoutSeconds: 5 }), wallSeconds: 2 };
		const t = Date.now();
		const evs = await events(await run({ kind: 'code', language: 'python', code: 'while True:\n    pass' }, { limits }));
		const result = evs.find((e) => e.type === 'result');
		expect(result.timedOut).toBe(true);
		expect(Date.now() - t).toBeLessThan(15_000);
	}, 30_000);

	it('gives the program no network', async () => {
		const code = 'import socket\ntry:\n    socket.create_connection(("1.1.1.1", 80), timeout=3)\n    print("connected")\nexcept OSError:\n    print("blocked")';
		const evs = await events(await run({ kind: 'code', language: 'python', code }));
		expect(evs.find((e) => e.type === 'result').stdout.text.trim()).toBe('blocked');
	});

	it('forwards a bridge call to the API with the execution token', async () => {
		bridgeCalls = [];
		const code = 'import three_ws\nprint(three_ws.tool("token_price", {"id": "x"}))';
		const evs = await events(await run({ kind: 'code', language: 'python', code }));
		const result = evs.find((e) => e.type === 'result');
		expect(bridgeCalls.length).toBeGreaterThan(0);
		expect(bridgeCalls[0].auth).toBe('Bearer exec-token');
		expect(result.exitCode).toBe(0);
	});

	it('refuses a second request while one is running', async () => {
		const limits = { ...limitsFor('free', { timeoutSeconds: 5 }), wallSeconds: 3 };
		const first = run({ kind: 'code', language: 'python', code: 'import time; time.sleep(2)' }, { limits });
		await new Promise((r) => setTimeout(r, 500));
		const second = await run({ kind: 'code', language: 'python', code: 'print(1)' });
		expect(second.status).toBe(429);
		await (await first).text();
	}, 20_000);
});
