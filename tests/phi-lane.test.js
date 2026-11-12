// The Phi brain lane (api/_lib/phi-lane.js, docs/phi-brain-lane.md): request
// mapping, tool-call parsing, streaming through the tool loop's reader, the
// routing table, and the fallback to the platform chain when the worker is
// cold or down.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const lane = await import('../api/_lib/phi-lane.js');
const { llmComplete, providerChain } = await import('../api/_lib/llm.js');
const { streamRound, modelRung, providerChainFor } = await import('../api/_lib/llm-tool-chain.js');
const { MODEL_CATALOG } = await import('../api/_lib/chat-models.js');

const TOUCHED = ['PHI_WORKER_URL', 'PHI_WORKER_KEY', 'GCP_RECONSTRUCTION_KEY', 'PHI_TIMEOUT_MS', 'PHI_ROUTED_TASKS', 'GROQ_API_KEY', 'VERTEX_CLAUDE_PRIMARY'];
let saved;
let realFetch;
beforeEach(() => {
	saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
	for (const k of TOUCHED) delete process.env[k];
	realFetch = globalThis.fetch;
});
afterEach(() => {
	for (const k of TOUCHED) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	globalThis.fetch = realFetch;
	vi.restoreAllMocks();
});

const URL_BASE = 'https://model-phi-abc-uc.a.run.app';
const configure = (extra = {}) => Object.assign(process.env, { PHI_WORKER_URL: `${URL_BASE}/`, PHI_WORKER_KEY: 'phi-key', ...extra });

