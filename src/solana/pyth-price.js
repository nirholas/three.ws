/**
 * Pyth Network price feed integration via the Hermes REST/WebSocket API.
 * Read-only — no on-chain interaction required.
 *
 * Common price feed IDs from https://pyth.network/developers/price-feed-ids
 */

import { PriceServiceConnection } from '@pythnetwork/price-service-client';

// Pyth Hermes public endpoint
const HERMES_URL = 'https://hermes.pyth.network';

// Curated feed IDs for tokens commonly used in this platform
export const PRICE_FEED_IDS = {
	SOL:  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
	BTC:  'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
	ETH:  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
	USDC: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
	BONK: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
	WIF:  '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc',
	JUP:  '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
	PYTH: '0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff',
};

let _connection = null;

function getConnection() {
	if (!_connection) {
		_connection = new PriceServiceConnection(HERMES_URL, {
			priceFeedRequestConfig: { binary: false },
		});
	}
	return _connection;
}

/**
 * Parse a raw Pyth price+exponent into a human-readable float.
 * @param {import('@pythnetwork/price-service-client').Price} p
 * @returns {number}
 */
function toFloat(p) {
	if (!p) return NaN;
	return Number(p.price) * 10 ** Number(p.expo);
}

/**
 * Get the latest USD price for one or more tokens.
 *
 * @param {string|string[]} symbols  Token symbol(s), e.g. 'SOL' or ['SOL','BTC']
 * @returns {Promise<Record<string, {price: number, confidence: number, publishTime: number}>>}
 */
export async function getPrices(symbols) {
	const syms = Array.isArray(symbols) ? symbols : [symbols];
	const ids = syms.map((s) => {
		const id = PRICE_FEED_IDS[s.toUpperCase()];
		if (!id) throw new Error(`Unknown Pyth feed symbol: ${s}. Known: ${Object.keys(PRICE_FEED_IDS).join(', ')}`);
		return id;
	});

	const conn = getConnection();
	const feeds = await conn.getLatestPriceFeeds(ids);

	const result = {};
	for (let i = 0; i < syms.length; i++) {
		const feed = feeds?.[i];
		const p = feed?.getPriceUnchecked();
		result[syms[i].toUpperCase()] = {
			price: toFloat(p),
			confidence: p ? toFloat({ price: p.conf, expo: p.expo }) : NaN,
			publishTime: p?.publishTime ?? 0,
		};
	}
	return result;
}

/**
 * Get the USD price for a single token symbol.
 *
 * @param {string} symbol
 * @returns {Promise<{price: number, confidence: number, publishTime: number, symbol: string}>}
 */
export async function getPrice(symbol) {
	const map = await getPrices(symbol);
	return { symbol: symbol.toUpperCase(), ...map[symbol.toUpperCase()] };
}

/**
 * Register a real-time WebSocket price subscription.
 * Returns an unsubscribe function.
 *
 * @param {string[]} symbols
 * @param {(updates: Record<string, {price: number, confidence: number}>) => void} onUpdate
 * @returns {() => void} unsubscribe
 */
export function subscribePrices(symbols, onUpdate) {
	const ids = symbols.map((s) => {
		const id = PRICE_FEED_IDS[s.toUpperCase()];
		if (!id) throw new Error(`Unknown Pyth feed: ${s}`);
		return id;
	});

	const idToSymbol = Object.fromEntries(symbols.map((s, i) => [ids[i], s.toUpperCase()]));
	const conn = getConnection();

	conn.subscribePriceFeedUpdates(ids, (feed) => {
		const id = feed.id.replace(/^0x/, '');
		const sym = idToSymbol[id];
		if (!sym) return;
		const p = feed.getPriceUnchecked();
		const confidence = p ? toFloat({ price: p.conf, expo: p.expo }) : NaN;
		onUpdate({ [sym]: { price: toFloat(p), confidence, publishTime: p?.publishTime ?? 0 } });
	});

	return () => conn.unsubscribePriceFeedUpdates(ids);
}
