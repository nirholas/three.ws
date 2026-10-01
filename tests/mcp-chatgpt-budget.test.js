// The ChatGPT plugin surface answers every tool call inside ChatGPT's 60 s
// limit. A generation takes one to four minutes, so /api/mcp-chatgpt bounds each
// call with CHATGPT_CALL_BUDGET_MS and hands back a pending job the viewer widget
// collects by itself. These tests pin each link of that chain: the budget reaches
// the generator, the client's waits stop at it, a spent budget never buys a
// second submit, the widget polls and rigs through window.openai.callTool, and
// generation limits key on ChatGPT's per-user subject rather than OpenAI's shared
// egress IP.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../api/_mcp-studio/gpt-forge-client.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		generate: vi.fn(),
		rig: vi.fn(),
		directPrompt: vi.fn(async () => null),
	};
});

import { generate } from '../api/_mcp-studio/gpt-forge-client.js';
import { dispatch, CHATGPT_CALL_BUDGET_MS } from '../api/_mcp-studio/dispatch.js';
import { chatgptSubject } from '../api/_mcp-studio/handler.js';
import { COMPONENT_HTML } from '../api/_mcp-studio/component.js';

const req = { headers: { host: 'three.ws', 'x-forwarded-proto': 'https' } };
const auth = { userId: null, rateKey: '127.0.0.1', scope: '' };

function callMsg(name, args) {
	return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
}

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	vi.mocked(generate).mockReset();
});

describe('ChatGPT call budget', () => {
	it('stays under the 60 s host limit with room for a floored submit', () => {
		expect(CHATGPT_CALL_BUDGET_MS).toBeLessThanOrEqual(45_000);
	});

	it('passes a deadline inside the budget to the generator on the chatgpt surface', async () => {
		vi.mocked(generate).mockResolvedValue({ status: 'done', glb_url: 'https://three.ws/cdn/a.glb' });
		const before = Date.now();
		await dispatch(callMsg('forge_free', { prompt: 'a brass telescope' }), auth, req, { surface: 'chatgpt' });
		const opts = vi.mocked(generate).mock.calls[0][2];
		expect(opts.deadline).toBeGreaterThan(before);
		expect(opts.deadline).toBeLessThanOrEqual(Date.now() + CHATGPT_CALL_BUDGET_MS);
	});

	it('leaves the full MCP surface unbounded, where hosts wait minutes', async () => {
		vi.mocked(generate).mockResolvedValue({ status: 'done', glb_url: 'https://three.ws/cdn/a.glb' });
		await dispatch(callMsg('forge_free', { prompt: 'a brass telescope' }), auth, req, { surface: 'full' });
		expect(vi.mocked(generate).mock.calls[0][2].deadline).toBeUndefined();
	});

	it('marks an avatar mesh that ran out of budget so the widget rigs it', async () => {
		vi.mocked(generate).mockResolvedValue({ _timedOut: true, job_id: 'job-mesh-1', status: 'running' });
		const r = await dispatch(callMsg('forge_avatar', { prompt: 'a knight in plate armor' }), auth, req, { surface: 'chatgpt' });
		const sc = r.result.structuredContent;
		expect(sc.status).toBe('pending');
		expect(sc.jobId).toBe('job-mesh-1');
		expect(sc.stage).toBe('mesh');
		expect(sc.next).toBe('rig');
	});

	it('tells the ChatGPT model the viewer collects pending jobs', async () => {
		const r = await dispatch({ jsonrpc: '2.0', id: 2, method: 'initialize' }, auth, req, { surface: 'chatgpt' });
		expect(r.result.instructions).toMatch(/viewer collects a pending job by itself/);
	});
});