function sse(events) {
	const body = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
	return new Response(new ReadableStream({
		start(c) {
			c.enqueue(new TextEncoder().encode(body));
			c.close();
		},
	}), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const completion = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('configuration', () => {
	it('is dormant until PHI_WORKER_URL is set', () => {
		expect(lane.phiConfig()).toBeNull();
		expect(lane.phiRoutesTask('feedback_triage')).toBe(false);
		expect(providerChain({ task: 'feedback_triage' }).some((p) => p.name === 'phi')).toBe(false);
		expect(modelRung(lane.PHI_MODEL)).toBeNull();
	});

	it('normalizes the URL and falls back to the shared worker key', () => {
		process.env.PHI_WORKER_URL = `${URL_BASE}/v1/`;
		process.env.GCP_RECONSTRUCTION_KEY = 'shared';
		const cfg = lane.phiConfig();
		expect(cfg.chatUrl).toBe(`${URL_BASE}/v1/chat/completions`);
		expect(cfg.key).toBe('shared');
		expect(cfg.timeoutMs).toBe(lane.PHI_DEFAULT_TIMEOUT_MS);
	});

	it('is a catalog model with tools, so an agent can pick it by name', () => {
		expect(MODEL_CATALOG[lane.PHI_MODEL]).toMatchObject({ provider: 'phi', tools: true });
		configure();
		expect(modelRung(lane.PHI_MODEL)).toMatchObject({ name: 'phi', url: `${URL_BASE}/v1/chat/completions`, key: 'phi-key', model: lane.PHI_MODEL });
		expect(providerChainFor(lane.PHI_MODEL)[0].name).toBe('phi');
	});
});

describe('request mapping', () => {
	it('builds an OpenAI chat body for the worker with its bearer key', () => {
		configure();
		const p = lane.phiProvider(lane.phiConfig());
		expect(p.name).toBe('phi');
		expect(p.url).toBe(`${URL_BASE}/v1/chat/completions`);
		expect(p.headers.authorization).toBe('Bearer phi-key');
		expect(p.buildBody('Classify.', 'the text', 300)).toEqual({
			model: lane.PHI_MODEL,
			max_tokens: 300,
			temperature: 0,
			messages: [{ role: 'system', content: 'Classify.' }, { role: 'user', content: 'the text' }],
		});
		expect(p.buildBody(null, 'hi', 10).messages).toEqual([{ role: 'user', content: 'hi' }]);
		expect(p.extractText({ choices: [{ message: { content: 'ok' } }] })).toBe('ok');
		expect(p.extractUsage({ usage: { prompt_tokens: 3, completion_tokens: 2 } })).toEqual({ input: 3, output: 2 });
	});

	it('leads the llmComplete chain only for routed task types', () => {
		configure({ GROQ_API_KEY: 'g', PHI_ROUTED_TASKS: 'feedback_triage' });
		expect(providerChain({ task: 'feedback_triage' })[0].name).toBe('phi');
		expect(providerChain({ task: 'bounty_triage' })[0].name).not.toBe('phi');
		expect(providerChain({}).some((p) => p.name === 'phi')).toBe(false);
		expect(providerChain({ preferPhi: true })[0].name).toBe('phi');
	});

	it('routes the task types the evaluation passed by default', () => {
		configure();
		for (const t of lane.PHI_ROUTED_TASKS) expect(lane.phiRoutesTask(t)).toBe(true);
		expect(lane.phiRoutesTask('unknown_task')).toBe(false);
	});
});

describe('tool-call parsing', () => {
	const names = new Set(['playAnimation', 'setBgColor']);

	it('reads the native block with nested arrays intact', () => {
		const text = '<|tool_call|>[{"name": "playAnimation", "arguments": {"name": "dance", "tags": ["a", "b"]}}]<|/tool_call|>';
		expect(lane.parsePhiToolCalls(text, names)).toEqual({ content: '', calls: [{ name: 'playAnimation', args: '{"name":"dance","tags":["a","b"]}' }] });
	});

	it('reads the functools form with a parameters key', () => {
		expect(lane.parsePhiToolCalls('functools[{"name": "setBgColor", "parameters": {"value": "#000"}}]', names).calls).toEqual([{ name: 'setBgColor', args: '{"value":"#000"}' }]);
	});

	it('keeps text before a call as content', () => {
		const out = lane.parsePhiToolCalls('Sure! <|tool_call|>[{"name": "playAnimation", "arguments": {"name": "wave"}}]', names);
		expect(out.content).toBe('Sure!');
		expect(out.calls[0].name).toBe('playAnimation');
	});

	it.each([
		'<|tool_call|>[{"name": "playAnimation", "arguments": {"name": "wave"}}}]',
		'<|tool_call|>[]{ "name": "playAnimation", "arguments": {"name": "wave"} }',
		'<|tool_call|><|tool_call|>[{"name": "playAnimation", "arguments": {"name": "wave"}}]<|/tool_call|>',
	])('repairs the slips Phi-4-mini makes inside a marked block: %s', (text) => {
		expect(lane.parsePhiToolCalls(text, names)).toEqual({ content: '', calls: [{ name: 'playAnimation', args: '{"name":"wave"}' }] });
	});

	it('never repairs an unmarked array', () => {
		const answer = '[{"name": "playAnimation", "arguments": {}}}]';
		expect(lane.parsePhiToolCalls(answer, names)).toEqual({ content: answer, calls: [] });
	});

	it('leaves a JSON answer alone when it names no offered tool', () => {
		const answer = '[{"name": "positive", "arguments": {}}]';
		expect(lane.parsePhiToolCalls(answer, names)).toEqual({ content: answer, calls: [] });
		expect(lane.parsePhiToolCalls('Hello there.', names)).toEqual({ content: 'Hello there.', calls: [] });
	});
});

describe('streaming through the tool loop reader', () => {
	it('assembles streamed tool_calls from the worker', async () => {
		configure();
		globalThis.fetch = vi.fn(async () => sse([
			{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'playAnimation', arguments: '{"name": "dance"}' } }] } }] },
			{ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 50, completion_tokens: 12 } },
			'[DONE]',
		]));
		const out = await streamRound(modelRung(lane.PHI_MODEL), { messages: [{ role: 'user', content: 'dance' }], tools: [{ type: 'function', function: { name: 'playAnimation', parameters: {} } }] });
		expect(out.toolCalls).toEqual([{ id: 'call_1', name: 'playAnimation', args: '{"name": "dance"}' }]);
		const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
		expect(body).toMatchObject({ model: lane.PHI_MODEL, stream: true, stream_options: { include_usage: true }, tool_choice: 'auto' });
		expect(out.usage).toMatchObject({ input: 50, output: 12 });
	});

	it('turns a tool call that leaked into streamed text into a real call', async () => {
		configure();
		globalThis.fetch = vi.fn(async () => sse([
			{ choices: [{ delta: { content: '<|tool_call|>[{"name": "playAnimation", ' } }] },
			{ choices: [{ delta: { content: '"arguments": {"name": "wave"}}]<|/tool_call|>' } }] },
			'[DONE]',
		]));
		const out = await streamRound(modelRung(lane.PHI_MODEL), { messages: [{ role: 'user', content: 'wave' }], tools: [{ type: 'function', function: { name: 'playAnimation', parameters: {} } }] });
		expect(out.content).toBe('');
		expect(out.toolCalls).toEqual([{ id: 'call_phi_0', name: 'playAnimation', args: '{"name":"wave"}' }]);
	});

	it('gives up on a worker that never sends headers within its timeout', async () => {
		configure({ PHI_TIMEOUT_MS: '150' });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		globalThis.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
			init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
		}));
		const started = Date.now();
		await expect(streamRound(modelRung(lane.PHI_MODEL), { messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(3_000);
		expect(warn.mock.calls.some((c) => /\[phi\].*falling back/.test(c.join(' ')))).toBe(true);
	});
});

