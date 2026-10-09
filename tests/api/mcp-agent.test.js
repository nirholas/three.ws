import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.PUBLIC_APP_ORIGIN ||= 'https://three.ws';

// ── Per-user payer (money core) — mocked; we test orchestration, not fund movement ──
const payerState = {
	spendEnabled: true,
	walletStatus: null,
	payResult: null,
	payError: null,
};
// The real-funds agreement gate has its own suite (tests/real-funds-agreement.test.js).
vi.mock('../../api/_lib/real-funds-agreement.js', () => ({
	currentSignatureFor: vi.fn(async () => ({ signedAt: '2026-09-17T00:00:00.000Z', signatureName: 'Test Signer', context: null })),
	agreementRequirement: () => ({ version: 2, sign_url: 'https://three.ws/legal/agreements', documents: [] }),
}));

vi.mock('../../api/_lib/x402-user-payer.js', () => ({
	resolveSpendEnabled: () => payerState.spendEnabled,
	getUserWalletStatus: vi.fn(async () => payerState.walletStatus),
	payExternalX402: vi.fn(async () => {
		if (payerState.payError) throw payerState.payError;
		return payerState.payResult;
	}),
}));

// ── Bazaar (live discovery) ──────────────────────────────────────────────────
const bazState = { search: vi.fn(async () => ({ resources: [], errors: [] })) };
vi.mock('../../api/_lib/x402/bazaar-client.js', async (orig) => {
	const real = await orig();
	return { ...real, Bazaar: class { search(...a) { return bazState.search(...a); } } };
});

// ── x402 price probe (the network boundary pay_quote reads) ─────────────────
// probePrice is the only call that leaves the process; selectRail and the rest
// of the module stay real so the quote picks its rail the way production does.
const probeState = { result: null };
vi.mock('../../api/_lib/pay/probe.js', async (orig) => {
	const real = await orig();
	return { ...real, probePrice: vi.fn(async () => probeState.result) };
});

// ── Rate limits ──────────────────────────────────────────────────────────────
const rl = { agent: { success: true, reset: 0 }, pay: { success: true, reset: 0 } };
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		mcpAgent: vi.fn(async () => rl.agent),
		mcpAgentPay: vi.fn(async () => rl.pay),
	},
	clientIp: vi.fn(() => '203.0.113.5'),
}));

vi.mock('../../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const payer = await import('../../api/_lib/x402-user-payer.js');
const probe = await import('../../api/_lib/pay/probe.js');
const { dispatch, isPublicTool } = await import('../../api/_mcpagent/dispatch.js');

// A synthetic seller: one Solana USDC accept for one cent.
const SELLER = 'THREEsyntheticSe11er1111111111111111111111';
function pricedAt(amountAtomics, network = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') {
	return {
		kind: 'priced',
		status: 402,
		description: null,
		rails: [probe.describeRail({ network, asset: probe.USDC_SOLANA_MINT, payTo: SELLER, amount: String(amountAtomics) })],
	};
}

const ANON = { userId: null, rateKey: 'x402:anon', scope: '', source: 'x402' };
const USER = { userId: 'user-1', rateKey: 'user-1', scope: 'wallet:read wallet:write', source: 'bearer' };
// Read grant only: may look at the wallet, may never spend from it.
const READONLY = { userId: 'user-1', rateKey: 'user-1', scope: 'wallet:read', source: 'bearer' };
// A token from a client that was never granted anything wallet-shaped, e.g. a
// dynamically-registered client holding the default avatars:read.
const NOSCOPE = { userId: 'user-1', rateKey: 'user-1', scope: 'avatars:read', source: 'bearer' };
// Each request names its tool enablement in X-Three-Tools, the way a client
// does, so no test depends on saved settings. `default` is the platform base
// (read and write on, financial off); `x402` turns on the x402 group, which is
// what lets pay_and_call exist for the session at all.
const reqWith = (tools) => ({ url: '/api/mcp-agent', headers: tools ? { 'x-three-tools': tools } : {} });
const PAY_ON = 'default,x402';
const call = (name, args, auth = USER, tools = PAY_ON) =>
	dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, auth, reqWith(tools));

