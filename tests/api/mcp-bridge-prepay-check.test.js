// The opt-in pre-payment check (mcp-bridge/src/prepay-check.js). Mocked fetch only: no network, no signing.
import { describe, it, expect } from 'vitest';
import { buildPrepayCheckHook } from '../../mcp-bridge/src/prepay-check.js';

const req = { scheme: 'exact', network: 'eip155:8453', amount: '10000', asset: `0x${'a'.repeat(40)}`, payTo: `0x${'b'.repeat(40)}` };
const ctx = (r = req) => ({ paymentRequired: { x402Version: 2, resource: { url: 'https://seller.example/api' }, accepts: [r] }, selectedRequirements: r });
const mock = (answer) => { const f = async (url, init) => { f.calls.push({ url, init }); return answer(init); }; f.calls = []; return f; };
const json = (b) => () => new Response(JSON.stringify(b), { status: 200 });
const on = (extra = {}) => ({ MCP_BRIDGE_PREPAY_CHECK: '1', MCP_BRIDGE_PREPAY_CHECK_TIMEOUT_MS: '50', ...extra });

describe('mcp-bridge pre-payment check', () => {
	it('is off by default and makes no calls', () => {
		const f = mock(json({}));
		expect(buildPrepayCheckHook({ env: {}, fetchImpl: f })).toBeUndefined();
		expect(f.calls).toHaveLength(0);
	});
	it('lets the payment through on timeout, within the timeout', async () => {
		const f = mock(() => new Promise(() => {}));
		const t0 = Date.now();
		expect(await buildPrepayCheckHook({ env: on(), fetchImpl: f })(ctx())).toBeUndefined();
		expect(Date.now() - t0).toBeLessThan(500);
	});
	it('refuses on timeout only when fail-closed is set', async () => {
		const r = await buildPrepayCheckHook({ env: on({ MCP_BRIDGE_PREPAY_CHECK_FAIL_CLOSED: '1' }), fetchImpl: mock(() => new Promise(() => {})) })(ctx());
		expect(r?.abort).toBe(true);
	});
	it('lets the payment through on {}, 5xx, unknown codes and recheck', async () => {
		for (const a of [json({}), () => new Response('x', { status: 503 }), json({ verdict: 'skip', reason_code: 'new_code' }), json({ verdict: 'recheck', reason_code: 'timeout' })]) {
			expect(await buildPrepayCheckHook({ env: on(), fetchImpl: mock(a) })(ctx())).toBeUndefined();
		}
	});
	it('blocks a skip with a known reason code', async () => {
		const r = await buildPrepayCheckHook({ env: on(), fetchImpl: mock(json({ verdict: 'skip', reason_code: 'pay_to_mismatch' })) })(ctx());
		expect(r).toMatchObject({ abort: true });
		expect(r.reason).toMatch(/pay_to_mismatch/);
	});
	it('checks Base only and sends nothing but the URL', async () => {
		const f = mock(json({ verdict: 'skip', reason_code: 'pay_to_mismatch' }));
		const hook = buildPrepayCheckHook({ env: on(), fetchImpl: f });
		expect(await hook(ctx({ ...req, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' }))).toBeUndefined();
		expect(f.calls).toHaveLength(0);
		await hook(ctx());
		expect([...new URL(f.calls[0].url).searchParams.keys()]).toEqual(['url']);
		expect(Object.keys(f.calls[0].init.headers)).toEqual(['accept']);
	});
});
