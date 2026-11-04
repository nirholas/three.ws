import { describe, it, expect } from 'vitest';
import { createBrowsePolicy, parseAction, normalizeDomains, isCredentialField } from '../workers/agent-screen-pool/tasks/browse-policy.js';
import { runBrowseLoop } from '../workers/agent-screen-pool/tasks/agent-browse.js';

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
	it('gives up after repeated unparseable model output', async () => {
		const h = harness({ actions: ['nope', 'still nope', 'again'] });
		const r = await runBrowseLoop(h.deps);
		expect(r.status).toBe('error');
		expect(h.calls.act).toHaveLength(0);
	});
});
