/**
 * GET /api/pump/launch-receipt?mint=<mint>
 *
 * A plain-English receipt for a pump.fun launch: what the mint and freeze
 * authorities actually let someone do, supply and decimals, the top-10
 * holder share, where trading fees are routed, the creation transaction's
 * version and size, and the Trade Safety Firewall's risk flags. Every input
 * already exists elsewhere on the platform (api/pump/token-stats.js,
 * the fee-info action in api/pump/[action].js, api/_lib/trade-firewall.js,
 * inspectWireTransaction): this endpoint composes them into one object
 * instead of sending a trader to five different panels.
 *
 * Each section is independent: when one source fails, that section alone is
 * marked `{ available: false, reason }`. The rest of the receipt still
 * renders: never an invented figure, never a 5xx for one missing signal.
 *
 * `content_hash` is a SHA-256 of the canonical (sorted-key) JSON of the
 * receipt body, so a downloaded or shared copy can be checked against a
 * fresh read of this endpoint.
 */

import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { cacheWrapLastGood } from '../_lib/cache.js';
import { getConnection } from '../_lib/pump.js';
import { assessTradeSafety } from '../_lib/trade-firewall.js';
import { findCreation } from '../_lib/coin/creation-tx.js';
import { stableStringify } from '../_lib/asset-provenance.js';
import { buildStats } from './token-stats.js';
import { computeFeeInfo } from './[action].js';

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CACHE_TTL_S = 60;
// Mirrors api/pump/safety.js's public-read probe: no payer on this path, so
// the round-trip simulation degrades to a `skip` and only the authority,
// venue and intel checks run.
const DEFAULT_PROBE_LAMPORTS = 50_000_000n; // 0.05 SOL

function unavailable(reason) {
	return { available: false, reason };
}

function authoritiesSection(authorities) {
	if (!authorities) return unavailable('could not read the mint account from chain');
	const mintEnabled = !!authorities.mint_authority;
	const freezeEnabled = !!authorities.freeze_authority;
	return {
		available: true,
		mint_authority: {
			address: authorities.mint_authority,
			enabled: mintEnabled,
			sentence: mintEnabled
				? 'An account can still mint new tokens, so total supply is not fixed.'
				: 'No account can mint new tokens; total supply is fixed.',
		},
		freeze_authority: {
			address: authorities.freeze_authority,
			enabled: freezeEnabled,
			sentence: freezeEnabled
				? "An account can freeze any holder's tokens, blocking them from moving or selling."
				: 'No account can freeze token accounts.',
		},
	};
}

function supplySection(authorities) {
	if (!authorities || authorities.supply == null || authorities.decimals == null) {
		return unavailable('could not read supply and decimals from the mint account');
	}
	const decimals = authorities.decimals;
	const raw = authorities.supply;
	let formatted = null;
	try {
		formatted = Number(BigInt(raw)) / 10 ** decimals;
	} catch {
		formatted = null;
	}
	return { available: true, raw, decimals, formatted };
}

function holdersSection(holders) {
	if (!holders) return unavailable('holder set could not be read (indexer and fallback RPC both failed)');
	if (holders.top10_pct == null) {
		return { available: true, top10_pct: null, holder_count: holders.count, sentence: 'Top-10 holder share could not be computed from the available holder set.' };
	}
	const pct = (holders.top10_pct * 100).toFixed(2);
	return {
		available: true,
		top10_pct: holders.top10_pct,
		holder_count: holders.count,
		sentence: `The ten largest wallets (excluding the bonding curve and AMM pool) hold ${pct}% of supply.`,
	};
}

function feeRoutingSection(feeInfo) {
	if (feeInfo === null) {
		return { available: true, applicable: false, sentence: 'This coin did not launch through pump.fun, so there is no fee-routing data to report.' };
	}
	const sentence = feeInfo.is_holder_reward
		? 'Trading fees are distributed to holders as rewards rather than to a creator wallet.'
		: feeInfo.is_cashback_coin
			? 'Trading fees are routed back to traders as cashback rather than to a creator wallet.'
			: feeInfo.has_sharing_config
				? "Trading fees are split among a fee-sharing configuration's listed shareholders."
				: "Trading fees flow directly to the coin's creator wallet.";
	return {
		available: true,
		applicable: true,
		destination: feeInfo.fee_destination,
		creator: feeInfo.creator,
		is_graduated: feeInfo.is_graduated,
		claimable_sol: feeInfo.claimable_sol,
		sharing_config: feeInfo.sharing_config,
		sentence,
	};
}

function riskSection(assessment) {
	if (!assessment) return unavailable('the trade safety firewall could not complete its checks');
	return {
		available: true,
		verdict: assessment.verdict,
		score: assessment.score,
		reasons: assessment.reasons,
		checks: assessment.checks,
	};
}

export async function buildReceipt(mint, network) {
	const connection = getConnection({ network });

	const [statsResult, feeResult, riskResult, creationResult] = await Promise.allSettled([
		buildStats(mint),
		computeFeeInfo(new PublicKey(mint), network),
		assessTradeSafety({ network, mint, side: 'buy', quoteAmount: DEFAULT_PROBE_LAMPORTS }),
		findCreation(connection, mint),
	]);

	const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
	const creation =
		creationResult.status === 'fulfilled' ? creationResult.value : unavailable(creationResult.reason?.message || 'creation lookup failed');

	const receiptCore = {
		mint,
		network,
		authorities: authoritiesSection(stats?.authorities),
		supply: supplySection(stats?.authorities),
		holders: holdersSection(stats?.holders),
		fee_routing:
			feeResult.status === 'fulfilled'
				? feeRoutingSection(feeResult.value)
				: unavailable(feeResult.reason?.message || 'fee routing could not be read from chain'),
		creation,
		risk:
			riskResult.status === 'fulfilled'
				? riskSection(riskResult.value)
				: unavailable(riskResult.reason?.message || 'the trade safety firewall could not complete its checks'),
		generated_at: new Date().toISOString(),
	};
	const content_hash = createHash('sha256').update(stableStringify(receiptCore)).digest('hex');
	return { ...receiptCore, content_hash };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
	const mint = (url.searchParams.get('mint') || '').trim();
	if (!MINT_RE.test(mint)) return error(res, 400, 'invalid_mint', 'mint must be a base58 address');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';

	const body = await cacheWrapLastGood(`pump:launch-receipt:${network}:${mint}`, CACHE_TTL_S, () => buildReceipt(mint, network));
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=300');
	return json(res, 200, body);
});
