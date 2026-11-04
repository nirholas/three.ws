// executeInSandbox (api/_lib/sandbox/execute.js) end to end against the real
// sandbox schema in an in-process Postgres and a real workspace on disk:
//
//   - the local backend really runs the program, isolated, and returns 45 for
//     print(sum(range(10))); an infinite loop is stopped at the wall cap; a
//     direct network call fails; files the program writes are saved and
//     served from the workspace; the bridge answers from inside the program
//     and refuses a fund-moving tool
//   - the cloud backend posts the job to a runner (a real HTTP server here
//     speaking the runner's NDJSON protocol), saves the files it returns and
//     debits the credit balance exactly once, and refuses up front when the
//     balance cannot cover the worst case
//   - the kill switch, the anomaly guard and the per-run execution cap
//
// The local-backend cases need Linux namespaces; they skip, loudly, where the
// host cannot isolate (the backend itself fails closed there).

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-exec-test-'));
process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.SANDBOX_BRIDGE_SECRET = 'test-bridge-secret';
process.env.SANDBOX_STORE = 'fs';
process.env.SANDBOX_DATA_DIR = DATA_DIR;
process.env.SANDBOX_LOCAL = '1';
process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
delete process.env.SANDBOX_RUNNER_URL;
delete process.env.SANDBOX_RUNNER_TOKEN;
delete process.env.SANDBOX_DOCKER;

const { detectIsolation } = await import('../api/_lib/sandbox/exec-core.js');
const { executeInSandbox, normalizeJob, decodeInputFiles, readWorkspaceFile, writeWorkspaceFile, ANOMALY } = await import(
	'../api/_lib/sandbox/execute.js'
);
const store = await import('../api/_lib/sandbox/store.js');
const { workspaceStore } = await import('../api/_lib/sandbox/workspace.js');

const USER = '11111111-1111-4111-8111-111111111111';
const PRO_USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const MIGRATIONS = ['20260621200000_credits.sql', '20260922220000_agent_sandbox.sql'].map((f) =>
	fs.readFileSync(path.resolve(__dirname, '../api/_lib/migrations', f), 'utf8'),
);
const ISOLATION = process.platform === 'linux' ? detectIsolation() : { mode: null, tried: [] };
if (!ISOLATION.mode) console.warn(`sandbox-execute: local backend cases skipped, no isolation here: ${JSON.stringify(ISOLATION.tried)}`);

let seq = 0;
const newRun = () => `run-exec-${++seq}-${Date.now()}`;

