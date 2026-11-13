import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBrowsePolicy, parseAction, normalizeDomains, isCredentialField } from '../workers/agent-screen-pool/tasks/browse-policy.js';
import { runBrowseLoop, brainDecider } from '../workers/agent-screen-pool/tasks/agent-browse.js';
import { createBrowseRunner } from '../workers/agent-screen-pool/browse-runner.js';

const page = { url: 'https://example.com/', text: 'Example Domain', elements: [
	{ id: 0, tag: 'a', name: 'More information' },
	{ id: 1, tag: 'input', type: 'password', name: 'Password' },
	{ id: 2, tag: 'input', type: 'text', name: 'Search' },
] };

function harness({ actions, policy, manualAt = Infinity, land = () => 'https://example.com/', clock } = {}) {
	const logs = [];
	const calls = { act: [], back: 0 };
	let decided = 0;
	let t = 1000;
	const deps = {
		goal: 'read the page', startUrl: 'https://example.com/',
		policy: policy || createBrowsePolicy({ allowedDomains: ['example.com'] }),
		observe: async () => page,
		decide: async () => ({ text: typeof actions[decided] === 'string' ? actions[decided++] : JSON.stringify(actions[decided++] ?? { action: 'done', result: 'end' }), tokens: 10 }),
		act: async (a) => { calls.act.push(a); return a.action === 'extract' ? { extracted: 'Example Domain' } : {}; },
		currentUrl: async () => land(calls.act.length),
		goBack: async () => { calls.back++; },
		isManual: () => decided >= manualAt,
		signal: undefined,
		log: (e) => logs.push(e),
		now: clock || (() => (t += 1)),
	};
	return { deps, logs, calls };
}

describe('browse policy', () => {
	it('refuses file:, loopback, private and metadata navigation', () => {
		const p = createBrowsePolicy({ allowedDomains: ['example.com', 'localhost', '10.0.0.5'] });
		for (const u of ['file:///etc/passwd', 'http://127.0.0.1/', 'http://localhost:3000/', 'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data/', 'javascript:alert(1)'])
			expect(p.checkUrl(u).ok, u).toBe(false);
		expect(p.checkUrl('https://example.com/a').ok).toBe(true);
	});
	it('enforces the domain allowlist including subdomains and lookalikes', () => {
		const p = createBrowsePolicy({ allowedDomains: ['https://www.Example.com/x'] });
		expect(p.checkUrl('https://docs.example.com/').ok).toBe(true);
		expect(p.checkUrl('https://example.com.evil.net/').ok).toBe(false);
		expect(p.checkUrl('https://notexample.com/').ok).toBe(false);
		expect(createBrowsePolicy({}).checkUrl('https://example.com/').reason).toBe('no_allowed_domains');
	});
	it('blocks financial pages by host and path', () => {
		const p = createBrowsePolicy({ allowedDomains: ['example.com', 'paypal.com'] });
		expect(p.checkUrl('https://www.paypal.com/').reason).toBe('financial_page');
		expect(p.checkUrl('https://example.com/checkout?x=1').reason).toBe('financial_page');
		expect(p.checkUrl('https://pay.example.com/').reason).toBe('financial_page');
	});
	it('never types into credential fields', () => {
		const p = createBrowsePolicy({ allowedDomains: ['example.com'] });
		const elements = new Map(page.elements.map((e) => [e.id, e]));
		expect(p.checkAction({ action: 'type', id: 1, text: 'hunter2' }, { elements }).reason).toBe('credential_entry_needs_vault');
		expect(p.checkAction({ action: 'type', id: 2, text: 'cats' }, { elements }).ok).toBe(true);
		expect(isCredentialField({ name: 'Card number' })).toBe(true);
		expect(isCredentialField({ name: 'One-time code' })).toBe(true);
	});
	it('clamps budgets and parses only the closed action schema', () => {
		const p = createBrowsePolicy({ allowedDomains: ['a.com'], maxSteps: 9999, maxMs: -5, maxTokens: 'x' });
		expect([p.maxSteps, p.maxMs, p.maxTokens]).toEqual([30, 1, 20000]);
		expect(parseAction('Sure! {"action":"click","id":3,"note":"go"} ok')).toEqual({ action: 'click', id: 3, note: 'go' });
		expect(parseAction('{"action":"eval","code":"x"}')).toBeNull();
		expect(parseAction('{"action":"click"}')).toBeNull();
		expect(parseAction('no json')).toBeNull();
		expect(normalizeDomains(['HTTPS://Www.A.com/p', 'a.com', '', 'b.org'])).toEqual(['a.com', 'b.org']);
	});

	it('shortens a long note on a word boundary with an ellipsis instead of mid-word', () => {
		const long = 'I need to find the heading. The provided text shows paragraphs but no explicit heading. I will try to extract the content of the page or look for a hidden heading somewhere';
		const { note } = parseAction(JSON.stringify({ action: 'scroll', note: long }));
		expect(note.length).toBeLessThanOrEqual(160);
		expect(note.endsWith('\u2026')).toBe(true);
		expect(long.startsWith(note.slice(0, -1))).toBe(true);
		expect(long[note.length - 1]).toBe(' ');
	});
});

