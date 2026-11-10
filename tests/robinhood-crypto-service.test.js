// Robinhood Crypto connector service, run against the real migration in an
// in-process Postgres (PGlite) and the real signed client. Only Robinhood's
// HTTP endpoint is replaced, at the fetch boundary, so these tests exercise the
// actual cap reservation SQL, the ledger transitions and the secret vault.
//
// Pairs use the synthetic THREE-USD symbol; nothing here names a real listing.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || 'r'.repeat(64);

const dbState = { pg: null };

// sql`` builds a lazy query: awaiting it runs it, and sql.transaction runs a
// list of them inside one PGlite transaction (what runLocked relies on).
vi.mock('../api/_lib/db.js', () => {
	const build = (strings, values) => ({
		text: strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), ''),
		values,
	});
	const sql = (strings, ...values) => {
		const q = build(strings, values);
		return { ...q, then: (res, rej) => dbState.pg.query(q.text, q.values).then((r) => r.rows).then(res, rej) };
	};
	sql.transaction = (queries) =>
		dbState.pg.transaction(async (tx) => {
			const out = [];
			for (const q of queries) out.push((await tx.query(q.text, q.values)).rows);
			return out;
		});
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

await import('../api/_lib/db.js');
const svc = await import('../api/_lib/robinhood/service.js');
const { createCryptoClient } = await import('../api/_lib/robinhood/crypto-client.js');
const { sizeOrder, notionalUsd, toFixed18, fromFixed18 } = await import('../api/_lib/robinhood/order-sizing.js');

const USER = '77777777-7777-4777-8777-777777777777';
const API_KEY = 'rh-api-key-SECRETVALUE-1234';
const PRIVATE_KEY = Buffer.alloc(32, 9).toString('base64');
const PAIR = 'THREE-USD';

// Robinhood, at the HTTP boundary.
const rh = { price: '2.00', reject: false, orderStatus: 200, posts: [] };
async function fakeFetch(url, init) {
	const u = new URL(url);
	const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
	if (rh.reject) return json(401, { detail: 'bad signature' });
	if (u.pathname === '/api/v1/crypto/trading/accounts/') return json(200, { account_number: 'ACCT-1', status: 'active' });
	if (u.pathname === '/api/v1/crypto/trading/trading_pairs/') {
		return json(200, { results: [{ symbol: u.searchParams.get('symbol'), asset_increment: '0.01', min_order_size: '1', max_order_size: '100000', status: 'tradable' }] });
	}
	if (u.pathname === '/api/v1/crypto/marketdata/estimated_price/') {
		return json(200, { results: [{ symbol: PAIR, price: rh.price, ask_inclusive_of_buy_spread: rh.price, bid_inclusive_of_sell_spread: rh.price }] });
	}
	if (u.pathname === '/api/v1/crypto/marketdata/best_bid_ask/') {
		return json(200, { results: u.searchParams.getAll('symbol').map((s) => ({ symbol: s, price: rh.price, bid_inclusive_of_sell_spread: rh.price, ask_inclusive_of_buy_spread: rh.price })) });
	}
	if (u.pathname === '/api/v1/crypto/trading/holdings/') {
		return json(200, { results: [{ asset_code: 'THREE', total_quantity: '150', quantity_available_for_trading: '150' }], next: null });
	}
	if (u.pathname === '/api/v1/crypto/trading/orders/' && init.method === 'POST') {
		rh.posts.push({ headers: init.headers, body: JSON.parse(init.body) });
		return rh.orderStatus === 200 ? json(200, { id: `rh-${rh.posts.length}`, state: 'queued' }) : json(rh.orderStatus, {});
	}
	return json(404, {});
}

beforeAll(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec('create table users (id uuid primary key);');
	await dbState.pg.exec(readFileSync(new URL('../api/_lib/migrations/20261110090000_robinhood_crypto_connector.sql', import.meta.url), 'utf8'));
	await dbState.pg.query('insert into users (id) values ($1)', [USER]);
	svc.setClientFactory((cfg) => createCryptoClient({ ...cfg, fetchImpl: fakeFetch, sleep: async () => {} }));
});

beforeEach(async () => {
	Object.assign(rh, { price: '2.00', reject: false, orderStatus: 200, posts: [] });
	await dbState.pg.exec('delete from robinhood_crypto_orders; delete from robinhood_crypto_connections;');
});

const connect = (caps = {}) => svc.saveCredentials({ userId: USER, apiKey: API_KEY, privateKey: PRIVATE_KEY, perOrderCapUsd: 25, dailyCapUsd: 40, ...caps });
const preview = (args = {}) => svc.previewOrder({ userId: USER, source: 'session', symbol: PAIR, side: 'buy', amountUsd: 20, ...args });