beforeAll(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(`
		create table users (id uuid primary key, plan text);
		create table agent_identities (id uuid primary key);
		insert into users (id, plan) values ('${USER}', 'free'), ('${PRO_USER}', 'pro'), ('${OTHER}', 'free');
	`);
	for (const m of MIGRATIONS) await holder.db.exec(m);
});
afterAll(async () => {
	await holder.db?.close?.();
	fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('job validation', () => {
	it('normalizes language aliases and refuses unknown languages', () => {
		expect(normalizeJob({ language: 'py', code: 'print(1)' })).toEqual({ kind: 'code', language: 'python', code: 'print(1)' });
		expect(normalizeJob({ language: 'node', code: '1' }).language).toBe('javascript');
		expect(() => normalizeJob({ language: 'cobol', code: 'x' })).toThrow(/language must be one of/);
		expect(() => normalizeJob({ language: 'python', code: '   ' })).toThrow(/empty/);
		expect(() => normalizeJob({ kind: 'terminal', command: '' })).toThrow(/needs a command/);
	});
	it('refuses oversized code', () => {
		expect(() => normalizeJob({ language: 'python', code: 'x'.repeat(300 * 1024) })).toThrow(/larger than/);
	});
	it('decodes text and base64 input files and refuses escapes and state paths', () => {
		const [a, b] = decodeInputFiles([
			{ path: '/workspace/data/a.csv', content: 'x,y\n1,2\n' },
			{ path: 'b.bin', content_base64: Buffer.from([0, 1, 2]).toString('base64') },
		]);
		expect(a.path).toBe('data/a.csv');
		expect(b.data).toEqual(Buffer.from([0, 1, 2]));
		expect(() => decodeInputFiles([{ path: '../etc/passwd', content: '' }])).toThrow();
		expect(() => decodeInputFiles([{ path: '.three_ws/env', content: '' }])).toThrow(/reserved/);
	});
});

describe.skipIf(!ISOLATION.mode)('local backend, real program', () => {
	it('returns 45 for print(sum(range(10)))', async () => {
		const runId = newRun();
		const chunks = [];
		const r = await executeInSandbox({
			userId: USER,
			runId,
			job: { language: 'python', code: 'print(sum(range(10)))' },
			onOutput: (stream, chunk) => chunks.push([stream, chunk.toString()]),
		});
		expect(r.status).toBe('succeeded');
		expect(r.exit_code).toBe(0);
		expect(r.stdout.trim()).toBe('45');
		expect(r.backend).toBe('local');
		expect(r.isolation).toBe(ISOLATION.mode);
		expect(r.cost_usd).toBe(0);
		expect(chunks.map((c) => c[1]).join('')).toContain('45');
		const rows = await store.listExecutions(runId);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: 'succeeded', exit_code: 0, language: 'python', seq: 1 });
	});

	it('stops an infinite loop at the wall cap', async () => {
		const r = await executeInSandbox({ userId: USER, runId: newRun(), timeoutSeconds: 2, job: { language: 'python', code: 'while True:\n    pass' } });
		expect(r.status).toBe('timeout');
		expect(r.error).toMatch(/2s wall-clock limit/);
		expect(r.wall_ms).toBeGreaterThanOrEqual(1900);
		expect(r.wall_ms).toBeLessThan(10_000);
	}, 30_000);

	it('has no network', async () => {
		const code = [
			'import socket',
			'try:',
			'    socket.create_connection(("1.1.1.1", 53), timeout=3)',
			'    print("CONNECTED")',
			'except OSError as e:',
			'    print("BLOCKED", e.errno)',
		].join('\n');
		const r = await executeInSandbox({ userId: USER, runId: newRun(), job: { language: 'python', code } });
		expect(r.status).toBe('succeeded');
		expect(r.stdout).toMatch(/^BLOCKED/);
	}, 30_000);

	it('keeps the workspace across executions and saves what the program writes', async () => {
		const runId = newRun();
		const first = await executeInSandbox({
			userId: USER,
			runId,
			files: [{ path: 'in/numbers.txt', content: '1\n2\n3\n' }],
			job: { language: 'python', code: 'n = sum(int(l) for l in open("in/numbers.txt"))\nopen("out/total.txt","w").write(str(n))' },
		});
		// out/ does not exist in a fresh workspace, so this one fails and saves nothing.
		expect(first.status).toBe('failed');
		expect(first.files_changed).toEqual([]);
		expect(first.stderr).toMatch(/No such file or directory/);

		const second = await executeInSandbox({
			userId: USER,
			runId,
			job: { language: 'python', code: 'import os\nos.makedirs("out", exist_ok=True)\nn = sum(int(l) for l in open("in/numbers.txt"))\nopen("out/total.txt","w").write(str(n))' },
		});
		expect(second.status).toBe('succeeded');
		expect(second.files_changed).toEqual([{ path: 'out/total.txt', size: 1, url: expect.stringContaining('/api/sandbox/file?run=') }]);
		const file = await readWorkspaceFile({ userId: USER, runId, path: 'out/total.txt' });
		expect(file).toMatchObject({ content: '6', encoding: 'utf8', size: 1 });
		await expect(readWorkspaceFile({ userId: OTHER, runId, path: 'out/total.txt' })).rejects.toMatchObject({ status: 403 });

		const third = await executeInSandbox({ userId: USER, runId, job: { language: 'bash', code: 'rm out/total.txt && echo gone' } });
		expect(third.files_deleted).toEqual(['out/total.txt']);
		expect((await workspaceStore().list(runId)).map((f) => f.path)).toEqual(['in/numbers.txt']);
	}, 60_000);

	it('keeps terminal state between commands', async () => {
		const runId = newRun();
		await executeInSandbox({ userId: USER, runId, job: { kind: 'terminal', command: 'mkdir -p proj && cd proj && export GREETING=hello' } });
		const r = await executeInSandbox({ userId: USER, runId, job: { kind: 'terminal', command: 'pwd && echo $GREETING' } });
		expect(r.status).toBe('succeeded');
		expect(r.stdout).toMatch(/\/proj\n/);
		expect(r.stdout).toMatch(/hello/);
		// The session state lives in the workspace but is never listed as an output.
		expect(r.files_changed.every((f) => !f.path.startsWith('.three_ws'))).toBe(true);
	}, 60_000);

	it('answers the bridge from inside the program and refuses a fund-moving tool', async () => {
		const code = [
			'import three_ws',
			'names = [t["name"] for t in three_ws.tools()]',
			'print("pay_and_call" in names, len(names) > 0)',
			'try:',
			'    three_ws.tool("pay_and_call", {"url": "https://example.com"})',
			'except three_ws.BridgeError as e:',
			'    print("REFUSED", e.code)',
			'try:',
			'    three_ws.fetch("https://example.com/")',
			'except three_ws.BridgeError as e:',
			'    print("FETCH", e.code)',
		].join('\n');
		const r = await executeInSandbox({ userId: USER, runId: newRun(), job: { language: 'python', code } });
		expect(r.stderr).toBe('');
		expect(r.stdout.split('\n')).toEqual(['False True', 'REFUSED financial_tool', 'FETCH egress_off', '']);
		const [row] = await store.listExecutions(r.run_id);
		expect(row.bridge_calls).toBe(3);
	}, 60_000);

	it('writes a file for the model without running anything', async () => {
		const runId = newRun();
		const w = await writeWorkspaceFile({ userId: USER, runId, path: 'notes/plan.md', content: '# plan\n' });
		expect(w).toMatchObject({ path: 'notes/plan.md', size: 7 });
		const r = await executeInSandbox({ userId: USER, runId, job: { language: 'bash', code: 'cat notes/plan.md' } });
		expect(r.stdout).toBe('# plan\n');
	}, 30_000);
});

