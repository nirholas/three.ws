import { describe, it, expect, vi } from 'vitest';
import { createHqHost } from '../src/hq-host.js';

const ORIGIN = 'https://hq.example';

function harness(opts = {}) {
	const handlers = new Set();
	const win = {
		addEventListener: (t, fn) => t === 'message' && handlers.add(fn),
		removeEventListener: (t, fn) => handlers.delete(fn),
	};
	const sent = [];
	const contentWindow = { postMessage: (msg, target) => sent.push({ msg, target }) };
	const frame = { contentWindow };
	const host = createHqHost({ frame, origin: ORIGIN, win, ...opts });
	const deliver = (data, { origin = ORIGIN, source = contentWindow } = {}) => handlers.forEach((fn) => fn({ data, origin, source }));
	return { host, sent, deliver, handlers };
}

describe('hq-host requests', () => {
	it('sends a correlated command to the exact HQ origin and resolves with the reply', async () => {
		const { host, sent, deliver } = harness();
		const p = host.runTool('top_yields', { chain: 'Solana' });
		expect(sent[0].target).toBe(ORIGIN);
		expect(sent[0].msg.type).toBe('host:run-query');
		const { id } = sent[0].msg.payload;
		expect(sent[0].msg.payload).toMatchObject({ tool: 'top_yields', args: { chain: 'Solana' } });
		deliver({ type: 'hq:query-result', payload: { id, result: { rows: [1] } } });
		await expect(p).resolves.toEqual({ rows: [1] });
	});

	it('getPortfolioRisk sends a wallet address (with optional chain) or positions', async () => {
		const { host, sent, deliver } = harness();
		const owner = 'THREEsynthetic1111111111111111111111111111';
		const p = host.getPortfolioRisk(owner);
		expect(sent[0].msg.type).toBe('host:get-portfolio-risk');
		expect(sent[0].msg.payload).toEqual({ address: owner, id: sent[0].msg.payload.id });
		deliver({ type: 'hq:query-result', payload: { id: sent[0].msg.payload.id, result: { summary: { score: 88 } } } });
		await expect(p).resolves.toEqual({ summary: { score: 88 } });

		host.getPortfolioRisk('0x2222222222222222222222222222222222222222', { chain: 'base' }).catch(() => {});
		expect(sent[1].msg.payload).toMatchObject({ address: '0x2222222222222222222222222222222222222222', chain: 'base' });
		host.getPortfolioRisk([{ symbol: 'SOL', usd: 10 }]).catch(() => {});
		expect(sent[2].msg.payload).toMatchObject({ positions: [{ symbol: 'SOL', usd: 10 }] });
		expect(sent[2].msg.payload.address).toBeUndefined();
		host.dispose?.();
	});

	it('rejects with the HQ error code on hq:error', async () => {
		const { host, sent, deliver } = harness();
		const p = host.getPanelData('nope');
		deliver({ type: 'hq:error', payload: { id: sent[0].msg.payload.id, code: 'unknown_panel', message: 'No data provider' } });
		await expect(p).rejects.toMatchObject({ code: 'unknown_panel' });
	});

	it('getPanelSnapshot resolves the data with its freshness timestamp; getPanelData stays data-only', async () => {
		const { host, sent, deliver } = harness();
		const snap = host.getPanelSnapshot('markets');
		const data = host.getPanelData('markets');
		expect(sent[0].msg).toMatchObject({ type: 'host:get-panel-data', payload: { key: 'markets' } });
		deliver({ type: 'hq:panel-data', payload: { id: sent[0].msg.payload.id, key: 'markets', data: [{ symbol: 'X' }], updatedAt: '2026-11-13T10:00:00.000Z' } });
		deliver({ type: 'hq:panel-data', payload: { id: sent[1].msg.payload.id, key: 'markets', data: [{ symbol: 'X' }], updatedAt: null } });
		await expect(snap).resolves.toEqual({ key: 'markets', data: [{ symbol: 'X' }], updatedAt: '2026-11-13T10:00:00.000Z' });
		await expect(data).resolves.toEqual([{ symbol: 'X' }]);
	});

	it('ignores replies from the wrong origin or the wrong window', async () => {
		const { host, sent, deliver } = harness({ timeoutMs: 30 });
		const p = host.getPanelData('markets');
		const id = sent[0].msg.payload.id;
		deliver({ type: 'hq:panel-data', payload: { id, key: 'markets', data: 1 } }, { origin: 'https://evil.example' });
		deliver({ type: 'hq:panel-data', payload: { id, key: 'markets', data: 2 } }, { source: {} });
		await expect(p).rejects.toMatchObject({ code: 'timeout' });
	});

	it('times out and cleans up; dispose rejects what is in flight', async () => {
		const { host } = harness();
		const p = host.ask('gas?');
		host.dispose();
		await expect(p).rejects.toThrow(/disposed/);
		await expect(host.ask('again')).rejects.toThrow(/disposed/);
	});
});

describe('hq-host alert hand-off', () => {
	const alert = (extra = {}) => ({
		type: 'hq:alert-triggered',
		payload: {
			ruleId: 'r1', name: 'Breakout', description: 'BTC price >= $100000', handoff: true,
			proposal: { kind: 'briefing', params: { summary: 'BTC crossed', cadence: 'once', topic: 'BTC' }, context: 'HQ alert rule fired' },
			...extra,
		},
	});

	it('creates a pending propose action when the rule opted in', async () => {
		const apiFetch = vi.fn(async () => new Response(JSON.stringify({ proposal: { id: 'p1' } }), { status: 201 }));
		const { host, deliver } = harness({ agentId: 'agent-1', apiFetch });
		const done = new Promise((r) => host.on('handoff', r));
		deliver(alert());
		await expect(done).resolves.toEqual({ proposal: { id: 'p1' } });
		const [url, init] = apiFetch.mock.calls[0];
		expect(url).toBe('/api/autopilot/proposals');
		const body = JSON.parse(init.body);
		expect(body).toMatchObject({ agentId: 'agent-1', action: 'propose', kind: 'briefing' });
	});

	it('does nothing without opt-in, without an agent, or for a non-reversible kind', async () => {
		const apiFetch = vi.fn();
		const a = harness({ agentId: 'agent-1', apiFetch });
		a.deliver(alert({ handoff: false }));
		const b = harness({ apiFetch });
		b.deliver(alert());
		const c = harness({ agentId: 'agent-1', apiFetch });
		c.deliver(alert({ proposal: { kind: 'wallet_transfer', params: {}, context: '' } }));
		await new Promise((r) => setTimeout(r, 10));
		expect(apiFetch).not.toHaveBeenCalled();
	});

	it('treats 409 as success and surfaces other failures', async () => {
		const dup = vi.fn(async () => new Response('{}', { status: 409 }));
		const a = harness({ agentId: 'a', apiFetch: dup });
		const okSpy = vi.fn();
		a.host.on('handoff-error', okSpy);
		a.deliver(alert());
		await new Promise((r) => setTimeout(r, 10));
		expect(okSpy).not.toHaveBeenCalled();

		const fail = vi.fn(async () => new Response(JSON.stringify({ error_description: 'sign in required' }), { status: 401 }));
		const b = harness({ agentId: 'a', apiFetch: fail });
		const err = new Promise((r) => b.host.on('handoff-error', r));
		b.deliver(alert());
		await expect(err).resolves.toEqual({ message: 'sign in required' });
	});
});
