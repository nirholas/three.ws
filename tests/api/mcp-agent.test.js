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

// ── Rate limits ──────────────────────────────────────────────────────────────
const rl = { agent: { success: true, reset: 0 }, pay: { success: true, reset: 0 } };
vi.mock('../../api/_lib/rate-limit.js', async (importOriginal) => ({
	...(await importOriginal()),
	limits: {
		mcpAgent: vi.fn(async () => rl.agent),
		mcpAgentPay: vi.fn(async () => rl.pay),
	},
	clientIp: vi.fn(() => '203.0.113.5'),
}));

// ── pay_quote's unpaid probe ─────────────────────────────────────────────────
// The quote goes out through the DNS-resolving, IP-pinned fetch, which cannot
// reach the offline `.test` hosts below; it answers from quoteState instead.
// Pinning and redirect re-validation are covered in tests/ssrf-hardening-guards.test.js.
const SOLANA_ACCEPT = {
	scheme: 'exact',
	network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
	amount: '10000',
	asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	payTo: 'THREEsynthetic1111111111111111111111111111',
	extra: { name: 'USDC', decimals: 6 },
};
const quoteState = { status: 402, body: { x402Version: 2, accepts: [SOLANA_ACCEPT] }, headers: {}, error: null };
const quoteFetch = vi.fn(async () => {
	if (quoteState.error) throw quoteState.error;
	return new Response(JSON.stringify(quoteState.body), {
		status: quoteState.status,
		headers: { 'content-type': 'application/json', ...quoteState.headers },
	});
});
vi.mock('../../api/_lib/ssrf-guard.js', async (importOriginal) => ({
	...(await importOriginal()),
	fetchSafePublicUrlPinned: (...a) => quoteFetch(...a),
}));

vi.mock('../../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const payer = await import('../../api/_lib/x402-user-payer.js');
const { dispatch, isPublicTool } = await import('../../api/_mcpagent/dispatch.js');

const ANON = { userId: null, rateKey: 'x402:anon', scope: '', source: 'x402' };
const USER = { userId: 'user-1', rateKey: 'user-1', scope: 'wallet:read wallet:write', source: 'bearer' };
// Read grant only: may look at the wallet, may never spend from it.
const READONLY = { userId: 'user-1', rateKey: 'user-1', scope: 'wallet:read', source: 'bearer' };
// A token from a client that was never granted anything wallet-shaped, e.g. a
// dynamically-registered client holding the default avatars:read.
const NOSCOPE = { userId: 'user-1', rateKey: 'user-1', scope: 'avatars:read', source: 'bearer' };
// A connection's tool settings arrive as the X-Three-Tools header (what
// `npx three-ws tools` writes). DEFAULT_SESSION is the platform default (read
// and write on, financial off); PAY_ON adds the one financial tool.
const DEFAULT_SESSION = { headers: { 'x-three-tools': 'default' } };
const PAY_ON = { headers: { 'x-three-tools': 'default,pay_and_call' } };
const call = (name, args, auth = USER, req = DEFAULT_SESSION) =>
	dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, auth, { ...req });

// The approved flow for a financial call: quote, then pay with the quote's
// quote_id and confirm_payment: true, on a connection that turned it on.
async function quoteThenPay(args, auth = USER) {
	const quote = await call('pay_quote', { resource_url: args.resource_url }, auth, PAY_ON);
	const quoteId = quote.result?._meta?.['three.ws/preview']?.quote_id;
	expect(typeof quoteId).toBe('string');
	return call('pay_and_call', { ...args, quote_id: quoteId, confirm_payment: true }, auth, PAY_ON);
}

beforeEach(() => {
	payerState.spendEnabled = true;
	payerState.walletStatus = null;
	payerState.payResult = null;
	payerState.payError = null;
	payer.payExternalX402.mockClear();
	payer.getUserWalletStatus.mockClear();
	bazState.search.mockClear();
	quoteFetch.mockClear();
	quoteState.status = 402;
	quoteState.body = { x402Version: 2, accepts: [SOLANA_ACCEPT] };
	quoteState.headers = {};
	quoteState.error = null;
	rl.agent = { success: true, reset: 0 };
	rl.pay = { success: true, reset: 0 };
});