describe('run controls', () => {
	it('refuses a killed run and another account', async () => {
		const runId = newRun();
		await store.ensureSandboxRun({ runId, userId: USER, backend: 'local' });
		await store.killSandboxRun(runId, 'owner pressed stop');
		await expect(executeInSandbox({ userId: USER, runId, job: { language: 'python', code: 'print(1)' } })).rejects.toMatchObject({
			status: 409,
			code: 'run_killed',
		});
		await expect(executeInSandbox({ userId: OTHER, runId, job: { language: 'python', code: 'print(1)' } })).rejects.toMatchObject({ status: 403 });
	});

	it('kills a run that keeps failing', async () => {
		const runId = newRun();
		await store.ensureSandboxRun({ runId, userId: USER, backend: 'local' });
		await holder.db.sql`update sandbox_runs set failures_streak = ${ANOMALY.failureStreak} where run_id = ${runId}`;
		await expect(executeInSandbox({ userId: USER, runId, job: { language: 'python', code: 'print(1)' } })).rejects.toMatchObject({
			code: 'run_killed',
			message: expect.stringMatching(/anomaly guard/),
		});
		const run = await store.getSandboxRun(runId);
		expect(run.status).toBe('killed');
		expect(run.killed_reason).toMatch(/in a row failed/);
	});

	it('kills a run that keeps tripping the bridge refusals', async () => {
		const runId = newRun();
		await store.ensureSandboxRun({ runId, userId: USER, backend: 'local' });
		await holder.db.sql`update sandbox_runs set refusals = ${ANOMALY.refusals} where run_id = ${runId}`;
		await expect(executeInSandbox({ userId: USER, runId, job: { language: 'python', code: 'print(1)' } })).rejects.toMatchObject({ code: 'run_killed' });
	});
});

