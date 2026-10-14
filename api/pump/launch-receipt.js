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
import { inspectWireTransaction } from '../_lib/solana/transaction-v1.js';
import { stableStringify } from '../_lib/asset-provenance.js';
import { buildStats } from './token-stats.js';
import { computeFeeInfo } from './[action].js';

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CACHE_TTL_S = 60;
// Mirrors api/pump/safety.js's public-read probe: no payer on this path, so
// the round-trip simulation degrades to a `skip` and only the authority,
// venue and intel checks run.
const DEFAULT_PROBE_LAMPORTS = 50_000_000n; // 0.05 SOL

// Bounded walk-back for the creation signature: getSignaturesForAddress has
// no forward cursor, so finding the first transaction on a mint means paging
// backward from the newest. A heavily-traded coin can have far more history
// than is worth walking on a 60s-cached read, so this caps the cost rather
// than ever hanging the request.
const SIG_PAGE = 1000;
const CREATION_PAGE_BUDGET = 8;

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

/** Walk getSignaturesForAddress backward to the mint's first transaction, then inspect its wire bytes. Never throws: every failure mode returns `{ available: false, reason }`. */
async function findCreation(connection, mint) {
	try {
		let before;
		let earliestSig = null;
		let reachedGenesis = false;
		for (let page = 0; page < CREATION_PAGE_BUDGET; page++) {
			const params = before
				? [mint, { limit: SIG_PAGE, commitment: 'confirmed', before }]
				: [mint, { limit: SIG_PAGE, commitment: 'confirmed' }];
			const rpc = await connection._rpcRequest('getSignaturesForAddress', params);
			if (rpc.error) throw new Error(rpc.error.message || 'Solana RPC rejected getSignaturesForAddress');
			const sigs = Array.isArray(rpc.result) ? rpc.result : [];
			if (!sigs.length) {
				reachedGenesis = true;
				break;
			}
			earliestSig = sigs[sigs.length - 1];
			if (sigs.length < SIG_PAGE) {
				reachedGenesis = true;
				break;
			}
			before = earliestSig.signature;
		}
		if (!earliestSig) return unavailable('this mint has no transaction history on this RPC');
		if (!reachedGenesis) {
			return unavailable('this coin has too much trade history to walk back to its creation transaction within the lookup budget');
		}

		const txRpc = await connection._rpcRequest('getTransaction', [
			earliestSig.signature,
			{ encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
		]);
		if (txRpc.error) throw new Error(txRpc.error.message || 'Solana RPC rejected getTransaction');
		if (!txRpc.result) {
			return { available: false, reason: 'the creation transaction is too old for this RPC to serve', signature: earliestSig.signature };
		}
		const encoded = txRpc.result.transaction?.[0];
		if (typeof encoded !== 'string') {
			return { available: false, reason: 'the creation transaction came back in an unsupported encoding', signature: earliestSig.signature };
		}
		const inspection = inspectWireTransaction(encoded);
		return {
			available: true,
			signature: earliestSig.signature,
			slot: txRpc.result.slot ?? null,
			block_time: txRpc.result.blockTime ?? null,
			version: inspection.version,
			version_label: inspection.versionLabel,
			bytes: inspection.bytes,
			limit_bytes: inspection.limitBytes,
			utilization_pct: inspection.utilizationPct,
		};
	} catch (e) {
		return { available: false, reason: e?.message || 'creation lookup failed' };
	}
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
