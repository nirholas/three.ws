// GET /api/coin/dextools?address=<token-address>[&network=<geckoterminal-network>][&from=<surface>]
// ---------------------------------------------------------------------------
// One link that lands on a token's DEXTools pair page, from anywhere on
// three.ws. DEXTools keys a market by its pool account, three.ws keys
// everything by mint, and a list of coins cannot afford a pool lookup per row
// just to render an anchor. So every DEXTools link points here instead: this
// resolves the most-liquid pool through the same keyless chain /api/coin/pool
// uses (the same keyless failover chain the chart switcher resolves pools
// with), and 302s to the pair page.
//
// Each redirect also bumps an aggregate counter in `dextools_referrals`, keyed
// by UTC day, token and the surface that sent the visit (`from`). Social Boost
// ranks by pair-page visits, so this is the number the DEXTools partnership is
// measured in. Counting never blocks the redirect: a DB outage still lands the
// visitor on DEXTools.
//
// A token with no resolvable pool still lands on DEXTools, on the pair-explorer
// route keyed by the token itself. For a bonding-curve launch DEXTools files the
// mint as the curve's own pair (checked 2026-10-08), which is the live market for
// a coin that has not graduated, and the very case where no pool resolves yet.
// A graduated coin must go through the pool lookup: its mint page is the dead
// curve.
//
// $THREE is pinned to the pair DEXTools tracks it under and credited its Social
// Boost wins to (a three / SOL pool), not the deeper pool a liquidity ranking
// picks, so every visit we send counts on the board we won.

import { cors, method, wrap, error, redirect, rateLimited, reportServerError } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { topPoolForToken } from '../_lib/market/ohlcv.js';
import { sql, isDbUnavailableError } from '../_lib/db.js';
import { THREE_DEXTOOLS_PAIR } from '../../src/pump/dextools-social-boost.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

/** Tokens whose DEXTools pair is fixed rather than resolved by liquidity. */
const PINNED_PAIRS = { [`solana:${THREE_MINT}`]: THREE_DEXTOOLS_PAIR };

// GeckoTerminal network id (what /api/coin/pool takes) -> DEXTools chain slug.
const DEXTOOLS_CHAIN = {
	solana: 'solana',
	eth: 'ether',
	base: 'base',
	bsc: 'bnb',
	polygon_pos: 'polygon',
	arbitrum: 'arbitrum',
	optimism: 'optimism',
	avax: 'avalanche',
};

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SURFACE_RE = /^[a-z0-9-]{1,40}$/;

export function dextoolsPairUrl(network, pairOrToken) {
	return `https://www.dextools.io/app/${DEXTOOLS_CHAIN[network]}/pair-explorer/${encodeURIComponent(pairOrToken)}`;
}

async function resolvePool(address, network) {
	const pinned = PINNED_PAIRS[`${network}:${address}`];
	if (pinned) return pinned;
	try {
		return (await topPoolForToken(address, network)) || null;
	} catch {
		// No pool, a throttle, or an outage all end the same way for a visitor:
		// the token-keyed page (see the header). The chart switcher is where a
		// missing pool is worth explaining; a link just has to land.
		return null;
	}
}

async function countReferral(network, token, surface) {
	try {
		await sql`
			insert into dextools_referrals (day, network, token, surface, visits)
			values ((now() at time zone 'utc')::date, ${network}, ${token}, ${surface}, 1)
			on conflict (day, network, token, surface)
			do update set visits = dextools_referrals.visits + 1, last_at = now()
		`;
	} catch (err) {
		if (!isDbUnavailableError(err)) reportServerError(err, { code: 'dextools_referral_count', context: { network, surface } });
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.marketDataIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, 'http://x').searchParams;
	const address = (params.get('address') || '').trim();
	const network = (params.get('network') || 'solana').trim();
	const fromRaw = (params.get('from') || '').trim().toLowerCase();
	const surface = SURFACE_RE.test(fromRaw) ? fromRaw : 'direct';

	if (!DEXTOOLS_CHAIN[network]) {
		return error(res, 400, 'bad_network', 'network must be a supported GeckoTerminal network id');
	}
	const wellFormed = network === 'solana' ? SOL_RE.test(address) : EVM_RE.test(address);
	if (!wellFormed) {
		return error(res, 400, 'bad_address', 'address is not a valid token address for the network');
	}

	const [pool] = await Promise.all([resolvePool(address, network), countReferral(network, address, surface)]);
	return redirect(res, dextoolsPairUrl(network, pool || address));
});