// A runner speaking the real protocol: it checks the token, reads the job and
// the inline workspace, and streams events. It answers like the real runner
// would for `print(sum(...))` over the workspace it was sent, without running
// a process, so the API half of the protocol is what is under test here.
function fakeRunner() {
	const seen = [];
	const server = http.createServer((req, res) => {
		if (req.headers['x-sandbox-token'] !== 'runner-secret') {
			res.writeHead(401).end('bad token');
			return;
		}
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			const msg = JSON.parse(body);
			seen.push({ url: req.url, msg });
			res.writeHead(200, { 'content-type': 'application/x-ndjson' });
			const send = (ev) => res.write(`${JSON.stringify(ev)}\n`);
			send({ type: 'started', isolation: 'root' });
			send({ type: 'stdout', data: '45\n' });
			const inputs = (msg.workspace.files || []).map((f) => f.path);
			send({
				type: 'result',
				exitCode: 0,
				signal: null,
				timedOut: false,
				killed: false,
				outputFlood: false,
				wallMs: 1500,
				cpuMs: 40,
				peakMemoryMb: 12,
				stdout: { text: '45\n', truncated: false, bytes: 3 },
				stderr: { text: '', truncated: false, bytes: 0 },
				files: [{ path: 'out/inputs.json', data_base64: Buffer.from(JSON.stringify(inputs)).toString('base64') }],
				deleted: [],
				skipped: [],
				isolation: 'root',
			});
			res.end();
		});
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

describe('cloud backend over the runner protocol', () => {
	let runner;
	beforeAll(async () => {
		runner = await fakeRunner();
		process.env.SANDBOX_RUNNER_URL = `${runner.url}/{size}`;
		process.env.SANDBOX_RUNNER_TOKEN = 'runner-secret';
	});
	afterAll(async () => {
		delete process.env.SANDBOX_RUNNER_URL;
		delete process.env.SANDBOX_RUNNER_TOKEN;
		await new Promise((r) => runner.server.close(r));
	});

	it('refuses up front when the balance cannot cover the worst case', async () => {
		await expect(
			executeInSandbox({ userId: PRO_USER, runId: newRun(), job: { language: 'python', code: 'print(sum(range(10)))' } }),
		).rejects.toMatchObject({ status: 402, code: 'insufficient_credits' });
		expect(runner.seen).toHaveLength(0);
	});

	it('posts the job to the sized runner, saves returned files and debits once', async () => {
		await holder.db.sql`insert into credit_accounts (user_id, balance_usd) values (${PRO_USER}, 5) on conflict (user_id) do update set balance_usd = 5`;
		const runId = newRun();
		const r = await executeInSandbox({
			userId: PRO_USER,
			runId,
			files: [{ path: 'data.csv', content: 'a\n1\n' }],
			job: { language: 'python', code: 'print(sum(range(10)))' },
		});
		expect(r).toMatchObject({ status: 'succeeded', backend: 'cloudrun', isolation: 'root', stdout: '45\n' });
		expect(r.cost_usd).toBeGreaterThan(0);
		expect(r.charged_usd).toBe(r.cost_usd);

		const [call] = runner.seen;
		expect(call.url).toBe('/m/exec');
		expect(call.msg.job).toEqual({ kind: 'code', language: 'python', code: 'print(sum(range(10)))' });
		expect(call.msg.workspace.files.map((f) => f.path)).toEqual(['data.csv']);
		expect(call.msg.bridge.url).toBe('https://three.ws/api/sandbox/bridge');
		expect(call.msg.bridge.token).toMatch(/^v1\./);
		expect(call.msg.limits.plan).toBe('pro');

		const saved = await readWorkspaceFile({ userId: PRO_USER, runId, path: 'out/inputs.json' });
		expect(JSON.parse(saved.content)).toEqual(['data.csv']);

		const ledger = await holder.db.sql`select * from credit_ledger where ref_id = ${r.execution_id}`;
		expect(ledger).toHaveLength(1);
		expect(ledger[0]).toMatchObject({ kind: 'spend', action: 'sandbox_execution', idempotency_key: `sandbox:${r.execution_id}` });
		const [acct] = await holder.db.sql`select balance_usd from credit_accounts where user_id = ${PRO_USER}`;
		expect(Number(acct.balance_usd)).toBeCloseTo(5 - r.cost_usd, 6);
		const run = await store.getSandboxRun(runId);
		expect(run.backend).toBe('cloudrun');
		expect(Number(run.cost_usd)).toBeCloseTo(r.cost_usd, 6);
	});
});
