// Robinhood Crypto connector service: the one place REST routes and MCP tools
// go through, so credential handling, spend caps and the order ledger are
// identical on both surfaces.
//
//   connection   one per user: secret-box ciphertext of the API key and the
//                Ed25519 private key, the public key the owner registered,
//                and their caps (robinhood_crypto_connections)
//   ledger       every preview and order (robinhood_crypto_orders)
//
// Order flow: previewOrder prices and sizes an order, checks it against the
// caps and writes a 'previewed' row whose id is the preview_id (five minutes).
// placeOrder needs that id plus an explicit confirm, re-prices, reserves the
// spend under a per-user advisory lock (so two concurrent orders cannot both
// fit into the last dollar of the daily cap), and only then signs and sends.
//
// Crypto pairs only. Secrets never appear in a return value, error or log line.

import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';
import { runLocked } from '../locked-sql.js';
import { decryptSecret, encryptSecret } from '../secret-box.js';
import { RobinhoodApiError, createCryptoClient, isCryptoSymbol, privateKeyFromBase64, publicKeyBase64 } from './crypto-client.js';
import { checkOrder, parseCaps } from './spend-caps.js';
import { SizingError, notionalUsd, sizeOrder } from './order-sizing.js';

export const PREVIEW_TTL_MS = 5 * 60 * 1000;
/** A market buy whose fresh price is this much above the approved preview needs a new preview. */
export const MAX_PRICE_DRIFT = 0.02;
const SPENDING = ['submitting', 'placed', 'unknown'];