describe('gpt-forge client deadline', () => {
	it('pollJob returns a pending handle at the deadline instead of its own timeout', async () => {
		const { pollJob } = await vi.importActual('../api/_mcp-studio/gpt-forge-client.js');
		globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'running' }) }));
		const started = Date.now();
		const out = await pollJob('https://three.ws', 'job-x', { timeoutMs: 180_000, intervalMs: 50, deadline: started + 400 });
		expect(out._timedOut).toBe(true);
		expect(Date.now() - started).toBeLessThan(1_500);
	});

	it('startForge hands back its submit ticket, not a second submit, once the budget is gone', async () => {
		const { startForge } = await vi.importActual('../api/_mcp-studio/gpt-forge-client.js');
		const { TICKET_HEADER, ticketHandle } = await vi.importActual('../api/_lib/forge-submit-ticket.js');
		const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
		globalThis.fetch = vi.fn(async () => {
			throw timeout;
		});
		const out = await startForge('https://three.ws', { prompt: 'a lamp', tier: 'standard' }, { deadline: Date.now() + 1_000 });
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		const sent = globalThis.fetch.mock.calls[0][1].headers[TICKET_HEADER];
		expect(sent).toBeTruthy();
		expect(out).toEqual({ status: 'submitting', job_id: ticketHandle(sent) });
	});

	it('startForge still reports a timeout when the call was not bounded, so no ticket was sent', async () => {
		const { startForge } = await vi.importActual('../api/_mcp-studio/gpt-forge-client.js');
		const { TICKET_HEADER } = await vi.importActual('../api/_lib/forge-submit-ticket.js');
		const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
		globalThis.fetch = vi.fn(async () => {
			throw timeout;
		});
		await expect(startForge('https://three.ws', { prompt: 'a lamp', tier: 'standard' })).rejects.toMatchObject({ code: 'timeout' });
		expect(globalThis.fetch.mock.calls[0][1].headers[TICKET_HEADER]).toBeUndefined();
	});
});

describe('ChatGPT per-user generation limits', () => {
	it('reads the openai/subject ChatGPT sends on a tool call', () => {
		const body = { ...callMsg('forge_free', { prompt: 'x' }), params: { name: 'forge_free', arguments: {}, _meta: { 'openai/subject': 'v1/abcDEF123456' } } };
		expect(chatgptSubject(body)).toBe('v1/abcDEF123456');
	});

	it('accepts a well-formed subject and rejects anything else', () => {
		const withSub = (sub) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'forge_free', arguments: {}, _meta: { 'openai/subject': sub } } });
		expect(chatgptSubject(withSub('user_8f3kQ2abZx'))).toBe('user_8f3kQ2abZx');
		expect(chatgptSubject(withSub('short'))).toBeNull();
		expect(chatgptSubject(withSub('has spaces in it'))).toBeNull();
		expect(chatgptSubject(withSub(42))).toBeNull();
		expect(chatgptSubject(callMsg('forge_free', {}))).toBeNull();
	});
});

describe('viewer widget collects pending jobs', () => {
	it('polls check_job and rigs through the host tool bridge', () => {
		expect(COMPONENT_HTML).toContain("callTool('check_job'");
		expect(COMPONENT_HTML).toContain("callTool('rig_mesh'");
		expect(COMPONENT_HTML).toContain("p.next === 'rig'");
	});

	it('saves the finished model so a re-render does not start the wait over', () => {
		expect(COMPONENT_HTML).toContain('setWidgetState');
		expect(COMPONENT_HTML).toContain('saved.jobId === out.jobId');
	});

	it('renders the model look_at_model inspected instead of the empty state', () => {
		expect(COMPONENT_HTML).toContain('out.model_url');
	});

	it('no longer dead-ends a pending job on "ask to check the job" when tool calls are available', () => {
		expect(COMPONENT_HTML).toContain('canCallTools()');
	});
});

