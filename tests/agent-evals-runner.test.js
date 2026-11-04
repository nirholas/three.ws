// Agent evals end to end without a database: every check type passing and
// failing, a real suite run through the real agent loop against a local
// OpenAI-compatible SSE server, the cost cap, deterministic replay, the
// preview re-run that must execute nothing with a side effect, trajectory
// redaction, and the request validation the API route relies on.

import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck, scoreTask } from '../api/_lib/evals/checks.js';
import { REPORT_SCHEMA, runSuite } from '../api/_lib/evals/runner.js';
import { presetConfig } from '../api/_lib/evals/configs.js';
import { executeConversation, systemMessages } from '../api/_lib/evals/execute.js';
import { buildReplay, buildTrajectory, redactText, redactValue, rerunPreview, sequenceSignature, toolSequence } from '../api/_lib/evals/replay.js';
import { evalCatalog, resolveEvalRequest, serializeEval } from '../api/_lib/evals/service.js';
import { EVAL_ROUTES } from '../api/_lib/evals/routes.js';
import { ROUTES } from '../api/v1/rest.js';

// ── a real local model: OpenAI-compatible streaming ─────────────────────────

let server;
let rung;
let script = [];
let requests = [];

const sse = (res, chunks) => {
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
	res.write('data: [DONE]\n\n');
	res.end();
};
const say = (content) => [{ choices: [{ delta: { content } }] }, { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } }];
const call = (name, args) => [
	{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name, arguments: JSON.stringify(args) } }] } }] },
	{ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
];