describe('order sizing', () => {
	const pair = { asset_increment: '0.00000001', min_order_size: '0.000001', max_order_size: '20', status: 'tradable' };
	it('floors a dollar amount to the exact quantity step', () => {
		expect(sizeOrder({ amountUsd: 10, priceUsd: '3', pair })).toEqual({ quantity: '3.33333333' });
	});
	it('rejects an off-step quantity and out-of-range sizes', () => {
		expect(() => sizeOrder({ quantity: '0.000000001', priceUsd: '1', pair })).toThrow(/multiple of/);
		expect(() => sizeOrder({ quantity: '0.0000001', priceUsd: '1', pair })).toThrow(/minimum/);
		expect(() => sizeOrder({ quantity: '21', priceUsd: '1', pair })).toThrow(/maximum/);
	});
	it('needs exactly one of quantity and amount_usd, and a tradable pair', () => {
		expect(() => sizeOrder({ priceUsd: '1', pair })).toThrow(/either/);
		expect(() => sizeOrder({ quantity: '1', amountUsd: 1, priceUsd: '1', pair })).toThrow(/either/);
		expect(() => sizeOrder({ quantity: '1', priceUsd: '1', pair: { ...pair, status: 'untradable' } })).toThrow(/untradable/);
		expect(() => sizeOrder({ quantity: '1', priceUsd: '1', pair: null })).toThrow(/does not list/);
	});
	it('values a limit at its limit and rounds notional up to the cent', () => {
		expect(notionalUsd({ type: 'limit', quantity: '3', limitPrice: '1.001', priceUsd: '9' })).toBe(3.01);
		expect(notionalUsd({ type: 'market', quantity: '0.1', priceUsd: '0.3' })).toBe(0.03);
	});
	it('round-trips fixed point without float drift', () => {
		expect(fromFixed18(toFixed18('0.1') + toFixed18('0.2'))).toBe('0.3');
	});
});

describe('credentials', () => {
	it('verifies the key live, stores only ciphertext and never returns a secret', async () => {
		const out = await connect();
		expect(out.connection).toMatchObject({ connected: true, account_number: 'ACCT-1', api_key_hint: '…1234', per_order_cap_usd: 25, daily_cap_usd: 40 });
		const text = JSON.stringify(out);
		expect(text).not.toContain(API_KEY);
		expect(text).not.toContain(PRIVATE_KEY);
		const { rows } = await dbState.pg.query('select api_key_enc, private_key_enc from robinhood_crypto_connections');
		expect(rows[0].api_key_enc).not.toContain(API_KEY);
		expect(rows[0].private_key_enc).not.toContain(PRIVATE_KEY);
	});

	it('stores nothing when Robinhood rejects the key pair', async () => {
		rh.reject = true;
		await expect(connect()).rejects.toMatchObject({ code: 'credentials_rejected', status: 424 });
		const { rows } = await dbState.pg.query('select count(*)::int as n from robinhood_crypto_connections');
		expect(rows[0].n).toBe(0);
	});

	it('refuses caps where the per-order cap exceeds the daily cap', async () => {
		await connect();
		await expect(svc.updateSettings({ userId: USER, perOrderCapUsd: 50, dailyCapUsd: 40 })).rejects.toMatchObject({ code: 'bad_caps' });
	});

	it('revoke deletes the credential and voids open previews but keeps the ledger', async () => {
		await connect();
		const p = await preview();
		await svc.revoke({ userId: USER });
		expect((await svc.getConnection({ userId: USER })).connection.connected).toBe(false);
		const { rows } = await dbState.pg.query('select status from robinhood_crypto_orders where id = $1', [p.preview_id]);
		expect(rows[0].status).toBe('expired');
	});
});

describe('reads', () => {
	it('prices holdings at the live bid', async () => {
		await connect();
		const h = await svc.holdings({ userId: USER });
		expect(h.positions[0]).toMatchObject({ asset: 'THREE', symbol: PAIR, bid_usd: 2, value_usd: 300 });
		expect(h.total_value_usd).toBe(300);
	});

	it('needs a connection first', async () => {
		await expect(svc.quote({ userId: USER, symbols: [PAIR] })).rejects.toMatchObject({ code: 'not_connected' });
	});

	it('refuses a symbol that is not a crypto pair before any request', async () => {
		await connect();
		await expect(svc.quote({ userId: USER, symbols: ['THREE'] })).rejects.toMatchObject({ code: 'bad_request' });
	});
});

