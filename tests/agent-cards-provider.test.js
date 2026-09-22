// Contract tests for the card provider adapter (api/_lib/cards/*), replayed
// against responses recorded from the real Bitrefill v2 API on 2026-09-22
// (tests/fixtures/bitrefill, account identity scrubbed). The fetch stub routes
// each request to its recorded response, so the suite runs offline while the
// adapter parses exactly what the provider sends.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	assertProvider, getCardProvider, PROVIDER_METHODS, CardProviderError,
} from '../api/_lib/cards/provider.js';
import {
	normalizeProduct, resolveDenomination, splitRedemption, maskSecret, isSandboxProductId,
} from '../api/_lib/cards/bitrefill.js';
import { toolDefs } from '../api/_mcp/tools/cards.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(here, 'fixtures/bitrefill', name), 'utf8'));

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fetch that answers from recorded fixtures and records every call. */
function recordedFetch(routes) {
	const calls = [];
	const fn = async (url, init = {}) => {
		const u = new URL(url);
		const key = `${init.method || 'GET'} ${u.pathname}`;
		calls.push({ key, url: u, init });
		const hit = routes[key];
		if (!hit) return jsonResponse({ message: 'Product not found', error_code: 'not_found' }, 404);
		const r = typeof hit === 'function' ? hit(u, init) : hit;
		return jsonResponse(r.body ?? r, r.status ?? 200);
	};
	fn.calls = calls;
	return fn;
}

const INVOICE_ID = fx('invoice-create-balance.json').data.id;
const ORDER_ID = fx('invoice-create-balance.json').data.orders[0].id;
const LIVE_INVOICE = fx('invoice-create-usdc-solana.json').data;

function provider(routes) {
	const fetchImpl = recordedFetch(routes);
	return { p: getCardProvider('bitrefill', { apiKey: 'test-key', fetchImpl }), fetchImpl };
}

describe('card provider contract', () => {
	it('the Bitrefill adapter implements every contract method', () => {
		const { p } = provider({});
		expect(() => assertProvider(p)).not.toThrow();
		for (const m of PROVIDER_METHODS) expect(typeof p[m]).toBe('function');
		expect(p.capabilities.settlement).toContain('usdc_solana');
	});

	it('assertProvider rejects an adapter missing a method', () => {
		const { p } = provider({});
		const broken = { ...p, reveal: undefined };
		expect(() => assertProvider(broken)).toThrow(/missing reveal/);
	});

	it('unknown providers are refused', () => {
		expect(() => getCardProvider('nope')).toThrow(CardProviderError);
	});
});