// The full spend path a model has to walk: pay_quote, then pay_and_call with
// the quote_id it returned and confirm_payment: true. `quoteAuth` lets a test
// quote as one token and pay as another for the same account.
async function quoteThenPay(args, auth = USER, { quoteAuth = auth } = {}) {
	const quote = await call('pay_quote', { resource_url: args.resource_url }, quoteAuth);
	const quoteId = quote.result._meta?.['three.ws/preview']?.quote_id;
	expect(quoteId, 'pay_quote issued a quote_id').toMatch(/^q_/);
	return call('pay_and_call', { ...args, quote_id: quoteId, confirm_payment: true }, auth);
}

beforeEach(() => {
	payerState.spendEnabled = true;
	payerState.walletStatus = null;
	payerState.payResult = null;
	payerState.payError = null;
	payer.payExternalX402.mockClear();
	payer.getUserWalletStatus.mockClear();
	bazState.search.mockClear();
	probeState.result = pricedAt(10_000);
	probe.probePrice.mockClear();
	rl.agent = { success: true, reset: 0 };
	rl.pay = { success: true, reset: 0 };
});

describe('threews-agent MCP', () => {
	it('lists the wallet toolset behind a free getting_started tool, with spend tools off by default', async () => {
		const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, USER, reqWith('default'));
		const names = r.result.tools.map((t) => t.name);
		expect(names.slice(0, 8)).toEqual([
			'getting_started',
			'wallet_status',
			'find_services',
			'pay_quote',
			'provision_wallet',
			'monetize_endpoint',
			'read_resource',
			'browse_marketplace',
		]);
		// Every tool that moves funds is financial tier: hidden until the session
		// turns its group on, so a default connection can never spend.
		for (const spend of ['pay_and_call', 'buy_now', 'place_bid', 'accept_marketplace_bid', 'predictions_open', 'predictions_redeem']) {
			expect(names, spend).not.toContain(spend);
		}
		// Every preview a money-moving tool depends on stays visible.
		expect(names).toEqual(expect.arrayContaining(['pay_quote', 'preview_marketplace_action', 'predictions_open_preview']));
	});

	it('shows pay_and_call, with its confirm flag and quote_id, once the x402 group is on', async () => {
		const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, USER, reqWith(PAY_ON));
		const pay = r.result.tools.find((t) => t.name === 'pay_and_call');
		expect(pay).toBeDefined();
		expect(pay._meta['three.ws/policy']).toMatchObject({
			group: 'x402',
			tier: 'financial',
			confirmFlag: 'confirm_payment',
			previewTool: 'pay_quote',
			previewArg: 'quote_id',
		});
		expect(Object.keys(pay.inputSchema.properties)).toEqual(expect.arrayContaining(['confirm_payment', 'quote_id']));
		expect(pay.description).toContain('Call pay_quote first');
	});

	it('getting_started is free and callable with no sign-in', async () => {
		expect(isPublicTool('getting_started')).toBe(true);
		expect(isPublicTool('pay_and_call')).toBe(false);
		const r = await dispatch(
			{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'getting_started', arguments: {} } },
			{ userId: null, rateKey: null, scope: '', source: 'free' },
		);
		expect(r.result.structuredContent.server).toBe('three.ws Agent');
		expect(r.result.structuredContent.tools.map((t) => t.name)).toEqual(
			expect.arrayContaining(['wallet_status', 'pay_and_call']),
		);
	});

	it('wallet_status requires sign-in', async () => {
		const r = await call('wallet_status', {}, ANON);
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.signed_in).toBe(false);
		expect(payer.getUserWalletStatus).not.toHaveBeenCalled();
	});

	it('wallet_status reports balance + caps for a signed-in user', async () => {
		payerState.walletStatus = {
			provisioned: true,
			agent_id: 'a1',
			agent_name: 'Scout',
			address: 'SoLaddr',
			network: 'solana',
			balances: { sol: 0.2, usdc: 5 },
			spend_enabled: true,
			caps: { max_per_call_usdc: 0.1, max_per_hour_usdc: 1, max_per_day_usdc: 10 },
		};
		const r = await call('wallet_status', {});
		expect(payer.getUserWalletStatus).toHaveBeenCalledWith('user-1');
		expect(r.result.structuredContent).toMatchObject({ signed_in: true, address: 'SoLaddr', balances: { usdc: 5 } });
		expect(r.result.content[0].text).toContain('5 USDC');
	});

	it('wallet_status refuses a token with no wallet grant', async () => {
		const r = await call('wallet_status', {}, NOSCOPE);
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent).toMatchObject({
			reason: 'insufficient_scope',
			required: 'wallet:read',
		});
		expect(payer.getUserWalletStatus).not.toHaveBeenCalled();
	});

	it('wallet_status accepts wallet:write as proof of read access', async () => {
		payerState.walletStatus = {
			provisioned: false,
			balances: {},
			caps: {},
			spend_enabled: false,
		};
		const r = await call(
			'wallet_status',
			{},
			{ userId: 'user-1', rateKey: 'user-1', scope: 'wallet:write', source: 'bearer' },
		);
		expect(r.result.isError).toBeUndefined();
		expect(r.result.structuredContent.signed_in).toBe(true);
	});

	it('find_services searches the live bazaar', async () => {
		bazState.search.mockResolvedValue({
			resources: [{ resource: 'https://svc.test', serviceName: 'Svc', minPriceLabel: '$0.01', networks: ['solana:*'], toolName: '' }],
			errors: [],
		});
		const r = await call('find_services', { query: 'weather' });
		expect(bazState.search).toHaveBeenCalledWith({ query: 'weather', type: 'http' });
		expect(r.result.structuredContent.services[0]).toMatchObject({ resource: 'https://svc.test', price: '$0.01' });
	});

	it('pay_quote prices the endpoint without paying and issues a quote_id', async () => {
		payerState.walletStatus = {
			provisioned: true,
			address: 'SoLaddr',
			balances: { sol: 0.2, usdc: 5 },
			spend_enabled: true,
			caps: { max_per_call_usdc: 0.1, max_per_hour_usdc: 1, max_per_day_usdc: 10 },
		};
		const r = await call('pay_quote', { resource_url: 'https://paid.test/weather' });
		expect(probe.probePrice).toHaveBeenCalledWith('https://paid.test/weather', { method: 'GET', body: null });
		expect(payer.payExternalX402).not.toHaveBeenCalled();
		expect(r.result.isError).toBeUndefined();
		expect(r.result.structuredContent).toMatchObject({
			ok: true,
			recipient: SELLER,
			amount_usd: 0.01,
			token: 'USDC',
			network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
			from: 'SoLaddr',
			per_call_limit_usd: 0.1,
			blockers: [],
		});
		const text = r.result.content.map((c) => c.text).join('\n');
		expect(text).toContain(`Recipient: ${SELLER}`);
		expect(text).toContain('Amount: 0.01 USDC');
		expect(text).toContain('Chain: Solana');
		expect(r.result._meta['three.ws/preview']).toMatchObject({ unlocks: ['pay_and_call'] });
	});

	it('pay_quote refuses, and issues no quote_id, for a price over the per-call limit', async () => {
		probeState.result = pricedAt(250_000);
		const r = await call('pay_quote', { resource_url: 'https://paid.test/x', max_usd: 0.05 });
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.blockers.map((b) => b.code)).toContain('over_per_call_limit');
		expect(r.result._meta?.['three.ws/preview']).toBeUndefined();
	});

	it('pay_quote refuses an endpoint that cannot be paid on Solana', async () => {
		probeState.result = pricedAt(10_000, 'eip155:8453');
		const r = await call('pay_quote', { resource_url: 'https://paid.test/x' });
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent).toMatchObject({ reason: 'no_solana_rail', networks: ['eip155:8453'] });
		expect(r.result._meta?.['three.ws/preview']).toBeUndefined();
	});

	it('pay_quote passes an unreachable endpoint through as a designed refusal', async () => {
		probeState.result = { kind: 'error', code: 'blocked_url', message: 'Target URL is not a reachable public endpoint' };
		const r = await call('pay_quote', { resource_url: 'https://paid.test/x' });
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.reason).toBe('blocked_url');
		expect(r.result.content[0].text).toContain('Nothing was paid.');
	});

	it('pay_and_call is turned off until the session enables the x402 group', async () => {
		const r = await call('pay_and_call', { resource_url: 'https://paid.test/x' }, USER, 'default');
		expect(payer.payExternalX402).not.toHaveBeenCalled();
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent).toMatchObject({ reason: 'tool_disabled', tool: 'pay_and_call', group: 'x402', tier: 'financial' });
		expect(r.result.content[0].text).toContain('X-Three-Tools: x402');
	});

	it('pay_and_call refuses without confirm_payment, then without a quote, before any payment call', async () => {
		const noConfirm = await call('pay_and_call', { resource_url: 'https://paid.test/x' });
		expect(noConfirm.result.structuredContent).toMatchObject({ reason: 'confirmation_required', confirm_flag: 'confirm_payment', preview_tool: 'pay_quote' });
		const noQuote = await call('pay_and_call', { resource_url: 'https://paid.test/x', confirm_payment: true });
		expect(noQuote.result.structuredContent).toMatchObject({ reason: 'preview_required', preview_arg: 'quote_id' });
		const unknown = await call('pay_and_call', { resource_url: 'https://paid.test/x', confirm_payment: true, quote_id: 'q_aaaaaaaaaaaaaaaaaaaaaaaa' });
		expect(unknown.result.structuredContent.reason).toBe('preview_unknown');
		expect(payer.payExternalX402).not.toHaveBeenCalled();
	});

	it('pay_and_call refuses a quote_id issued for a different resource', async () => {
		const quote = await call('pay_quote', { resource_url: 'https://paid.test/cheap' });
		const quoteId = quote.result._meta['three.ws/preview'].quote_id;
		const r = await call('pay_and_call', { resource_url: 'https://paid.test/other', quote_id: quoteId, confirm_payment: true });
		expect(r.result.structuredContent).toMatchObject({ reason: 'preview_mismatch' });
		expect(payer.payExternalX402).not.toHaveBeenCalled();
	});

	it('pay_and_call degrades to a pay link when spend is disabled', async () => {
		payerState.spendEnabled = false;
		const r = await quoteThenPay({ resource_url: 'https://paid.test/x' });
		expect(payer.payExternalX402).not.toHaveBeenCalled();
		expect(r.result.structuredContent).toMatchObject({ paid: false, reason: 'spend_disabled' });
		expect(r.result.structuredContent.pay_link).toContain('https://three.ws/pay?resource=');
	});

	it('pay_and_call degrades to auth handoff for anon callers', async () => {
		const r = await quoteThenPay({ resource_url: 'https://paid.test/x' }, ANON);
		expect(payer.payExternalX402).not.toHaveBeenCalled();
		expect(r.result.structuredContent.reason).toBe('auth_required');
	});

	it('pay_and_call pays and returns the result when enabled', async () => {
		payerState.payResult = { ok: true, payer: 'SoLaddr', result: { temp: 72 }, receipt: { tx: 'sig' } };
		const r = await quoteThenPay({ resource_url: 'https://paid.test/weather', max_usd: 0.05 });
		// The policy-only arguments (quote_id, confirm_payment) never reach the payer.
		expect(payer.payExternalX402).toHaveBeenCalledTimes(1);
		expect(payer.payExternalX402).toHaveBeenCalledWith({
			userId: 'user-1',
			url: 'https://paid.test/weather',
			method: 'GET',
			body: undefined,
			maxUsd: 0.05,
		});
		expect(r.result.structuredContent).toMatchObject({ paid: true, payer: 'SoLaddr', result: { temp: 72 } });
	});

	it('spends a quote_id once: one approval pays one call', async () => {
		payerState.payResult = { ok: true, payer: 'SoLaddr', result: { temp: 72 }, receipt: { tx: 'sig' } };
		const quote = await call('pay_quote', { resource_url: 'https://paid.test/weather' });
		const args = {
			resource_url: 'https://paid.test/weather',
			quote_id: quote.result._meta['three.ws/preview'].quote_id,
			confirm_payment: true,
		};
		const first = await call('pay_and_call', args);
		expect(first.result.structuredContent.paid).toBe(true);
		const replay = await call('pay_and_call', args);
		expect(replay.result.structuredContent.reason).toBe('preview_unknown');
		expect(payer.payExternalX402).toHaveBeenCalledTimes(1);
	});

	it('pay_and_call surfaces payer errors with a friendly message + pay link', async () => {
		payerState.payError = Object.assign(new Error('boom'), { code: 'no_solana_wallet' });
		const r = await quoteThenPay({ resource_url: 'https://paid.test/x' });
		expect(r.result.isError).toBe(true);
		expect(r.result.content[0].text).toContain('no Solana wallet');
		expect(r.result.structuredContent.reason).toBe('no_solana_wallet');
	});

	it('pay_quote tells a read-only token it cannot spend and issues it no quote_id', async () => {
		const r = await call('pay_quote', { resource_url: 'https://paid.test/x' }, READONLY);
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.blockers.map((b) => b.code)).toContain('insufficient_scope');
		expect(r.result._meta?.['three.ws/preview']).toBeUndefined();
	});

	it('refuses to spend for a read-only token, before any payment call', async () => {
		// Same account, so a quote issued to its full-scope token passes the
		// policy gate; the handler's own wallet:write check must still refuse.
		const r = await quoteThenPay({ resource_url: 'https://paid.test/x' }, READONLY, { quoteAuth: USER });
		expect(payer.payExternalX402).not.toHaveBeenCalled();
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent).toMatchObject({
			reason: 'insufficient_scope',
			required: 'wallet:write',
		});
	});

	it('still hands a read-only token the manual pay link when spend is off', async () => {
		payerState.spendEnabled = false;
		const r = await quoteThenPay({ resource_url: 'https://paid.test/x' }, READONLY);
		expect(r.result.structuredContent).toMatchObject({ paid: false, reason: 'spend_disabled' });
		expect(r.result.structuredContent.pay_link).toContain('https://three.ws/pay?resource=');
	});

	it('rejects an out-of-range max_price_usdc as invalid params, not an internal error', async () => {
		const r = await call('find_services', { query: 'weather', max_price_usdc: 1e21 });
		expect(r.error.code).toBe(-32602);
		expect(r.error.message).toContain('max_price_usdc');
		expect(bazState.search).not.toHaveBeenCalled();
	});

	it('enforces the pay rate limit before spending', async () => {
		const quote = await call('pay_quote', { resource_url: 'https://paid.test/x' });
		rl.pay = { success: false, reset: Date.now() + 30000 };
		const r = await call('pay_and_call', {
			resource_url: 'https://paid.test/x',
			quote_id: quote.result._meta['three.ws/preview'].quote_id,
			confirm_payment: true,
		});
		expect(r.error.code).toBe(-32000);
		expect(payer.payExternalX402).not.toHaveBeenCalled();
	});
});