describe('check_job keeps a pending job collectable', () => {
	function jsonFetch(status, body) {
		return vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
	}

	it('flags a failed check as retryable while the job itself is fine', async () => {
		const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
		globalThis.fetch = vi.fn(async () => {
			throw timeout;
		});
		const r = await dispatch(callMsg('check_job', { job_id: 'job-slow-first-done' }), auth, req, { surface: 'chatgpt' });
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.retryable).toBe(true);
	});

	it('does not ask for a retry on a handle that will never resolve', async () => {
		globalThis.fetch = jsonFetch(404, { message: 'unknown job' });
		const r = await dispatch(callMsg('check_job', { job_id: 'job-expired-1' }), auth, req, { surface: 'chatgpt' });
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.retryable).toBeUndefined();
	});

	it('hands a pending refinement its version history', async () => {
		vi.mocked(generate).mockResolvedValue({ _timedOut: true, job_id: 'job-refine-1', status: 'running' });
		const r = await dispatch(
			callMsg('refine_model', { glb_url: 'https://three.ws/cdn/a.glb', parent_prompt: 'a brass telescope', instruction: 'make it tarnished' }),
			auth,
			req,
			{ surface: 'chatgpt' },
		);
		const sc = r.result.structuredContent;
		expect(sc.status).toBe('pending');
		expect(sc.refine.instruction).toBe('make it tarnished');
		expect(sc.refine.lineage).toHaveLength(1);
		expect(sc.refine.lineage[0].glbUrl).toBe('https://three.ws/cdn/a.glb');
	});

	it('appends the collected model to that history, as refine_model would inline', async () => {
		vi.mocked(generate).mockResolvedValue({ _timedOut: true, job_id: 'job-refine-2', status: 'running' });
		const pending = await dispatch(
			callMsg('refine_model', { glb_url: 'https://three.ws/cdn/a.glb', parent_prompt: 'a brass telescope', instruction: 'make it tarnished' }),
			auth,
			req,
			{ surface: 'chatgpt' },
		);
		globalThis.fetch = jsonFetch(200, { status: 'done', glb_url: 'https://three.ws/cdn/b.glb', prompt: 'a brass telescope, tarnished' });
		const done = await dispatch(
			callMsg('check_job', { job_id: 'job-refine-2', refine: pending.result.structuredContent.refine }),
			auth,
			req,
			{ surface: 'chatgpt' },
		);
		const sc = done.result.structuredContent;
		expect(sc.kind).toBe('refined model');
		expect(sc.glbUrl).toBe('https://three.ws/cdn/b.glb');
		expect(sc.lineage.map((v) => v.label)).toEqual(['Original', 'make it tarnished']);
		expect(sc.activeIndex).toBe(1);
	});

	it('falls back to the plain model when the refine context is malformed', async () => {
		globalThis.fetch = jsonFetch(200, { status: 'done', glb_url: 'https://three.ws/cdn/c.glb' });
		const done = await dispatch(
			callMsg('check_job', { job_id: 'job-refine-3', refine: { instruction: 'x', lineage: [{ index: 5, parentIndex: 9 }] } }),
			auth,
			req,
			{ surface: 'chatgpt' },
		);
		expect(done.result.structuredContent.glbUrl).toBe('https://three.ws/cdn/c.glb');
		expect(done.result.structuredContent.lineage).toBeUndefined();
	});
});

describe('avatar prompt when the director is down', () => {
	it('still asks for a full body, so the rigger gets a figure and not a bust', async () => {
		vi.mocked(generate).mockResolvedValue({ status: 'done', glb_url: 'https://three.ws/cdn/k.glb' });
		vi.mocked(generate).mockResolvedValueOnce({ _timedOut: true, job_id: 'job-knight', status: 'running' });
		await dispatch(callMsg('forge_avatar', { prompt: 'a knight in silver plate armor' }), auth, req, { surface: 'chatgpt' });
		const sent = vi.mocked(generate).mock.calls[0][1].prompt;
		expect(sent).toMatch(/^a knight in silver plate armor, full-body character/);
		expect(sent).toMatch(/head to toe/);
	});

	it('frames an animal as a whole animal', async () => {
		const { avatarFallbackBrief } = await import('../api/_mcp-studio/tools.js');
		expect(avatarFallbackBrief('a red fox', 'animal')).toMatch(/whole animal in frame from head to tail/);
	});
});