beforeAll(async () => {
	server = http.createServer(async (req, res) => {
		let body = '';
		for await (const chunk of req) body += chunk;
		requests.push(JSON.parse(body));
		sse(res, script.shift() || say('done'));
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	rung = { name: 'local-test', url: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, key: 'k', model: 'local-model' };
});
afterAll(() => new Promise((r) => server.close(r)));

// ── checks ──────────────────────────────────────────────────────────────────

const trace = (over = {}) => ({
	answer: 'SOL trades at $142.10 right now.',
	toolCalls: [{ tool: 'token_price', args: { query: 'SOL' } }],
	costUsd: 0.001,
	steps: 3,
	...over,
});

describe('every check type', () => {
	const cases = [
		['tool_called', { type: 'tool_called', tool: 'token_price', args: { query: 'sol' } }, { type: 'tool_called', tool: 'token_price', args: { query: 'btc' } }],
		['tool_not_called', { type: 'tool_not_called', tool: 'web_search' }, { type: 'tool_not_called', tool: 'token_price' }],
		['answer_contains', { type: 'answer_contains', all: ['sol'] }, { type: 'answer_contains', all: ['bitcoin'] }],
		['answer_not_contains', { type: 'answer_not_contains', any: ['guaranteed'] }, { type: 'answer_not_contains', any: ['trades'] }],
		['answer_matches', { type: 'answer_matches', pattern: '\\$\\d+' }, { type: 'answer_matches', pattern: '^never$' }],
		['cost_below', { type: 'cost_below', usd: 0.01 }, { type: 'cost_below', usd: 0.0001 }],
		['steps_below', { type: 'steps_below', max: 5 }, { type: 'steps_below', max: 2 }],
	];
	for (const [name, pass, fail] of cases) {
		it(`${name} passes and fails on the right trace`, () => {
			expect(runCheck(pass, trace()).passed).toBe(true);
			const bad = runCheck(fail, trace());
			expect(bad.passed).toBe(false);
			expect(bad.detail.length).toBeGreaterThan(5);
		});
	}

	it('a task scores the fraction of checks that passed, and fails unless all did', () => {
		const scored = scoreTask({ checks: [cases[0][1], cases[2][2]] }, trace());
		expect(scored.passed).toBe(false);
		expect(scored.score).toBe(0.5);
	});
});

// ── a suite run through the real loop ───────────────────────────────────────

const suite = {
	name: 'unit',
	version: 1,
	title: 'Unit',
	defaults: { temperature: 0.2, maxToolRounds: 3 },
	tasks: [
		{ id: 'greet', title: 'Greets', prompt: 'Say hello.', checks: [{ type: 'answer_contains', any: ['hello'] }] },
		{ id: 'wrong', title: 'Wrong answer', prompt: 'Say hello.', checks: [{ type: 'answer_contains', any: ['goodbye'] }] },
		{ id: 'third', title: 'Third', prompt: 'Say hello.', checks: [{ type: 'steps_below', max: 9 }] },
	],
};

describe('runSuite', () => {
	it('produces a three-ws/eval-report@1 report and scores a failing case as failed', async () => {
		script = [say('hello there'), say('hello again'), say('hello')];
		requests = [];
		const report = await runSuite(suite, presetConfig('default', suite.defaults), { rung, model: 'local-model' });
		expect(report.schema).toBe(REPORT_SCHEMA);
		expect(report.tasks.map((t) => t.status)).toEqual(['passed', 'failed', 'passed']);
		expect(report.summary).toMatchObject({ tasks: 3, passed: 2, failed: 1, errored: 0 });
		expect(report.summary.score).toBeCloseTo(2 / 3, 3);
		expect(requests).toHaveLength(3);
		expect(requests[0].model).toBe('local-model');
		expect(report.tasks[1].checks[0].passed).toBe(false);
	});

	it('stops before the next task once measured spend reaches the cap', async () => {
		script = [say('hello'), say('hello'), say('hello')];
		const priced = { ...rung, name: 'openai', model: 'gpt-4o-mini' };
		const report = await runSuite(suite, presetConfig('default', suite.defaults), { rung: priced, model: 'gpt-4o-mini', maxCostUsd: 1e-9 });
		expect(report.summary.costUsd).toBeGreaterThan(1e-9);
		expect(report.tasks).toHaveLength(1);
		expect(report.truncated).toMatchObject({ reason: 'cost_cap', maxCostUsd: 1e-9, skipped: ['wrong', 'third'] });
	});

	it('reports a lane failure as errored, not as a failed case', async () => {
		const dead = { ...rung, url: 'http://127.0.0.1:1/v1/chat/completions' };
		const report = await runSuite({ ...suite, tasks: [suite.tasks[0]] }, presetConfig('default'), { rung: dead, model: 'x', deadlineMs: 4000 });
		expect(report.tasks[0].status).toBe('errored');
		expect(report.summary.score).toBeNull();
	}, 30_000);
});

// ── replay ──────────────────────────────────────────────────────────────────

const run = { id: 'r1', agentId: 'a1', goal: 'Price SOL', status: 'completed', model: 'm', result: 'It is $142.', temperature: 0.2, toolsAllowed: ['token_price'] };
const steps = [
	{ seq: 1, kind: 'status', output: { status: 'running' } },
	{ seq: 2, kind: 'model_call', output: { content: '', toolCalls: [{ name: 'token_price' }] } },
	{ seq: 3, kind: 'tool_call', tool: 'token_price', input: { query: 'SOL' } },
	{ seq: 4, kind: 'tool_result', tool: 'token_price', input: { query: 'SOL' }, output: { usd: 142 } },
	{ seq: 5, kind: 'model_call', output: { content: 'It is $142.', toolCalls: [] } },
	{ seq: 6, kind: 'final', output: { result: 'It is $142.' } },
];

describe('replay', () => {
	it('is deterministic and signs the recorded tool sequence', () => {
		const a = buildReplay(run, steps);
		const b = buildReplay(run, steps);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		expect(a.calls.map((c) => c.tool)).toEqual(['token_price']);
		expect(a.signature).toBe(sequenceSignature(toolSequence(steps)));
		const other = steps.map((s) => (s.kind === 'tool_call' ? { ...s, input: { query: 'BTC' } } : s));
		expect(buildReplay(run, other).signature).not.toBe(a.signature);
	});

	it('preview re-run reproduces the sequence and runs no unlisted tool', async () => {
		script = [call('solana_transfer', { recipient: 'x', amount: 1 }), say('I cannot send funds from a preview.')];
		const out = await rerunPreview({ run, steps, systemPrompt: 'You are a test agent.', model: 'local-model', rung });
		expect(out.mode).toBe('preview');
		expect(out.executed).toEqual([]);
		expect(out.sameSequence).toBe(false);
		expect(out.replayed.signature).not.toBe(out.recorded.signature);
	});

	it('a sandboxed side-effect tool answers with a preview and executes nothing', async () => {
		script = [call('solana_transfer', { recipient: '11111111111111111111111111111111', amount: 0.5 }), say('Awaiting approval.')];
		const sandbox = [{ name: 'solana_transfer', description: 'Prepare a transfer', parameters: { type: 'object', properties: { recipient: { type: 'string' }, amount: { type: 'number' } } }, preview: { status: 'awaiting_owner_approval' } }];
		const t = await executeConversation({ messages: [...systemMessages('x', { sandboxed: true }), { role: 'user', content: 'send' }], rung, allowed: ['solana_transfer'], sandbox, previewOnly: true });
		expect(t.toolCalls[0]).toMatchObject({ tool: 'solana_transfer', sandboxed: true });
		expect(JSON.stringify(t.toolCalls[0])).toContain('awaiting_owner_approval');
	});
});

// ── trajectory ──────────────────────────────────────────────────────────────

describe('trajectory export', () => {
	const secret = 'Bearer abcdefghijklmnop1234567890';
	const keypair = '5'.repeat(88);
	const dirty = [
		{ seq: 1, kind: 'tool_call', tool: 'http_get', input: { url: 'https://x.test', headers: { authorization: secret }, api_key: 'sk_live_abcdef123456' } },
		{ seq: 2, kind: 'tool_result', tool: 'recall_memory', output: { memories: ['my private diary entry'] } },
		{ seq: 3, kind: 'tool_result', tool: 'http_get', output: { body: `key ${keypair} and sk-abcdefghijklmnopqrstuvwxyz` } },
	];
	const lines = buildTrajectory({ ...run, goal: `use ${secret}` }, dirty);
	const text = lines.join('\n');

	it('writes a header and one valid JSON line per step', () => {
		expect(lines).toHaveLength(4);
		expect(JSON.parse(lines[0])).toMatchObject({ type: 'run', schema: 'three-ws/trajectory@1' });
		expect(lines.slice(1).map((l) => JSON.parse(l).seq)).toEqual([1, 2, 3]);
	});

	it('redacts secrets, key material and memory recalls', () => {
		expect(text).not.toContain('abcdefghijklmnop1234567890');
		expect(text).not.toContain('sk_live_abcdef123456');
		expect(text).not.toContain(keypair);
		expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
		expect(text).not.toContain('private diary entry');
		expect(JSON.parse(lines[2]).output).toEqual({ redacted: 'memory' });
	});

	it('redactText and redactValue leave ordinary text alone', () => {
		expect(redactText('SOL is $142.10 today')).toBe('SOL is $142.10 today');
		expect(redactValue({ a: ['plain', 3], b: { c: 'ok' } })).toEqual({ a: ['plain', 3], b: { c: 'ok' } });
	});
});

// ── service validation and routes ───────────────────────────────────────────

describe('request validation', () => {
	const agent = { id: 'a1', name: 'Scout', description: 'A scout.', persona_prompt: null, meta: {} };

	it('rejects a suite that is not installed', () => {
		expect(() => resolveEvalRequest(agent, { suite: '../etc/passwd' })).toThrow(/suite is required/);
		expect(() => resolveEvalRequest(agent, { suite: 'nope' })).toThrow(/Suites:/);
	});

	it('rejects a model that is not in the catalog', () => {
		expect(() => resolveEvalRequest(agent, { suite: 'smoke', model: 'not-a-model' })).toThrow(/catalog/);
	});

	it('serializes a row without leaking the report', () => {
		const out = serializeEval({ id: 'e', agent_id: 'a', suite: 's', suite_version: 1, model: 'm', config_version: 'c', status: 'completed', score: '0.75', pass_rate: '0.5', cost_usd: '0.01', summary: {}, report: { big: true }, created_at: 't', finished_at: 't' });
		expect(out.score).toBe(0.75);
		expect(out).not.toHaveProperty('report');
	});

	it('the catalog lists every installed suite with its tasks', async () => {
		const cat = await evalCatalog();
		const smoke = cat.suites.find((s) => s.name === 'smoke');
		expect(smoke.tasks.length).toBeGreaterThan(0);
	});
});

describe('route table', () => {
	it('mounts the eval and replay routes on the v1 router with the right scopes', () => {
		const find = (m, p) => ROUTES.find((r) => r.method === m && r.path === p);
		expect(find('POST', '/agents/:id/evals').scope).toBe('agents:write');
		expect(find('GET', '/agents/:id/evals').scope).toBe('agents:read');
		expect(find('GET', '/agents/:id/runs/:run/trajectory')).toBeTruthy();
		expect(find('POST', '/agents/:id/runs/:run/replay').scope).toBe('agents:write');
		expect(EVAL_ROUTES.every((r) => ROUTES.includes(r))).toBe(true);
	});
});
