// The Researcher's verdict on one mint, composed from the platform's live
// safety and intelligence sources:
//
//   - assessTradeSafety (api/_lib/trade-firewall.js): mint and freeze authority,
//     a tradable venue with real reserves, holder structure, sybil read.
//   - the Coin Intelligence row the sniper intel worker writes for every launch
//     it observed: quality, bundle and organic scores, dev behaviour, flags.
//   - getSmartMoneyForMint (api/_lib/smart-money.js): reputable buyers in it.
//
// researchMint() is the one seam the unified token report (order 945) replaces:
// it returns { verdict, score, subscores, reasons, evidence, sources } and every
// caller in the team runtime reads only that shape.
//
// Token metadata (name, symbol, description) is untrusted on-chain data. It is
// carried in evidence.identity for display and never folded into the summary or
// read as an instruction.

import { sql } from '../db.js';
import { assessTradeSafety } from '../trade-firewall.js';
import { getSmartMoneyForMint } from '../smart-money.js';

// The safety probe sizes its round-trip with this many lamports (0.05 SOL), the
// same default the public safety endpoint uses.
const PROBE_LAMPORTS = 50_000_000n;

const PASS_AT = 65;
const AVOID_BELOW = 40;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export async function loadIntelRow(mint, network) {
	const rows = await sql`
		select * from pump_coin_intel where mint = ${mint} and network = ${network} limit 1
	`;
	return rows[0] || null;
}

function shapeIntel(row) {
	if (!row) return null;
	return {
		quality_score: num(row.quality_score),
		bundle_score: num(row.bundle_score),
		organic_score: num(row.organic_score),
		concentration_top10: num(row.concentration_top10),
		fresh_wallet_ratio: num(row.fresh_wallet_ratio),
		dev_sold: row.dev_sold === true,
		risk_flags: Array.isArray(row.risk_flags) ? row.risk_flags.slice(0, 12) : [],
		category: row.category || null,
		buy_count: num(row.buy_count),
		sell_count: num(row.sell_count),
		unique_buyers: num(row.unique_buyers),
		unique_sellers: num(row.unique_sellers),
		observed_until: row.observation_ended_at || null,
	};
}

/**
 * Pure scoring: safety, intel and smart money in, verdict out. Exported so the
 * weighting is pinned by tests without a network.
 */
export function scoreResearch({ safety, intel, smartMoney }) {
	const safetyScore = num(safety?.score) ?? 0;
	const quality = num(intel?.quality_score);
	const smComputed = Boolean(smartMoney?.computed);
	const smScore = smComputed ? num(smartMoney.smart_money_score) ?? 0 : null;

	// Weights redistribute onto safety when a source has nothing to say yet, so a
	// brand-new coin is judged on what is known instead of being zeroed.
	let wSafety = 0.6;
	const wQuality = quality == null ? 0 : 0.3;
	const wSm = smScore == null ? 0 : 0.1;
	wSafety += (quality == null ? 0.3 : 0) + (smScore == null ? 0.1 : 0);
	const score = Math.round(safetyScore * wSafety + (quality ?? 0) * wQuality + (smScore ?? 0) * wSm);

	const reasons = [];
	for (const r of (safety?.reasons || []).slice(0, 3)) reasons.push(r);
	if (!intel) reasons.push('No intelligence record yet: holder structure and bundle risk are unverified.');
	if (intel?.dev_sold) reasons.push('The creator has sold.');
	if (intel?.bundle_score != null && intel.bundle_score >= 0.6) reasons.push('Launch looks coordinated (high bundle score).');
	if (smartMoney?.sybil_flag) reasons.push('Most buying comes from one linked wallet cluster.');
	if (smComputed && (smartMoney.count ?? 0) > 0) reasons.push(`${smartMoney.count} reputable wallet${smartMoney.count === 1 ? '' : 's'} hold it.`);

	let verdict;
	if (safety?.verdict === 'block' || score < AVOID_BELOW) verdict = 'avoid';
	else if (score >= PASS_AT && safety?.verdict === 'allow' && intel && !smartMoney?.sybil_flag && !intel.dev_sold) verdict = 'pass';
	else verdict = 'caution';

	return {
		verdict,
		score,
		subscores: { safety: safetyScore, quality, smart_money: smScore },
		reasons: reasons.slice(0, 6),
	};
}

export function researchSummary({ verdict, score, reasons }) {
	const label = { pass: 'Pass', caution: 'Caution', avoid: 'Avoid' }[verdict];
	const lead = reasons[0] ? ` ${reasons[0]}` : '';
	return `${label} at ${score}/100.${lead}`.slice(0, 600);
}

export async function researchMint({ mint, network = 'mainnet' }) {
	const net = network === 'devnet' ? 'devnet' : 'mainnet';
	const startedAt = new Date().toISOString();
	const [safety, intelRow, smartMoney] = await Promise.all([
		assessTradeSafety({ network: net, mint, side: 'buy', quoteAmount: PROBE_LAMPORTS }),
		loadIntelRow(mint, net).catch(() => null),
		getSmartMoneyForMint(mint, net).catch(() => null),
	]);
	const intel = shapeIntel(intelRow);
	const scored = scoreResearch({ safety, intel, smartMoney });
	const finishedAt = new Date().toISOString();

	return {
		...scored,
		summary: researchSummary(scored),
		evidence: {
			network: net,
			identity: intelRow ? { name: intelRow.name || null, symbol: intelRow.symbol || null } : null,
			subscores: scored.subscores,
			reasons: scored.reasons,
			safety: {
				verdict: safety.verdict,
				score: safety.score,
				checks: (safety.checks || []).map((c) => ({ name: c.name, status: c.status, reason: c.reason })),
			},
			intel,
			smart_money: smartMoney
				? { computed: Boolean(smartMoney.computed), score: num(smartMoney.smart_money_score), count: smartMoney.count ?? 0, sybil_flag: Boolean(smartMoney.sybil_flag) }
				: null,
			sources: [
				{ name: 'trade_firewall', at: finishedAt },
				{ name: 'coin_intel', at: intel?.observed_until || null },
				{ name: 'smart_money_graph', at: smartMoney ? finishedAt : null },
			],
			started_at: startedAt,
		},
	};
}