describe('orders and caps', () => {
	it('previews a dollar buy, sized to the step, without sending anything', async () => {
		await connect();
		const p = await preview({ amountUsd: 20 });
		expect(p.confirm).toMatchObject({ venue: 'Robinhood Crypto', pair: PAIR, side: 'buy', quantity: '10', est_total_usd: 20 });
		expect(p.caps).toMatchObject({ per_order_cap_usd: 25, remaining_today_usd: 40 });
		expect(rh.posts).toHaveLength(0);
	});

	it('refuses a preview above the per-order cap and records nothing', async () => {
		await connect();
		await expect(preview({ amountUsd: 30 })).rejects.toMatchObject({ code: 'over_per_order_cap' });
		const { rows } = await dbState.pg.query('select count(*)::int as n from robinhood_crypto_orders');
		expect(rows[0].n).toBe(0);
	});

	it('will not place without confirm_order: true', async () => {
		await connect();
		const p = await preview();
		await expect(svc.placeOrder({ userId: USER, previewId: p.preview_id, confirmOrder: 'yes' })).rejects.toMatchObject({ code: 'confirm_required' });
		expect(rh.posts).toHaveLength(0);
	});

	it('places a confirmed preview with its own client order id and marks it placed', async () => {
		await connect();
		const p = await preview();
		const out = await svc.placeOrder({ userId: USER, previewId: p.preview_id, confirmOrder: true });
		expect(out.order).toMatchObject({ status: 'placed', robinhood_order_id: 'rh-1', robinhood_state: 'queued' });
		expect(rh.posts[0].body).toMatchObject({ client_order_id: p.order.client_order_id, side: 'buy', type: 'market', symbol: PAIR, market_order_config: { asset_quantity: '10' } });
		expect(rh.posts[0].headers['x-signature']).toBeTruthy();
		expect(out.caps.spent_today_usd).toBe(20);
	});

	it('a preview works once', async () => {
		await connect();
		const p = await preview();
		await svc.placeOrder({ userId: USER, previewId: p.preview_id, confirmOrder: true });
		await expect(svc.placeOrder({ userId: USER, previewId: p.preview_id, confirmOrder: true })).rejects.toMatchObject({ code: 'preview_used' });
		expect(rh.posts).toHaveLength(1);
	});

	it('two concurrent orders cannot both fit into the daily cap', async () => {
		await connect();
		const [a, b] = [await preview({ amountUsd: 24 }), await preview({ amountUsd: 24 })];
		const results = await Promise.allSettled([
			svc.placeOrder({ userId: USER, previewId: a.preview_id, confirmOrder: true }),
			svc.placeOrder({ userId: USER, previewId: b.preview_id, confirmOrder: true }),
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ code: 'over_daily_cap' });
		expect(rh.posts).toHaveLength(1);
		expect(await svc.spentTodayUsd(USER)).toBe(24);
	});

	it('refuses an expired preview before any request', async () => {
		await connect();
		const p = await preview();
		await dbState.pg.query(`update robinhood_crypto_orders set preview_expires_at = now() - interval '1 second' where id = $1`, [p.preview_id]);
		await expect(svc.placeOrder({ userId: USER, previewId: p.preview_id, confirmOrder: true })).rejects.toMatchObject({ code: 'preview_expired' });
		expect(rh.posts).toHaveLength(0);
	});

	it('asks for a fresh preview when a market buy price ran away', async () => {
		await connect();
		const p = await preview({ amountUsd: 10 });
		rh.price = '2.10';
		await expect(svc.placeOrder({ userId: USER, previewId: p.preview_id, confirmOrder: true })).rejects.toMatchObject({ code: 'price_moved' });
		expect(rh.posts).toHaveLength(0);
	});

	it('keeps an unanswered order counted against the cap', async () => {
		await connect();
		const p = await preview();
		rh.orderStatus = 503;
		await expect(svc.placeOrder({ userId: USER, previewId: p.preview_id, confirmOrder: true })).rejects.toMatchObject({ code: 'order_status_unknown' });
		expect(rh.posts).toHaveLength(1);
		expect(await svc.spentTodayUsd(USER)).toBe(20);
	});

	it('releases the reservation when Robinhood definitely rejects the order', async () => {
		await connect();
		const p = await preview();
		rh.orderStatus = 400;
		await expect(svc.placeOrder({ userId: USER, previewId: p.preview_id, confirmOrder: true })).rejects.toMatchObject({ code: 'order_rejected' });
		expect(await svc.spentTodayUsd(USER)).toBe(0);
	});

	it('does not cap sells, and paused trading refuses every preview', async () => {
		await connect();
		await expect(preview({ side: 'sell', amountUsd: undefined, quantity: '100' })).resolves.toMatchObject({ confirm: { side: 'sell', est_total_usd: 200 } });
		await svc.updateSettings({ userId: USER, tradingEnabled: false });
		await expect(preview()).rejects.toMatchObject({ code: 'trading_paused' });
	});
});