describe('fallback', () => {
	it('falls back to the platform chain on timeout and logs it', async () => {
		configure({ GROQ_API_KEY: 'g', PHI_TIMEOUT_MS: '150', PHI_ROUTED_TASKS: 'feedback_triage' });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		globalThis.fetch = vi.fn((url, init) => {
			if (String(url).startsWith(URL_BASE)) {
				return new Promise((_resolve, reject) => {
					init.signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })));
				});
			}
			return Promise.resolve(completion('{"severity": 40, "kind": "bug"}'));
		});
		const out = await llmComplete({ system: 'Classify.', user: 'broken', maxTokens: 100, task: 'feedback_triage' });
		expect(globalThis.fetch.mock.calls[0][0]).toBe(`${URL_BASE}/v1/chat/completions`);
		expect(out.provider).not.toBe('phi');
		expect(out.text).toContain('severity');
		expect(warn.mock.calls.some((c) => /\[llm\] phi lane fell back to /.test(c.join(' ')))).toBe(true);
	});

	it('falls back on an HTTP error too', async () => {
		configure({ GROQ_API_KEY: 'g', PHI_ROUTED_TASKS: 'feedback_triage' });
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		globalThis.fetch = vi.fn(async (url) => (String(url).startsWith(URL_BASE) ? new Response('no healthy upstream', { status: 503 }) : completion('ok')));
		const out = await llmComplete({ system: 's', user: 'u', task: 'feedback_triage' });
		expect(out.provider).not.toBe('phi');
	});

	it('answers from Phi when the worker is up', async () => {
		configure({ GROQ_API_KEY: 'g', PHI_ROUTED_TASKS: 'feedback_triage' });
		globalThis.fetch = vi.fn(async () => completion('from phi'));
		const out = await llmComplete({ system: 's', user: 'u', task: 'feedback_triage' });
		expect(out).toMatchObject({ provider: 'phi', model: lane.PHI_MODEL, text: 'from phi' });
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});
});

describe('stream hygiene and cold starts', () => {
	it('streams plain text live but never shows raw call syntax', () => {
		const shown = [];
		const gate = lane.phiContentGate((d) => shown.push(d));
		for (const d of ['Sure', ', here you go. ', '<|tool_', 'call|>[{"name": "x"}]']) gate.push(d);
		gate.end({ content: 'Sure, here you go.', toolCalls: [{ id: 'call_phi_0', name: 'x', args: '{}' }] });
		expect(shown.join('')).toBe('Sure, here you go. ');
		const quiet = [];
		const g2 = lane.phiContentGate((d) => quiet.push(d));
		for (const d of ['<|tool', '_call|>[{"name": "x", "arguments": {}}]']) g2.push(d);
		g2.end({ content: '', toolCalls: [{ id: 'call_phi_0', name: 'x', args: '{}' }] });
		expect(quiet).toEqual([]);
	});

	it('sits the lane out for a cold start after it stalls', async () => {
		configure({ GROQ_API_KEY: 'g', PHI_TIMEOUT_MS: '150', PHI_ROUTED_TASKS: 'feedback_triage' });
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		globalThis.fetch = vi.fn((url, init) => (String(url).startsWith(URL_BASE)
			? new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))))
			: Promise.resolve(completion('ok'))));
		await llmComplete({ system: 's', user: 'u', task: 'feedback_triage' });
		await llmComplete({ system: 's', user: 'u', task: 'feedback_triage' });
		const phiCalls = globalThis.fetch.mock.calls.filter(([u]) => String(u).startsWith(URL_BASE));
		expect(phiCalls).toHaveLength(1);
	});
});