describe('threews-agent MCP', () => {
	it('lists the wallet toolset behind a free getting_started tool, financial tools off by default', async () => {
		const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, USER, { ...DEFAULT_SESSION });
		expect(r.result.tools.map((t) => t.name)).toEqual([
			'getting_started',
			'wallet_status',
			'find_services',
			'pay_quote',
			'provision_wallet',
			'monetize_endpoint',
			'read_resource',
			'browse_marketplace',
			'browse_public_agents',
			'get_listing',
			'get_marketplace_history',
			'preview_marketplace_action',
			'get_my_bids',
			'get_received_bids',
			'reject_marketplace_bid',
			'get_agent_transfer',
			'resume_agent_transfer',
			'predictions_events',
			'predictions_event',
			'predictions_positions',
			'predictions_open_preview',
			'predictions_close_preview',
			'predictions_redeem_preview',
			'predictions_watch',
		]);
	});

	it('lists pay_and_call with its confirm flag and quote argument once the connection turns it on', async () => {
		const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, USER, { ...PAY_ON });
		const pay = r.result.tools.find((t) => t.name === 'pay_and_call');
		expect(pay).toBeDefined();
		expect(Object.keys(pay.inputSchema.properties)).toEqual(
			expect.arrayContaining(['resource_url', 'confirm_payment', 'quote_id']),
		);
		expect(pay._meta['three.ws/policy']).toMatchObject({ tier: 'financial', previewTool: 'pay_quote' });
	});

	it('refuses pay_and_call on a connection that has not turned it on, before any payment call', async () => {
		const r = await call('pay_and_call', { resource_url: 'https://paid.test/x' });
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent).toMatchObject({ reason: 'tool_disabled', group: 'x402', tier: 'financial' });
		expect(payer.payExternalX402).not.toHaveBeenCalled();
	});

	it('refuses pay_and_call without a pay_quote preview for the same resource', async () => {
		const noPreview = await call('pay_and_call', { resource_url: 'https://paid.test/x', confirm_payment: true }, USER, PAY_ON);
		expect(noPreview.result.structuredContent.reason).toBe('preview_required');

		const quote = await call('pay_quote', { resource_url: 'https://paid.test/cheap' }, USER, PAY_ON);
		const quoteId = quote.result._meta['three.ws/preview'].quote_id;
		const swapped = await call(
			'pay_and_call',
			{ resource_url: 'https://paid.test/expensive', quote_id: quoteId, confirm_payment: true },
			USER,
			PAY_ON,
		);
		expect(swapped.result.structuredContent.reason).toBe('preview_mismatch');
		expect(payer.payExternalX402).not.toHaveBeenCalled();
	});

	it('pay_quote reads the price and pay-to from the 402 challenge without paying', async () => {
		const r = await call('pay_quote', { resource_url: 'https://paid.test/weather' });
		expect(quoteFetch).toHaveBeenCalledTimes(1);
		expect(quoteFetch.mock.calls[0][0]).toBe('https://paid.test/weather');
		expect(payer.payExternalX402).not.toHaveBeenCalled();
		expect(r.result.isError).toBeUndefined();
		expect(r.result.structuredContent).toMatchObject({
			paywalled: true,
			payable_with_agent_wallet: true,
			accepts: [{ network: SOLANA_ACCEPT.network, price_atomic: '10000', price_display: '0.01 USDC', pay_to: SOLANA_ACCEPT.payTo }],
		});
		expect(r.result._meta['three.ws/preview'].unlocks).toEqual(['pay_and_call']);
	});

	it('pay_quote reads a v2 challenge carried in the payment-required header', async () => {
		quoteState.body = {};
		quoteState.headers = {
			'payment-required': Buffer.from(JSON.stringify({ x402Version: 2, accepts: [SOLANA_ACCEPT] })).toString('base64'),
		};
		const r = await call('pay_quote', { resource_url: 'https://paid.test/weather' });
		expect(r.result.structuredContent.accepts[0].price_display).toBe('0.01 USDC');
	});

	it('pay_quote refuses an internal address without issuing a preview', async () => {
		const { SsrfBlockedError } = await import('../../api/_lib/ssrf-guard.js');
		quoteState.error = new SsrfBlockedError('host resolves to a blocked range');
		const r = await call('pay_quote', { resource_url: 'https://internal.test/x' });
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.reason).toBe('blocked_url');
		expect(r.result._meta?.['three.ws/preview']).toBeUndefined();
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
		expect(payer.payExternalX402).toHaveBeenCalledWith({
			userId: 'user-1',
			url: 'https://paid.test/weather',
			method: 'GET',
			body: undefined,
			maxUsd: 0.05,
		});
		expect(r.result.structuredContent).toMatchObject({ paid: true, payer: 'SoLaddr', result: { temp: 72 } });
	});

	it('pay_and_call surfaces payer errors with a friendly message + pay link', async () => {
		payerState.payError = Object.assign(new Error('boom'), { code: 'no_solana_wallet' });
		const r = await quoteThenPay({ resource_url: 'https://paid.test/x' });
		expect(r.result.isError).toBe(true);
		expect(r.result.content[0].text).toContain('no Solana wallet');
		expect(r.result.structuredContent.reason).toBe('no_solana_wallet');
	});

	// The spend gate in api/_mcp/policy.js refuses before the handler runs, so
	// the answer is a JSON-RPC error naming the browser session, not a tool result.
	it('refuses to spend for a read-only token, before any payment call', async () => {
		const r = await quoteThenPay({ resource_url: 'https://paid.test/x' }, READONLY);
		expect(payer.payExternalX402).not.toHaveBeenCalled();
		expect(r.result).toBeUndefined();
		expect(r.error.code).toBe(-32003);
		expect(r.error.data).toMatchObject({
			reason: 'spend_scope_required',
			required_scope: 'wallet:write',
			needs: 'browser_session',
			url: 'https://three.ws/dashboard',
		});
	});

	it('refuses a read-only token at the spend gate even when spend is off', async () => {
		payerState.spendEnabled = false;
		const r = await quoteThenPay({ resource_url: 'https://paid.test/x' }, READONLY);
		expect(payer.payExternalX402).not.toHaveBeenCalled();
		expect(r.error.code).toBe(-32003);
		expect(r.error.message).toContain('https://three.ws/dashboard');
	});

	it('rejects an out-of-range max_price_usdc as invalid params, not an internal error', async () => {
		const r = await call('find_services', { query: 'weather', max_price_usdc: 1e21 });
		expect(r.error.code).toBe(-32602);
		expect(r.error.message).toContain('max_price_usdc');
		expect(bazState.search).not.toHaveBeenCalled();
	});

	it('enforces the pay rate limit before spending', async () => {
		rl.pay = { success: false, reset: Date.now() + 30000 };
		const r = await quoteThenPay({ resource_url: 'https://paid.test/x' });
		expect(r.error.code).toBe(-32000);
		expect(payer.payExternalX402).not.toHaveBeenCalled();
	});
});