describe('catalog', () => {
	it('normalizes a recorded product with packages and a range', () => {
		const p = normalizeProduct(fx('product-test-gift-card-code.json').data);
		expect(p.id).toBe('test-gift-card-code');
		expect(p.sandbox).toBe(true);
		expect(p.kind).toBe('gift_card');
		expect(p.packages.map((x) => x.value)).toEqual([10, 20, 30, 50, 100]);
		expect(p.range).toEqual({ min: 10, max: 100, step: 10 });
		expect(p.image_url).toMatch(/^https:\/\/res\.cloudinary\.com\/bitrefill\//);
	});

	it('classifies payment-cards products as prepaid cards', () => {
		const items = fx('products-search-prepaid.json').data.map(normalizeProduct);
		expect(items.length).toBeGreaterThan(0);
		for (const p of items) expect(p.kind).toBe('prepaid_card');
	});

	it('searchProducts sends the query and paginates', async () => {
		const { p, fetchImpl } = provider({ 'GET /v2/products/search': fx('products-search.json') });
		const r = await p.searchProducts({ q: 'amazon', limit: 2 });
		expect(fetchImpl.calls[0].url.searchParams.get('q')).toBe('amazon');
		expect(fetchImpl.calls[0].init.headers.authorization).toBe('Bearer test-key');
		expect(r.items).toHaveLength(2);
		expect(r.has_more).toBe(true);
	});

	it('sandbox search keeps only test products that can succeed', async () => {
		const payload = {
			meta: { total_results: 3 },
			data: [
				fx('product-test-gift-card-code.json').data,
				{ ...fx('product-test-gift-card-code.json').data, id: 'test-gift-card-code-fail' },
				fx('products-search.json').data[0],
			],
		};
		const { p, fetchImpl } = provider({ 'GET /v2/products/search': payload });
		const r = await p.searchProducts({ sandbox: true });
		expect(fetchImpl.calls[0].url.searchParams.get('include_test_products')).toBe('true');
		expect(r.items.map((x) => x.id)).toEqual(['test-gift-card-code']);
	});

	it('searchMerchants groups products by brand', async () => {
		const { p } = provider({ 'GET /v2/products/search': fx('products-search.json') });
		const r = await p.searchMerchants({ q: 'amazon' });
		for (const m of r.items) {
			expect(typeof m.name).toBe('string');
			expect(Array.isArray(m.countries)).toBe(true);
			expect(m.product_count).toBeGreaterThan(0);
		}
	});

	it('an unknown product maps to not_found', async () => {
		const { p } = provider({ 'GET /v2/products/amazon-us': { status: 404, body: fx('product-not-found.json') } });
		await expect(p.getProduct('amazon-us')).rejects.toMatchObject({ code: 'not_found', status: 404 });
	});
});

describe('denominations', () => {
	const product = normalizeProduct(fx('product-test-gift-card-code.json').data);

	it('matches a package by value', () => {
		expect(resolveDenomination(product, 20)).toEqual({ value: 20, packageId: 'test-gift-card-code<&>20' });
	});

	it('accepts an in-range value on the step', () => {
		expect(resolveDenomination(product, 40)).toEqual({ value: 40, packageId: null });
	});

	it('refuses a value off the step with what is allowed', () => {
		expect(() => resolveDenomination(product, 7)).toThrow(/one of 10, 20, 30, 50, 100/);
		expect(() => resolveDenomination(product, -1)).toThrow(CardProviderError);
	});
});

describe('quote', () => {
	const product = normalizeProduct(fx('product-test-gift-card-code.json').data);

	it('live quotes lock the exact USDC-on-Solana price and address', async () => {
		let sent;
		const { p } = provider({
			'POST /v2/invoices': (_u, init) => {
				sent = JSON.parse(init.body);
				return fx('invoice-create-usdc-solana.json');
			},
		});
		const q = await p.quote({ product, value: 10, packageId: 'test-gift-card-code<&>10', mode: 'live', refundAddress: 'RefundAddr' });
		expect(sent).toMatchObject({ payment_method: 'usdc_solana', refund_address: 'RefundAddr' });
		expect(sent.products[0]).toEqual({ product_id: 'test-gift-card-code', quantity: 1, package_id: 'test-gift-card-code<&>10' });
		expect(q.total_atomic).toBe(10_500_000n);
		expect(q.total_usdc).toBe(10.5);
		expect(q.fee_usdc).toBe(0.5);
		expect(q.pay_address).toBe(LIVE_INVOICE.payment.address);
		expect(q.provider_invoice_id).toBe(LIVE_INVOICE.id);
	});

	it('sandbox quotes use the account balance and cost nothing', async () => {
		let sent;
		const { p } = provider({
			'POST /v2/invoices': (_u, init) => {
				sent = JSON.parse(init.body);
				return fx('invoice-create-balance.json');
			},
		});
		const q = await p.quote({ product, value: 20, packageId: null, mode: 'sandbox' });
		expect(sent).toMatchObject({ payment_method: 'balance', auto_pay: false });
		expect(sent.products[0].value).toBe(20);
		expect(q.total_atomic).toBe(0n);
		expect(q.pay_address).toBeNull();
		expect(q.provider_order_id).toBe(ORDER_ID);
	});

	it('a provider value error maps to invalid_amount', async () => {
		const { p } = provider({ 'POST /v2/invoices': { status: 400, body: fx('invoice-wrong-value.json') } });
		await expect(p.quote({ product, value: 7, mode: 'sandbox' })).rejects.toMatchObject({ code: 'invalid_amount' });
	});

	it('paymentRequest reads back the address and exact amount', async () => {
		const { p } = provider({ [`GET /v2/invoices/${LIVE_INVOICE.id}`]: fx('invoice-create-usdc-solana.json') });
		const pr = await p.paymentRequest(LIVE_INVOICE.id);
		expect(pr).toEqual({ status: 'unpaid', address: LIVE_INVOICE.payment.address, currency: 'USDC', total_atomic: 10_500_000n });
	});
});

describe('fulfillment and secrets', () => {
	const card = { mode: 'sandbox', status: 'paying', provider_invoice_id: INVOICE_ID, provider_order_id: ORDER_ID };
	const code = fx('order-delivered.json').data.redemption_info.code;

	it('sandbox create pays the invoice, then reports delivery without the secret', async () => {
		const { p, fetchImpl } = provider({
			[`POST /v2/invoices/${INVOICE_ID}/pay`]: fx('invoice-pay.json'),
			[`GET /v2/invoices/${INVOICE_ID}`]: fx('invoice-get-delivered.json'),
		});
		const s = await p.create({ card });
		expect(fetchImpl.calls.map((c) => c.key)).toEqual([`POST /v2/invoices/${INVOICE_ID}/pay`, `GET /v2/invoices/${INVOICE_ID}`]);
		expect(s.status).toBe('delivered');
		expect(s.card_data.fields).toEqual(['code']);
		expect(s.card_data.masked).toBe(`•••• ${code.slice(-4)}`);
		expect(JSON.stringify(s)).not.toContain(code);
	});

	it('live create never calls the provider pay endpoint', async () => {
		const { p, fetchImpl } = provider({ [`GET /v2/invoices/${INVOICE_ID}`]: fx('invoice-get-delivered.json') });
		await p.create({ card: { ...card, mode: 'live' } });
		expect(fetchImpl.calls.every((c) => !c.key.endsWith('/pay'))).toBe(true);
	});

	it('an unpaid invoice reads as awaiting_payment', async () => {
		const { p } = provider({ [`GET /v2/invoices/${INVOICE_ID}`]: fx('invoice-pay.json') });
		expect((await p.status({ card })).status).toBe('awaiting_payment');
	});

	it('reveal returns the redemption secret from the order', async () => {
		const { p } = provider({ [`GET /v2/orders/${ORDER_ID}`]: fx('order-delivered.json') });
		expect(await p.reveal({ card })).toEqual({ code });
		const data = await p.cardData({ card });
		expect(data.fields).toEqual(['code']);
		expect(JSON.stringify(data)).not.toContain(code);
	});

	it('a permanently failed order reads as failed and cannot be revealed', async () => {
		const failed = fx('order-failed.json').data;
		const failCard = { ...card, provider_order_id: failed.id };
		const { p } = provider({ [`GET /v2/orders/${failed.id}`]: fx('order-failed.json') });
		await expect(p.reveal({ card: failCard })).rejects.toMatchObject({ code: 'unsupported', status: 409 });
	});

	it('splitRedemption separates secrets from instructions', () => {
		const r = splitRedemption({ code: 'ABCD-1234', pin: '9999', instructions: 'Redeem online', extra_fields: { serial: 'S1' } });
		expect(r.secret).toEqual({ code: 'ABCD-1234', pin: '9999', extra_serial: 'S1' });
		expect(r.masked).toBe('•••• 1234');
		expect(r.instructions).toBe('Redeem online');
		expect(maskSecret('https://redeem.example/x')).toBe('Redemption link');
		expect(isSandboxProductId('test-gift-card-code')).toBe(true);
		expect(isSandboxProductId('steam-usa')).toBe(false);
	});
});

describe('errors and unsupported capabilities', () => {
	it('a missing credential is not_configured and makes no request', async () => {
		const fetchImpl = recordedFetch({});
		const p = getCardProvider('bitrefill', { apiKey: '', fetchImpl });
		await expect(p.getProduct('x')).rejects.toMatchObject({ code: 'not_configured' });
		expect(fetchImpl.calls).toHaveLength(0);
	});

	it('rate limits and rejected credentials are mapped', async () => {
		const limited = provider({ 'GET /v2/products/x': { status: 429, body: {} } }).p;
		await expect(limited.getProduct('x')).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
		const denied = provider({ 'GET /v2/products/x': { status: 401, body: {} } }).p;
		await expect(denied.getProduct('x')).rejects.toMatchObject({ code: 'not_configured', status: 503 });
	});

	it('withdraw and balance say plainly that the provider cannot', async () => {
		const { p } = provider({});
		await expect(p.withdraw()).rejects.toMatchObject({ code: 'unsupported' });
		await expect(p.balance()).rejects.toMatchObject({ code: 'unsupported' });
		await expect(p.cancel({ card: { status: 'delivered' } })).rejects.toMatchObject({ code: 'unsupported' });
		await expect(p.cancel({ card: { status: 'quoted' } })).resolves.toEqual({ cancelled: true });
		expect(await p.connectLink()).toEqual({ required: false, status: 'ready', url: null });
	});
});

describe('MCP tool policy', () => {
	const byName = Object.fromEntries(toolDefs.map((t) => [t.name, t]));

	it('every card tool carries a group, tier and scope', () => {
		for (const t of toolDefs) {
			expect(t.group).toBe('cards');
			expect(['read', 'write', 'financial']).toContain(t.tier);
			expect(t.scope).toMatch(/^wallet:(read|write)$/);
		}
	});

	it('financial tools require their confirm flag and name an existing preview tool', () => {
		const financial = toolDefs.filter((t) => t.tier === 'financial');
		expect(financial.map((t) => t.name).sort()).toEqual(
			['agent_card_cancel', 'agent_card_create', 'agent_card_reveal', 'agent_card_withdraw'],
		);
		for (const t of financial) {
			expect(t.inputSchema.required).toContain(t.confirmFlag);
			expect(byName[t.previewTool]).toBeTruthy();
			expect(t.scope).toBe('wallet:write');
		}
		expect(byName.agent_card_create.confirmFlag).toBe('confirm_spend');
		expect(byName.agent_card_create.inputSchema.required).toContain('quote_id');
		expect(byName.agent_card_reveal.inputSchema.required).toContain('preview_id');
	});

	it('the hosted catalog moves policy fields under _meta', async () => {
		const { TOOL_CATALOG } = await import('../api/_mcp/catalog.js');
		const create = TOOL_CATALOG.find((t) => t.name === 'agent_card_create');
		expect(create).toBeTruthy();
		expect(create.tier).toBeUndefined();
		expect(create.scope).toBeUndefined();
		expect(create._meta['three.ws/policy']).toEqual({
			group: 'cards', tier: 'financial', confirmFlag: 'confirm_spend', previewTool: 'agent_card_quote',
		});
	});

	it('card tools refuse an anonymous caller', async () => {
		const r = await byName.agent_card_list.handler({ agent_id: '00000000-0000-4000-8000-000000000000' }, {});
		expect(r.isError).toBe(true);
		expect(r.structuredContent.error).toBe('unauthorized');
	});
});