describe('browse loop', () => {
	it('stops within one step when the owner takes the lease, before acting', async () => {
		const h = harness({ actions: [{ action: 'click', id: 0 }, { action: 'click', id: 0 }, { action: 'click', id: 0 }], manualAt: 2 });
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('yielded');
		expect(h.calls.act).toHaveLength(1);
		expect(r.steps.at(-1)).toMatchObject({ type: 'yield', reason: 'owner_took_over' });
	});
	it('does not act at all when the lease is already held', async () => {
		const h = harness({ actions: [{ action: 'click', id: 0 }], manualAt: 0 });
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('yielded');
		expect(h.calls.act).toHaveLength(0);
	});
	it('refuses an off-allowlist start url and a private goto without acting', async () => {
		const h = harness({ actions: [{ action: 'goto', url: 'http://169.254.169.254/' }, { action: 'goto', url: 'file:///etc/hosts' }, { action: 'goto', url: 'http://10.1.1.1/' }] });
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('policy_stop');
		expect(h.calls.act).toHaveLength(0);
		const bad = harness({ actions: [] });
		bad.deps.startUrl = 'file:///etc/passwd';
		expect((await runBrowseLoop(bad.deps)).status).toBe('denied');
	});
	it('ends a runaway loop at the step cap', async () => {
		const h = harness({ actions: Array.from({ length: 50 }, () => ({ action: 'scroll', direction: 'down' })), policy: createBrowsePolicy({ allowedDomains: ['example.com'], maxSteps: 4 }) });
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('step_cap');
		expect(h.calls.act).toHaveLength(4);
	});
	it('ends at the time cap', async () => {
		let t = 0;
		const h = harness({ actions: Array.from({ length: 50 }, () => ({ action: 'scroll' })), policy: createBrowsePolicy({ allowedDomains: ['example.com'], maxMs: 1000 }), clock: () => (t += 400) });
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('time_cap');
		expect(h.calls.act.length).toBeLessThan(5);
	});
	it('ends at the token cap', async () => {
		const h = harness({ actions: Array.from({ length: 50 }, () => ({ action: 'scroll' })), policy: createBrowsePolicy({ allowedDomains: ['example.com'], maxTokens: 25 }) });
		expect((await runBrowseLoop(h.deps)).status).toBe('token_cap');
	});
	it('logs every action and denial, returns the result, and reverts an off-allowlist landing', async () => {
		const h = harness({
			actions: [{ action: 'type', id: 1, text: 'pw' }, { action: 'click', id: 0, note: 'follow link' }, { action: 'extract', id: null }, { action: 'done', result: 'Example Domain' }],
			land: (n) => (n === 1 ? 'https://evil.net/' : 'https://example.com/'),
		});
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('done');
		expect(r.result).toBe('Example Domain');
		expect(h.calls.back).toBe(1);
		expect(h.logs).toEqual(r.steps);
		const kinds = r.steps.map((s) => `${s.type}:${s.action || s.reason}`);
		expect(kinds).toContain('denied:type');
		expect(kinds).toContain('action:click');
		expect(kinds).toContain('denied:navigate');
		expect(kinds.at(-1)).toBe('action:done');
	});
	it('reports yielded, not a failure, when the model call fails after the owner takes over', async () => {
		let manual = false;
		const h = harness({ actions: [] });
		h.deps.decide = async () => { manual = true; throw new Error('no model could decide (llama-3.3-70b: brain 502)'); };
		h.deps.isManual = () => manual;
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('yielded');
		expect(h.calls.act).toHaveLength(0);
		expect(r.steps.at(-1)).toMatchObject({ type: 'yield', reason: 'owner_took_over' });
	});
	it('logs a model outage as a step and ends cleanly instead of crashing the run', async () => {
		const h = harness({ actions: [] });
		h.deps.decide = async () => { throw new Error('no model could decide (gpt-oss-120b: no working route)'); };
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('error');
		expect(r.reason).toBe('model_unavailable');
		expect(h.logs.at(-1)).toMatchObject({ type: 'error', action: 'decide', reason: 'model_unavailable' });
		expect(h.logs.at(-1).detail).toMatch(/no working route/);
	});
	it('does not re-read the same element twice in a row and tells the model to answer instead', async () => {
		const h = harness({ actions: [{ action: 'extract', id: 0 }, { action: 'extract', id: 0 }, { action: 'done', result: 'Example Domain' }] });
		const feedbacks = [];
		const decide = h.deps.decide;
		h.deps.decide = async (ctx) => { feedbacks.push(ctx.feedback); return decide(ctx); };
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('done');
		expect(h.calls.act.filter((a) => a.action === 'extract')).toHaveLength(1);
		expect(r.steps.map((s) => s.type)).toContain('invalid');
		expect(feedbacks.at(-1)).toMatch(/already read/i);
	});
	it('gives up after repeated unparseable model output', async () => {
		const h = harness({ actions: ['nope', 'still nope', 'again'] });
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('error');
		expect(h.calls.act).toHaveLength(0);
	});
});

