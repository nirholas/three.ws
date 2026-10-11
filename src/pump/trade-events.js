// Pump bonding-curve trades from decoded Anchor events, with synthetic
// migration folded in.
//
// Since pump-sdk 4.0 the v3 buy (or a multi_hop_swap curve hop) that empties a
// bonding curve keeps buying past it, from the tokens that would seed the
// PumpSwap pool. It emits three events in order: `TradeEvent` (the curve part
// only), `CompleteEvent`, then `PostCompleteBuyEvent` (the pool part). The
// buyer's real trade is the sum of both parts, so a consumer that reads
// `TradeEvent` alone undercounts exactly the largest buy a coin ever sees.
// Docs: https://github.com/pump-fun/pump-public-docs/blob/main/docs/SYNTHETIC_MIGRATION.md
//
// Pure and browser-safe: the API trade firehose, the MCP trade tools and the
// in-browser whale watcher share it.

const SOL_QUOTES = new Set(['So11111111111111111111111111111111111111112', '11111111111111111111111111111111']);

/**
 * Read a decoded event field under either casing: the current anchor + pump
 * IDL emits snake_case, older toolchains camelCased it.
 * @param {Record<string, any> | null | undefined} data
 * @param {string} snake
 */
function field(data, snake) {
	if (data == null) return undefined;
	if (data[snake] !== undefined) return data[snake];
	return data[snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
}

/** @param {unknown} v */
function toBigInt(v) {
	if (v == null) return 0n;
	try {
		return BigInt(String(/** @type {any} */ (v).toString()));
	} catch {
		return 0n;
	}
}

/** @param {unknown} key */
function keyString(key) {
	return key == null ? '' : String(/** @type {any} */ (key).toString());
}

/**
 * @typedef {object} PumpTrade
 * @property {Record<string, any>} data   the `TradeEvent` fields as decoded
 * @property {string} mint
 * @property {string} user
 * @property {boolean} isBuy
 * @property {bigint} solAmount     lamports for the whole trade (curve part plus a SOL pool part)
 * @property {bigint} tokenAmount   base units for the whole trade
 * @property {Record<string, any> | null} postComplete  the `PostCompleteBuyEvent` fields, when this buy completed the curve
 */

/**
 * Every `TradeEvent` in one transaction's decoded events, each with the
 * `PostCompleteBuyEvent` that follows it (same mint and buyer) folded into its
 * amounts. Order is preserved.
 *
 * @param {Iterable<{ name: string, data: Record<string, any> }>} events
 * @returns {PumpTrade[]}
 */
export function pumpTradesFromEvents(events) {
	/** @type {PumpTrade[]} */
	const trades = [];
	for (const event of events) {
		if (event?.name === 'TradeEvent') {
			const d = event.data;
			trades.push({
				data: d,
				mint: keyString(d?.mint),
				user: keyString(d?.user),
				isBuy: !!field(d, 'is_buy'),
				solAmount: toBigInt(field(d, 'sol_amount')),
				tokenAmount: toBigInt(field(d, 'token_amount')),
				postComplete: null,
			});
			continue;
		}
		if (event?.name !== 'PostCompleteBuyEvent') continue;
		const p = event.data;
		const mint = keyString(p?.mint);
		const user = keyString(p?.user);
		for (let i = trades.length - 1; i >= 0; i--) {
			const t = trades[i];
			if (!t.isBuy || t.postComplete || t.mint !== mint || t.user !== user) continue;
			t.postComplete = p;
			t.tokenAmount += toBigInt(field(p, 'base_out'));
			const quote = keyString(field(p, 'quote_mint'));
			if (!quote || SOL_QUOTES.has(quote)) t.solAmount += toBigInt(field(p, 'quote_in'));
			break;
		}
	}
	return trades;
}
