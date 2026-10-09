// What a paired coin is beyond its curves: its descriptor (logo, description,
// links) and, when a three.ws agent launched it, that agent.
//
// The descriptor lives off chain, but the coin commits keccak256 of its exact
// bytes at launch (PairedToken.metadataHash), so a descriptor is only shown as
// verified when the bytes fetched hash to that commitment. Content addressing
// makes the host irrelevant: three.ws and paired.exchange descriptors read the
// same way, and a fetched descriptor is cached for a day because it cannot
// change without failing verification.

import { keccak256 } from 'viem';
import { sql } from './db.js';
import { cacheWrap } from './cache.js';
import { thumbnailUrl } from './r2.js';
import { fetchUpstream } from './upstream-fetch.js';
import { publicClient } from './robinhood.js';
import { coinCached, erc20Abi, launchpadConfig, listCoins } from './paired-launchpad.js';
import { pairedMarkets, withUsd } from './paired-markets.js';
import { INTERVALS, coinTradesCached, launchBlockOf, toCandles } from './paired-trades.js';

const MAX_DESCRIPTOR_BYTES = 64 * 1024;

function httpsOrNull(v) {
	try {
		const u = new URL(String(v));
		return u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/** The descriptor at a metadata URI, with whether its bytes match the on-chain hash. */
export async function coinDescriptor(token, metadataURI) {
	const url = httpsOrNull(metadataURI);
	if (!url) return null;
	return cacheWrap(`paired:descriptor:${String(token).toLowerCase()}`, 86_400, async () => {
		const [res, committed] = await Promise.all([
			fetchUpstream(url, {}, { name: 'paired:descriptor', timeoutMs: 8_000, attempts: 2, okWhen: (r) => r.ok }).catch(() => null),
			publicClient(false).readContract({ address: token, abi: erc20Abi, functionName: 'metadataHash' }).catch(() => null),
		]);
		if (!res) return null;
		const bytes = Buffer.from(await res.arrayBuffer());
		if (bytes.byteLength > MAX_DESCRIPTOR_BYTES) return null;
		let json;
		try {
			json = JSON.parse(bytes.toString('utf8'));
		} catch {
			return null;
		}
		const links = json.links && typeof json.links === 'object' ? json.links : {};
		return {
			description: typeof json.description === 'string' ? json.description.slice(0, 600) : null,
			image: httpsOrNull(json.image),
			links: { website: httpsOrNull(links.website), twitter: httpsOrNull(links.twitter), telegram: httpsOrNull(links.telegram) },
			origin: json.origin && typeof json.origin === 'object' ? json.origin : null,
			verified: committed != null && keccak256(bytes) === committed,
		};
	});
}

/**
 * The three.ws agent behind each coin it launched, keyed by lower-case token
 * address. Coins launched elsewhere (directly on paired.exchange) are absent.
 */
export async function launchingAgents(tokens) {
	const list = [...new Set(tokens.map((t) => String(t)))];
	if (!list.length) return new Map();
	const rows = await sql`
		select f.mint, f.created_at, ai.id as agent_id, ai.name as agent_name,
		       a.thumbnail_key, a.visibility
		from fixed_supply_launches f
		left join agent_identities ai on ai.id = f.agent_id and ai.deleted_at is null
		left join avatars a on a.id = ai.avatar_id and a.deleted_at is null
		where f.chain = 'robinhood' and f.venue = 'paired' and f.mint = any(${list})
	`;
	const out = new Map();
	for (const r of rows) {
		if (!r.agent_id) continue;
		const shown = r.visibility === 'public' || r.visibility === 'unlisted';
		out.set(String(r.mint).toLowerCase(), {
			id: r.agent_id,
			name: r.agent_name,
			avatar: shown && r.thumbnail_key ? thumbnailUrl(r.thumbnail_key) : null,
			url: `/agents/${r.agent_id}`,
			launchedAt: r.created_at ? new Date(r.created_at).toISOString() : null,
		});
	}
	return out;
}

export const pairedCoinUrl = (address) => `/markets/robinhood/paired/${address}`;

/**
 * Paired coins newest first, each with dollar prices, its verified descriptor
 * and its launching agent. `agentId` narrows to coins one three.ws agent
 * launched; otherwise the list is every coin on the launchpad.
 */
export async function pairedCoinList({ limit = 24, offset = 0, agentId = null } = {}) {
	let coins;
	let total;
	if (agentId) {
		const rows = await sql`
			select mint from fixed_supply_launches
			where chain = 'robinhood' and venue = 'paired' and agent_id = ${agentId}
			order by created_at desc limit ${limit} offset ${offset}
		`;
		coins = (await Promise.all(rows.map((r) => coinCached(r.mint).catch(() => null)))).filter(Boolean);
		const [{ n }] = await sql`
			select count(*)::int as n from fixed_supply_launches
			where chain = 'robinhood' and venue = 'paired' and agent_id = ${agentId}
		`;
		total = n;
	} else {
		({ items: coins, total } = await listCoins({ limit, offset }));
	}

	const [markets, agents, descriptors] = await Promise.all([
		pairedMarkets({ includeDisabled: true }),
		launchingAgents(coins.map((c) => c.address)),
		Promise.all(coins.map((c) => coinDescriptor(c.address, c.metadataURI).catch(() => null))),
	]);
	const byQuote = new Map(markets.map((m) => [m.address.toLowerCase(), m]));
	const priceByQuote = new Map(markets.map((m) => [m.address.toLowerCase(), m.priceUsd]));

	const items = coins.map((c, i) => {
		const priced = withUsd(c, priceByQuote);
		return {
			...priced,
			pairs: priced.pairs.map((p) => ({ ...p, quoteClass: byQuote.get(p.quoteToken.toLowerCase())?.assetClass ?? 'unlisted' })),
			descriptor: descriptors[i],
			agent: agents.get(c.address.toLowerCase()) ?? null,
			url: pairedCoinUrl(c.address),
		};
	});
	return { coins: items, total, limit, offset, hasMore: offset + items.length < total };
}

const RECENT_TRADES = 60;

/**
 * One paired coin in full: pools priced in dollars with per-pool candles in
 * that pool's own quote units, the verified descriptor, the launching agent,
 * and the latest trades. Null when the address is not a coin on the launchpad.
 */
export async function pairedCoinDetail(address, { interval = '1h' } = {}) {
	const coin = await coinCached(address).catch(() => null);
	if (!coin) return null;
	const step = INTERVALS[interval] ? interval : '1h';

	const [config, markets, agents, descriptor, trades, launch] = await Promise.all([
		launchpadConfig(),
		pairedMarkets({ includeDisabled: true }),
		launchingAgents([coin.address]),
		coinDescriptor(coin.address, coin.metadataURI).catch(() => null),
		coinTradesCached(coin.address),
		launchBlockOf(coin.address),
	]);
	const byQuote = new Map(markets.map((m) => [m.address.toLowerCase(), m]));
	const priced = withUsd(coin, new Map(markets.map((m) => [m.address.toLowerCase(), m.priceUsd])));

	const pairs = priced.pairs.map((p) => {
		const m = byQuote.get(p.quoteToken.toLowerCase());
		const poolTrades = trades.filter((t) => t.quoteToken.toLowerCase() === p.quoteToken.toLowerCase());
		return {
			...p,
			quoteClass: m?.assetClass ?? 'unlisted',
			quoteName: m?.name ?? p.quoteSymbol,
			quotePriceUsd: m?.priceUsd ?? null,
			trades: poolTrades.length,
			volume: poolTrades.reduce((s, t) => s + t.quoteAmount, 0),
			candles: toCandles(poolTrades, INTERVALS[step]),
		};
	});

	return {
		...priced,
		pairs,
		descriptor,
		agent: agents.get(coin.address.toLowerCase()) ?? null,
		launch,
		url: pairedCoinUrl(coin.address),
		terms: { swapFeeBps: config.swapFeeBps, creatorShareBps: config.creatorShareBps, launchpad: config.launchpad },
		interval: step,
		intervals: Object.keys(INTERVALS),
		trades: trades.slice(-RECENT_TRADES).reverse(),
		tradeCount: trades.length,
	};
}