// /api/brain/chat replies are SSE. These bodies copy the shapes production sends:
// a dead route streams fallback events and then `event: error` with no text.
const sse = (s) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(s)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const DEAD_ROUTE = 'event: meta\ndata: {"provider":"gpt-oss-120b"}\n\nevent: fallback\ndata: {"route":"vertex-gemini/google/gemini-2.5-flash"}\n\nevent: error\ndata: {"message":"This model has no working route on this deployment right now.","reason":"Forbidden"}\n\n';
const ANSWER = (obj) => `event: meta\ndata: {"provider":"llama-3.3-70b"}\n\ndata: ${JSON.stringify(JSON.stringify(obj))}\n\nevent: done\ndata: {"elapsedMs":10}\n\ndata: [DONE]\n\n`;

function brainHarness(routes) {
	const asked = [];
	const fetchImpl = async (_url, init) => {
		const { provider } = JSON.parse(init.body);
		asked.push(provider);
		const r = routes[provider];
		if (r === undefined) return new Response('no such provider', { status: 400 });
		return typeof r === 'number' ? new Response('upstream', { status: r }) : sse(r);
	};
	return { asked, fetchImpl };
}

describe('browse decider', () => {
	const ctx = { goal: 'report the heading', obs: page, feedback: '', stepsLeft: 5 };

	it('falls through to the next provider when the first streams a route error', async () => {
		const h = brainHarness({ 'gpt-oss-120b': DEAD_ROUTE, 'llama-3.3-70b': ANSWER({ action: 'done', result: 'Example Domain' }) });
		const decide = brainDecider({ baseUrl: 'https://three.ws', fetchImpl: h.fetchImpl, providers: ['gpt-oss-120b', 'llama-3.3-70b'] });
		const reply = await decide(ctx);
		expect(parseAction(reply.text)).toMatchObject({ action: 'done', result: 'Example Domain' });
		expect(h.asked).toEqual(['gpt-oss-120b', 'llama-3.3-70b']);
	});

	it('sticks to the provider that answered so later steps skip the dead route', async () => {
		const h = brainHarness({ 'gpt-oss-120b': DEAD_ROUTE, 'llama-3.3-70b': ANSWER({ action: 'scroll', direction: 'down' }) });
		const decide = brainDecider({ baseUrl: 'https://three.ws', fetchImpl: h.fetchImpl, providers: ['gpt-oss-120b', 'llama-3.3-70b'] });
		await decide(ctx);
		await decide(ctx);
		expect(h.asked).toEqual(['gpt-oss-120b', 'llama-3.3-70b', 'llama-3.3-70b']);
	});

	it('defaults to a chain that does not depend on a single route', async () => {
		const h = brainHarness({ 'gpt-oss-120b': DEAD_ROUTE, 'llama-3.3-70b': ANSWER({ action: 'done', result: 'ok' }) });
		const decide = brainDecider({ baseUrl: 'https://three.ws', fetchImpl: h.fetchImpl });
		const reply = await decide(ctx);
		expect(parseAction(reply.text)?.action).toBe('done');
	});

	it('waits and retries the chain once when every provider is briefly unavailable', async () => {
		let calls = 0;
		const waits = [];
		const fetchImpl = async () => { calls++; return calls <= 2 ? sse(DEAD_ROUTE) : sse(ANSWER({ action: 'done', result: 'ok' })); };
		const decide = brainDecider({ baseUrl: 'https://three.ws', fetchImpl, providers: ['gpt-oss-120b', 'llama-3.3-70b'], sleep: async (ms) => { waits.push(ms); } });
		const reply = await decide(ctx);
		expect(parseAction(reply.text)?.action).toBe('done');
		expect(waits).toHaveLength(1);
		expect(waits[0]).toBeGreaterThan(0);
	});

	it('names every provider and its failure when none can answer', async () => {
		const h = brainHarness({ 'gpt-oss-120b': DEAD_ROUTE, 'llama-3.3-70b': 502 });
		const decide = brainDecider({ baseUrl: 'https://three.ws', fetchImpl: h.fetchImpl, providers: ['gpt-oss-120b', 'llama-3.3-70b'], sleep: async () => {} });
		await expect(decide(ctx)).rejects.toThrow(/gpt-oss-120b: .*no working route.*llama-3\.3-70b: brain 502/);
	});
});

