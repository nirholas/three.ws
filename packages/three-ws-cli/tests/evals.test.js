// `three-ws evals` and `three-ws runs export|replay` against a real local HTTP
// server that speaks the v1 wire format (JSON envelope, SSE progress, NDJSON).

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { readSse } from '../src/commands/evals.js';

const AGENT = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const EVAL = '33333333-3333-4333-8333-333333333333';

const report = (failed) => ({
	schema: 'three-ws/eval-report@1',
	suite: { name: 'smoke', version: 1, title: 'Smoke' },
	config: { label: 'Scout', version: 'abc123def456' },
	model: 'vertex/google/gemini-2.5-flash',
	summary: { tasks: 2, passed: 2 - failed, failed, errored: 0, score: failed ? 0.5 : 1, passRate: failed ? 0.5 : 1, costUsd: 0.002, avgSteps: 2 },
	tasks: [
		{ id: 'a', status: 'passed', trace: { steps: 2 } },
		{ id: 'b', status: failed ? 'failed' : 'passed', trace: { steps: 3 } },
	],
});

let failNext = false;
let server;
let origin;
let seen;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-evals-'));

const json = (res, status, body) => {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
};

beforeAll(async () => {
	server = http.createServer(async (req, res) => {
		const url = new URL(req.url, 'http://x');
		let body = '';
		for await (const chunk of req) body += chunk;
		seen = { method: req.method, path: url.pathname, query: url.search, accept: req.headers.accept, body: body ? JSON.parse(body) : null };
		if (req.headers.authorization !== 'Bearer sk_live_ok') return json(res, 401, { error: 'unauthorized' });
		if (url.pathname === '/api/agents') return json(res, 200, { agents: [{ id: AGENT, name: 'Scout' }] });
		const base = `/api/v1/agents/${AGENT}`;
		if (url.pathname === `${base}/evals` && req.method === 'GET') {
			return json(res, 200, { data: [{ id: EVAL, suite: 'smoke', status: 'completed', score: 1, model: 'm', createdAt: '2026-11-04T10:00:00Z' }], meta: { hasMore: false } });
		}
		if (url.pathname === `${base}/evals/${EVAL}`) return json(res, 200, { data: { id: EVAL, status: 'completed', report: report(0) } });
		if (url.pathname === `${base}/evals` && req.method === 'POST') {
			if (seen.body.suite === 'nope') return json(res, 400, { error: { code: 'invalid_parameter', message: 'suite is required. Suites: smoke.' } });
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
			const failed = failNext ? 1 : 0;
			send('start', { suite: 'smoke', model: 'm', tasks: 2 });
			send('task', { index: 0, total: 2, id: 'a', status: 'passed', steps: 2, latencyMs: 10, failedChecks: [] });
			send('task', { index: 1, total: 2, id: 'b', status: failed ? 'failed' : 'passed', steps: 3, latencyMs: 12, failedChecks: failed ? ['expected tool get_price'] : [] });
			send('done', { id: EVAL, status: 'completed', report: report(failed) });
			return res.end();
		}
		if (url.pathname === `${base}/runs/${RUN}/trajectory`) {
			res.writeHead(200, { 'content-type': 'application/x-ndjson' });
			return res.end('{"type":"run"}\n{"type":"step","seq":1}\n');
		}
		if (url.pathname === `${base}/runs/${RUN}/replay` && req.method === 'GET') {
			return json(res, 200, { data: { schema: 'three-ws/run-replay@1', runId: RUN, goal: 'g', status: 'completed', receiptChain: { verified: true, checked: 3 }, calls: [{ index: 0, tool: 'get_price', status: 'ok' }], signature: 'sig' } });
		}
		if (url.pathname === `${base}/runs/${RUN}/replay` && req.method === 'POST') {
			return json(res, 201, { data: { mode: 'preview', runId: RUN, model: seen.body.model, status: 'completed', recorded: { tools: ['get_price'] }, replayed: { tools: ['get_price'] }, sameSequence: true, executed: [] } });
		}
		return json(res, 404, { error: { code: 'not_found', message: 'nope' } });
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((r) => server.close(r)));
afterEach(() => vi.restoreAllMocks());

function envWith() {
	const home = fs.mkdtempSync(path.join(scratch, 'home-'));
	return { home, platform: 'linux', cwd: home, vars: { THREE_WS_NO_BROWSER: '1', NO_COLOR: '1', XDG_CONFIG_HOME: path.join(home, '.config'), THREE_WS_API_KEY: 'sk_live_ok' } };
}

async function cli(argv) {
	let out = '';
	let err = '';
	vi.spyOn(process.stdout, 'write').mockImplementation((c) => ((out += c.toString()), true));
	vi.spyOn(process.stderr, 'write').mockImplementation((c) => ((err += c.toString()), true));
	const code = await main([...argv, '--origin', origin], envWith());
	vi.restoreAllMocks();
	return { code, out, err };
}

describe('evals', () => {
	it('run streams progress, exits 0 when every task passes, and writes the report', async () => {
		failNext = false;
		const file = path.join(scratch, 'report.json');
		const r = await cli(['evals', 'run', '--agent', 'Scout', '--suite', 'smoke', '--out', file]);
		expect(r.code).toBe(0);
		expect(seen.accept).toBe('text/event-stream');
		expect(seen.body).toEqual({ suite: 'smoke' });
		expect(r.out).toContain('[2/2]');
		expect(JSON.parse(fs.readFileSync(file, 'utf8')).schema).toBe('three-ws/eval-report@1');
	});

	it('run exits 1 and names the failed check when a task fails', async () => {
		failNext = true;
		const r = await cli(['evals', 'run', '--agent', 'Scout', '--suite', 'smoke', '--model', 'vertex/google/gemini-2.5-flash']);
		failNext = false;
		expect(r.code).toBe(1);
		expect(seen.body.model).toBe('vertex/google/gemini-2.5-flash');
		expect(r.out).toContain('expected tool get_price');
	});

	it('run --json prints one document', async () => {
		const r = await cli(['evals', 'run', '--agent', 'Scout', '--suite', 'smoke', '--json']);
		expect(JSON.parse(r.out).report.summary.tasks).toBe(2);
	});

	it('a rejected suite is a usage-class error from the server', async () => {
		const r = await cli(['evals', 'run', '--agent', 'Scout', '--suite', 'nope', '--json']);
		expect(r.code).toBe(2);
	});

	it('run without --suite is exit 2', async () => {
		expect((await cli(['evals', 'run', '--agent', 'Scout'])).code).toBe(2);
	});

	it('list and show read the history', async () => {
		const list = await cli(['evals', 'list', '--agent', 'Scout', '--suite', 'smoke', '--json']);
		expect(seen.query).toBe('?suite=smoke');
		expect(JSON.parse(list.out).evals).toHaveLength(1);
		const show = await cli(['evals', 'show', EVAL, '--agent', 'Scout']);
		expect(show.code).toBe(0);
		expect(show.out).toContain('Smoke');
	});
});

describe('runs export and replay', () => {
	it('export writes the trajectory JSONL to --out', async () => {
		const file = path.join(scratch, 'traj.jsonl');
		const r = await cli(['runs', 'export', RUN, '--agent', 'Scout', '--format', 'jsonl', '--out', file]);
		expect(r.code).toBe(0);
		expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
	});

	it('export without --out prints the lines to stdout', async () => {
		const r = await cli(['runs', 'export', RUN, '--agent', 'Scout']);
		expect(r.out.trim().split('\n').map((l) => JSON.parse(l).type)).toEqual(['run', 'step']);
	});

	it('replay is a GET, and --model makes it a preview POST', async () => {
		const det = await cli(['runs', 'replay', RUN, '--agent', 'Scout', '--json']);
		expect(seen.method).toBe('GET');
		expect(JSON.parse(det.out).signature).toBe('sig');
		const pre = await cli(['runs', 'replay', RUN, '--agent', 'Scout', '--model', 'vertex/google/gemini-2.5-flash', '--json']);
		expect(seen.method).toBe('POST');
		expect(JSON.parse(pre.out).sameSequence).toBe(true);
	});

	it('rejects a format other than jsonl', async () => {
		expect((await cli(['runs', 'export', RUN, '--agent', 'Scout', '--format', 'csv'])).code).toBe(2);
	});
});

describe('readSse', () => {
	it('reassembles events split across chunks', async () => {
		async function* body() {
			yield Buffer.from('event: task\ndata: {"a"');
			yield Buffer.from(':1}\n\nevent: done\ndata: {"b":2}\n\n');
		}
		const got = [];
		for await (const e of readSse(body())) got.push(e);
		expect(got).toEqual([{ event: 'task', data: { a: 1 } }, { event: 'done', data: { b: 2 } }]);
	});
});