export class ConnectorError extends Error {
	constructor(status, code, message, details = null) {
		super(message);
		this.name = 'ConnectorError';
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

// Tests swap the client factory; production always builds the real signed client.
let clientFactory = createCryptoClient;
export function setClientFactory(factory) {
	clientFactory = factory || createCryptoClient;
}

const num = (v) => (v == null ? null : Number(v));

function connectionView(row) {
	if (!row) return { connected: false };
	return {
		connected: true,
		api_key_hint: row.api_key_hint,
		public_key: row.public_key_b64,
		account_number: row.account_number,
		per_order_cap_usd: num(row.per_order_cap_usd),
		daily_cap_usd: num(row.daily_cap_usd),
		trading_enabled: row.trading_enabled,
		last_verified_at: row.last_verified_at,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

export function orderView(row) {
	return {
		id: row.id,
		client_order_id: row.client_order_id,
		symbol: row.symbol,
		side: row.side,
		type: row.order_type,
		quantity: row.asset_quantity == null ? null : String(row.asset_quantity).replace(/\.?0+$/, ''),
		limit_price: row.limit_price == null ? null : String(row.limit_price).replace(/\.?0+$/, ''),
		est_price_usd: num(row.est_price_usd),
		notional_usd: num(row.notional_usd),
		status: row.status,
		source: row.source,
		robinhood_order_id: row.robinhood_order_id,
		robinhood_state: row.robinhood_state,
		error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
		preview_expires_at: row.preview_expires_at,
		placed_at: row.placed_at,
		created_at: row.created_at,
	};
}

/** Map a transport or sizing error to the boundary error both surfaces render. */
function toConnectorError(e) {
	if (e instanceof ConnectorError) return e;
	if (e instanceof SizingError) return new ConnectorError(400, e.code, e.message);
	if (e instanceof RobinhoodApiError) {
		const status = e.code === 'credentials_rejected' ? 424 : e.code === 'rate_limited' ? 429 : e.code === 'bad_request' || e.code === 'bad_private_key' || e.code === 'bad_api_key' ? 400 : 502;
		return new ConnectorError(status, e.code, e.message);
	}
	return null;
}

async function guard(fn) {
	try {
		return await fn();
	} catch (e) {
		const mapped = toConnectorError(e);
		if (mapped) throw mapped;
		throw e;
	}
}

async function loadConnection(userId) {
	const [row] = await sql`SELECT * FROM robinhood_crypto_connections WHERE user_id = ${userId}`;
	return row || null;
}

async function requireConnection(userId) {
	const row = await loadConnection(userId);
	if (!row) {
		throw new ConnectorError(409, 'not_connected', 'Connect your Robinhood Crypto API key first, on three.ws/settings/robinhood.', { settings_url: 'https://three.ws/settings/robinhood' });
	}
	return row;
}

async function clientFor(row) {
	const [apiKey, privateKey] = await Promise.all([decryptSecret(row.api_key_enc), decryptSecret(row.private_key_enc)]);
	return clientFactory({ apiKey, privateKey });
}

/** Today's (UTC) reserved buy spend in dollars. */
export async function spentTodayUsd(userId) {
	const [r] = await sql`
		SELECT COALESCE(SUM(notional_usd), 0) AS spent FROM robinhood_crypto_orders
		WHERE user_id = ${userId} AND side = 'buy' AND status = ANY(${SPENDING})
		  AND reserved_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;
	return Number(r?.spent || 0);
}

function capsView(row, spent) {
	const daily = num(row.daily_cap_usd);
	return {
		per_order_cap_usd: num(row.per_order_cap_usd),
		daily_cap_usd: daily,
		spent_today_usd: Math.round(spent * 100) / 100,
		remaining_today_usd: Math.max(0, Math.round((daily - spent) * 100) / 100),
		resets_at: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
	};
}

// ── Connection ────────────────────────────────────────────────────────────────

export async function getConnection({ userId }) {
	const row = await loadConnection(userId);
	if (!row) return { connection: connectionView(null), caps: null };
	return { connection: connectionView(row), caps: capsView(row, await spentTodayUsd(userId)) };
}

/**
 * Save (or replace) the owner's credential. The key pair is verified live
 * against Robinhood's account endpoint before anything is stored, so a typo
 * never lands in the vault.
 */
export async function saveCredentials({ userId, apiKey, privateKey, perOrderCapUsd, dailyCapUsd }) {
	return guard(async () => {
		const key = String(apiKey || '').trim();
		const secret = String(privateKey || '').trim();
		if (!/^[\w-]{8,200}$/.test(key)) throw new ConnectorError(400, 'bad_api_key', 'Paste the API key Robinhood showed you when you created the credential.');
		const keyObject = privateKeyFromBase64(secret);
		const existing = await loadConnection(userId);
		const caps = parseCaps({
			per_order_cap_usd: perOrderCapUsd ?? num(existing?.per_order_cap_usd) ?? undefined,
			daily_cap_usd: dailyCapUsd ?? num(existing?.daily_cap_usd) ?? undefined,
		});
		if (!caps.ok) throw new ConnectorError(400, 'bad_caps', caps.message);

		const account = await clientFactory({ apiKey: key, privateKey: keyObject }).getAccount();
		const [apiKeyEnc, privateKeyEnc] = await Promise.all([encryptSecret(key), encryptSecret(secret)]);
		const hint = `…${key.slice(-4)}`;
		const publicKey = publicKeyBase64(keyObject);
		const accountNumber = typeof account?.account_number === 'string' ? account.account_number : null;
		const [row] = await sql`
			INSERT INTO robinhood_crypto_connections
				(user_id, api_key_enc, private_key_enc, api_key_hint, public_key_b64, account_number, per_order_cap_usd, daily_cap_usd, last_verified_at)
			VALUES (${userId}, ${apiKeyEnc}, ${privateKeyEnc}, ${hint}, ${publicKey}, ${accountNumber}, ${caps.perOrder}, ${caps.daily}, now())
			ON CONFLICT (user_id) DO UPDATE SET
				api_key_enc = EXCLUDED.api_key_enc, private_key_enc = EXCLUDED.private_key_enc,
				api_key_hint = EXCLUDED.api_key_hint, public_key_b64 = EXCLUDED.public_key_b64,
				account_number = EXCLUDED.account_number, per_order_cap_usd = EXCLUDED.per_order_cap_usd,
				daily_cap_usd = EXCLUDED.daily_cap_usd, last_verified_at = now(), updated_at = now()
			RETURNING *`;
		return { connection: connectionView(row), caps: capsView(row, await spentTodayUsd(userId)) };
	});
}

/** Change caps or pause trading without re-pasting the key. */
export async function updateSettings({ userId, perOrderCapUsd, dailyCapUsd, tradingEnabled }) {
	const row = await requireConnection(userId);
	const caps = parseCaps({
		per_order_cap_usd: perOrderCapUsd ?? num(row.per_order_cap_usd),
		daily_cap_usd: dailyCapUsd ?? num(row.daily_cap_usd),
	});
	if (!caps.ok) throw new ConnectorError(400, 'bad_caps', caps.message);
	const enabled = typeof tradingEnabled === 'boolean' ? tradingEnabled : row.trading_enabled;
	const [next] = await sql`
		UPDATE robinhood_crypto_connections
		SET per_order_cap_usd = ${caps.perOrder}, daily_cap_usd = ${caps.daily}, trading_enabled = ${enabled}, updated_at = now()
		WHERE user_id = ${userId} RETURNING *`;
	return { connection: connectionView(next), caps: capsView(next, await spentTodayUsd(userId)) };
}

/** Delete the stored credential. The order ledger stays, for the owner's records. */
export async function revoke({ userId }) {
	const rows = await sql`DELETE FROM robinhood_crypto_connections WHERE user_id = ${userId} RETURNING user_id`;
	await sql`UPDATE robinhood_crypto_orders SET status = 'expired', updated_at = now() WHERE user_id = ${userId} AND status = 'previewed'`;
	return { revoked: rows.length > 0, connection: connectionView(null) };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Holdings, each priced at the live bid (what selling would fetch). */
export async function holdings({ userId }) {
	return guard(async () => {
		const client = await clientFor(await requireConnection(userId));
		const rows = await client.holdings();
		const symbols = rows.map((h) => `${h.asset_code}-USD`).filter(isCryptoSymbol);
		const quotes = symbols.length ? await client.bestBidAskMany(symbols) : [];
		const bid = new Map(quotes.map((q) => [q.symbol, Number(q.bid_inclusive_of_sell_spread ?? q.price)]));
		const positions = rows.map((h) => {
			const symbol = `${h.asset_code}-USD`;
			const qty = Number(h.total_quantity);
			const price = bid.get(symbol);
			return {
				asset: h.asset_code,
				symbol,
				quantity: h.total_quantity,
				available: h.quantity_available_for_trading,
				bid_usd: Number.isFinite(price) ? price : null,
				value_usd: Number.isFinite(price) && Number.isFinite(qty) ? Math.round(price * qty * 100) / 100 : null,
			};
		});
		positions.sort((a, b) => (b.value_usd ?? -1) - (a.value_usd ?? -1));
		return {
			positions,
			total_value_usd: Math.round(positions.reduce((s, p) => s + (p.value_usd || 0), 0) * 100) / 100,
			unpriced_count: positions.filter((p) => p.value_usd == null).length,
			as_of: new Date().toISOString(),
		};
	});
}

/** Live best bid and ask for one or more pairs. */
export async function quote({ userId, symbols }) {
	return guard(async () => {
		const list = (Array.isArray(symbols) ? symbols : [symbols]).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean);
		if (!list.length) throw new ConnectorError(400, 'bad_request', 'Name at least one pair, in the form ASSET-USD.');
		const bad = list.find((s) => !isCryptoSymbol(s));
		if (bad) throw new ConnectorError(400, 'bad_request', `${bad} is not a crypto pair. Use the form ASSET-USD.`);
		const client = await clientFor(await requireConnection(userId));
		const rows = await client.bestBidAskMany(list);
		return {
			quotes: rows.map((q) => ({
				symbol: q.symbol,
				mid_usd: num(q.price),
				bid_usd: num(q.bid_inclusive_of_sell_spread),
				ask_usd: num(q.ask_inclusive_of_buy_spread),
				timestamp: q.timestamp || null,
			})),
			missing: list.filter((s) => !rows.some((q) => q.symbol === s)),
			as_of: new Date().toISOString(),
		};
	});
}

export async function listOrders({ userId, limit = 25 }) {
	const n = Math.min(Math.max(Number(limit) || 25, 1), 100);
	const rows = await sql`SELECT * FROM robinhood_crypto_orders WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${n}`;
	return { orders: rows.map(orderView) };
}

// ── Orders ────────────────────────────────────────────────────────────────────

async function priceFor(client, symbol, side, quantity) {
	const est = await client.estimatedPrice(symbol, side === 'buy' ? 'ask' : 'bid', quantity);
	const p = Number(side === 'buy' ? (est?.ask_inclusive_of_buy_spread ?? est?.price) : (est?.bid_inclusive_of_sell_spread ?? est?.price));
	if (!Number.isFinite(p) || p <= 0) throw new ConnectorError(502, 'unpriced', 'Robinhood returned no price for this pair. Try again in a moment.');
	return p;
}

/**
 * Price, size and cap-check an order, and record it as a five minute preview.
 * Moves nothing. Returns the confirm table the owner must approve.
 */
export async function previewOrder({ userId, source, symbol, side, type = 'market', quantity, amountUsd, limitPrice }) {
	return guard(async () => {
		const pair = String(symbol || '').trim().toUpperCase();
		if (!isCryptoSymbol(pair)) throw new ConnectorError(400, 'bad_request', 'symbol must be a crypto pair in the form ASSET-USD.');
		if (side !== 'buy' && side !== 'sell') throw new ConnectorError(400, 'bad_request', 'side must be buy or sell.');
		if (type !== 'market' && type !== 'limit') throw new ConnectorError(400, 'bad_request', 'type must be market or limit.');
		if (type === 'limit' && !(Number(limitPrice) > 0)) throw new ConnectorError(400, 'bad_request', 'A limit order needs a positive limit_price.');

		const conn = await requireConnection(userId);
		if (!conn.trading_enabled) throw new ConnectorError(403, 'trading_paused', 'Trading is paused for this connection. Resume it on three.ws/settings/robinhood.');
		const client = await clientFor(conn);
		const pairInfo = await client.tradingPair(pair);

		// A dollar amount is converted to a quantity at a small-size price, then
		// the exact quantity is priced again so the estimate reflects book depth.
		const byDollars = amountUsd !== undefined && amountUsd !== null && amountUsd !== '';
		const unitPrice = type === 'limit' ? Number(limitPrice) : byDollars ? await priceFor(client, pair, side, pairInfo?.min_order_size || '1') : 0;
		const sized = sizeOrder({ quantity, amountUsd, priceUsd: unitPrice, pair: pairInfo });
		const estPrice = type === 'limit' ? Number(limitPrice) : await priceFor(client, pair, side, sized.quantity);
		const notional = notionalUsd({ type, quantity: sized.quantity, limitPrice, priceUsd: estPrice });

		const spent = await spentTodayUsd(userId);
		const verdict = checkOrder({ side, notionalUsd: notional, perOrderCapUsd: num(conn.per_order_cap_usd), dailyCapUsd: num(conn.daily_cap_usd), spentTodayUsd: spent });
		if (!verdict.ok) throw new ConnectorError(403, verdict.code, verdict.message, { caps: capsView(conn, spent), notional_usd: notional });

		const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
		const [row] = await sql`
			INSERT INTO robinhood_crypto_orders
				(user_id, client_order_id, symbol, side, order_type, asset_quantity, limit_price, est_price_usd, notional_usd, status, source, preview_expires_at)
			VALUES (${userId}, ${randomUUID()}, ${pair}, ${side}, ${type}, ${sized.quantity}, ${type === 'limit' ? String(limitPrice) : null},
				${estPrice}, ${notional}, 'previewed', ${source}, ${expiresAt})
			RETURNING *`;
		return {
			preview_id: row.id,
			expires_at: expiresAt.toISOString(),
			order: orderView(row),
			confirm: {
				venue: 'Robinhood Crypto',
				account: conn.account_number,
				pair,
				side,
				type,
				quantity: sized.quantity,
				...(type === 'limit' ? { limit_price_usd: Number(limitPrice) } : { est_price_usd: estPrice }),
				est_total_usd: notional,
			},
			caps: capsView(conn, spent),
			next: { tool: 'robinhood_place_order', args: { preview_id: row.id, confirm_order: true } },
		};
	});
}

/** Why a reservation did not take, in the owner's words. */
async function explainRefusal(userId, row) {
	const conn = await loadConnection(userId);
	if (!conn) return new ConnectorError(409, 'not_connected', 'The Robinhood connection was removed before this order was placed.');
	if (!conn.trading_enabled) return new ConnectorError(403, 'trading_paused', 'Trading was paused before this order was placed.');
	const spent = await spentTodayUsd(userId);
	const v = checkOrder({ side: row.side, notionalUsd: num(row.notional_usd), perOrderCapUsd: num(conn.per_order_cap_usd), dailyCapUsd: num(conn.daily_cap_usd), spentTodayUsd: spent });
	if (!v.ok) return new ConnectorError(403, v.code, v.message, { caps: capsView(conn, spent) });
	return new ConnectorError(409, 'preview_used', 'This preview was used by another request at the same moment. Check your recent orders before retrying.');
}

/**
 * Place a previewed order. Needs the preview_id and confirm_order: true, which
 * a caller may only send after the owner approved the preview's confirm table.
 */
export async function placeOrder({ userId, previewId, confirmOrder }) {
	return guard(async () => {
		if (confirmOrder !== true) {
			throw new ConnectorError(400, 'confirm_required', 'Placing an order needs confirm_order: true, sent only after the owner approved the preview.', { preview_tool: 'robinhood_preview_order' });
		}
		if (typeof previewId !== 'string' || !/^[0-9a-f-]{36}$/i.test(previewId)) {
			throw new ConnectorError(400, 'preview_required', 'Pass the preview_id from robinhood_preview_order (POST /api/v1/robinhood/crypto/orders/preview).');
		}
		const [row] = await sql`SELECT * FROM robinhood_crypto_orders WHERE id = ${previewId} AND user_id = ${userId}`;
		if (!row) throw new ConnectorError(404, 'preview_not_found', 'No preview with that id exists on this account.');
		if (row.status !== 'previewed') throw new ConnectorError(409, 'preview_used', `This preview is already ${row.status}. Preview the order again to place another.`, { order: orderView(row) });
		if (new Date(row.preview_expires_at).getTime() < Date.now()) {
			await sql`UPDATE robinhood_crypto_orders SET status = 'expired', updated_at = now() WHERE id = ${row.id} AND status = 'previewed'`;
			throw new ConnectorError(410, 'preview_expired', 'This preview is more than five minutes old. Preview the order again so the price is current.');
		}

		const conn = await requireConnection(userId);
		const client = await clientFor(conn);
		const quantity = String(row.asset_quantity).replace(/\.?0+$/, '');

		// A market buy is re-priced: the owner approved a dollar figure, so a
		// price that ran away since the preview needs a fresh approval.
		let notional = num(row.notional_usd);
		if (row.order_type === 'market') {
			const fresh = notionalUsd({ type: 'market', quantity, priceUsd: await priceFor(client, row.symbol, row.side, quantity) });
			if (row.side === 'buy' && fresh > notional * (1 + MAX_PRICE_DRIFT)) {
				throw new ConnectorError(409, 'price_moved', `The price moved since the preview: this order is now about $${fresh.toFixed(2)}, not $${notional.toFixed(2)}. Preview it again.`, { previewed_usd: notional, current_usd: fresh });
			}
			notional = Math.max(notional, fresh);
		}

		const [reserved] = await runLocked(
			[`robinhood-crypto:${userId}`],
			sql`
				UPDATE robinhood_crypto_orders o
				SET status = 'submitting', reserved_at = now(), notional_usd = ${notional}, updated_at = now()
				FROM robinhood_crypto_connections c
				WHERE o.id = ${row.id} AND o.status = 'previewed' AND c.user_id = o.user_id AND c.trading_enabled
				  AND (o.side = 'sell' OR (
					${notional} <= c.per_order_cap_usd AND
					${notional} + (
						SELECT COALESCE(SUM(s.notional_usd), 0) FROM robinhood_crypto_orders s
						WHERE s.user_id = o.user_id AND s.side = 'buy' AND s.status = ANY(${SPENDING})
						  AND s.reserved_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
					) <= c.daily_cap_usd))
				RETURNING o.*`,
		);
		if (!reserved) throw await explainRefusal(userId, { ...row, notional_usd: notional });

		try {
			const placed = await client.placeOrder({
				symbol: row.symbol,
				side: row.side,
				type: row.order_type,
				quantity,
				limitPrice: row.limit_price == null ? undefined : String(row.limit_price).replace(/\.?0+$/, ''),
				clientOrderId: row.client_order_id,
				notionalUsd: notional,
				maxNotionalUsd: row.side === 'buy' ? num(conn.per_order_cap_usd) : notional,
			});
			const [done] = await sql`
				UPDATE robinhood_crypto_orders
				SET status = 'placed', robinhood_order_id = ${placed?.id ?? null}, robinhood_state = ${placed?.state ?? null}, placed_at = now(), updated_at = now()
				WHERE id = ${row.id} RETURNING *`;
			return { order: orderView(done), caps: capsView(conn, await spentTodayUsd(userId)) };
		} catch (e) {
			// A definite refusal releases the reservation. No answer at all keeps
			// it: the order may exist at Robinhood, so it still counts against the cap.
			const definite = e instanceof RobinhoodApiError && e.status != null && e.status < 500;
			const code = e instanceof RobinhoodApiError ? e.code : 'internal_error';
			const message = e instanceof RobinhoodApiError ? e.message : 'The order could not be sent.';
			await sql`
				UPDATE robinhood_crypto_orders
				SET status = ${definite ? 'failed' : 'unknown'}, error_code = ${code}, error_message = ${message}, updated_at = now()
				WHERE id = ${row.id}`;
			if (!definite && e instanceof RobinhoodApiError) {
				throw new ConnectorError(502, 'order_status_unknown', 'Robinhood did not confirm the order. Check your Robinhood app before retrying; the amount stays counted against today\'s cap.', { order_id: row.id, client_order_id: row.client_order_id });
			}
			throw e;
		}
	});
}