describe('browse runner', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('stops the agent\'s idle cast before opening the browse page, so only one page streams to the owner', async () => {
		const order = [];
		const reports = [];
		const job = { id: 'job-1', agentId: 'agent-1', goal: 'report the heading', startUrl: 'https://example.com/', allowedDomains: ['example.com'], maxSteps: 3 };
		vi.stubGlobal('fetch', async (_url, init) => {
			const body = JSON.parse(init.body);
			if (body.op === 'claim') return Response.json({ job });
			reports.push(body);
			return Response.json({ ok: true });
		});
		const runner = createBrowseRunner({
			baseUrl: 'https://three.ws', browseUrl: 'https://three.ws/api/agent-screen-browse', secret: 'x'.repeat(32),
			egress: { checkUrl: async () => ({ ok: true }) },
			pushTaskFrame: async () => {}, log: () => {}, sleep: async () => {},
			onClaim: async (agentId) => { order.push(`stop-cast:${agentId}`); },
			newPage: async () => { order.push('browse-page'); throw new Error('browser unavailable'); },
		});
		await runner.poll();
		await vi.waitFor(() => expect(reports.some((r) => r.status === 'error')).toBe(true));
		expect(order).toEqual(['stop-cast:agent-1', 'browse-page']);
		const final = reports.find((r) => r.status === 'error');
		expect(final.steps.at(-1)).toMatchObject({ type: 'error', action: 'run', reason: 'browser unavailable' });
	});
});
