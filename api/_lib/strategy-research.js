// Strategy research gates: the gate report a strategy reads before any buy.
//
// A Strategy Object's `research` block (api/_lib/strategy-schema.js) asks real
// questions about a candidate coin: how many holders, how much does the largest
// one own, how deep is the liquidity, what does the rug/honeypot firewall score
// it, are the mint and freeze authorities renounced, and what has the creator
// done before. This module answers them from the platform's existing readers,
// never from a guess:
//
//   identity   the launch feed row (name, symbol, creator)
//   liquidity  the pump.fun feed's live curve liquidity
//   holders    pump_coin_intel (largest holder share of bought supply, recorded
//              by the intel engine) and composeTokenHolders (holder count from
//              the indexer; on-chain top holders with the bonding curve's own
//              token account excluded when intel has no row yet)
//   authority  the firewall's SPL mint-account read (authoritative on chain)
//   security   assessTradeSafety, the same firewall every buy already passes,
//              run with the agent's real wallet and the strategy's real size
//   dev        the creator's launch history (enrichCreatorStats) and whether the
//              dev has sold (pump_coin_intel)
//
// Every section carries `source` and `at` so a blocked buy always cites where
// its numbers came from. The section names match the token report schema
// (identity, liquidity, holders, authority, security, dev) so a fuller token
// report can stand in for this one without changing the gate evaluator.
//
// Only the sections a strategy actually gates on are fetched, so a strategy with
// no holder gate never pays for a holder walk.

import { PublicKey } from '@solana/web3.js';
import { sql } from './db.js';
import { assessTradeSafety } from './trade-firewall.js';
import { composeTokenHolders } from './crypto-token-holders.js';
import { enrichCreatorStats } from './pump-launch-feed.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

function num(v) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/** Which report sections a normalized config needs, so nothing unused is fetched. */
export function sectionsNeeded(config, { forApproval = false } = {}) {
	const g = config?.research || {};
	const dv = g.dev_history || {};
	return {
		holders: g.min_holders != null || g.max_top_holder_pct != null || forApproval,
		security: g.security_min_score != null || g.require_no_mint_authority || g.require_no_freeze_authority || forApproval,
		dev: dv.max_launches != null || dv.min_graduated != null || dv.block_dev_sold === true || forApproval,
	};
}

async function readIntel(mint, network) {
	try {
		const [row] = await sql`
			SELECT name, symbol, creator, dev_sold, unique_buyers, signals, concentration_top10
			FROM pump_coin_intel
			WHERE mint = ${mint} AND network = ${network}
			LIMIT 1
		`;
		return row || null;
	} catch {
		return null;
	}
}

// The pump.fun bonding curve PDA owns the token account that holds the unsold
// curve supply. It is the program, not a holder, so it must never count as the
// "largest holder". Heavy SDK import deferred to the one path that needs it.
async function bondingCurveOwner(mint) {
	try {
		const { bondingCurvePda } = await import('@pump-fun/pump-sdk');
		return bondingCurvePda(new PublicKey(mint)).toBase58();
	} catch {
		return null;
	}
}

/**
 * Largest-holder share of circulating supply from an on-chain holder list,
 * excluding the bonding curve. `pct` on each row is share of TOTAL supply, so the
 * curve's share is removed from the denominator too.
 */
export function topHolderPctExcluding(top, excludedOwner) {
	if (!Array.isArray(top) || !top.length) return null;
	let curvePct = 0;
	let best = null;
	for (const h of top) {
		const pct = num(h?.pct);
		if (pct == null) continue;
		if (excludedOwner && (h.owner === excludedOwner || h.address === excludedOwner)) { curvePct += pct; continue; }
		if (best == null || pct > best) best = pct;
	}
	if (best == null) return null;
	const circulating = 100 - curvePct;
	if (!(circulating > 0)) return null;
	return Math.min(100, (best / circulating) * 100);
}

async function holdersSection({ mint, intel, deps }) {
	const at = new Date().toISOString();
	const fromIntel = num(intel?.signals?.concentration_top1);
	let count = null;
	let countSource = null;
	let topPct = fromIntel != null ? fromIntel * 100 : null;
	let topSource = fromIntel != null ? 'pump_coin_intel' : null;
	try {
		const h = await deps.composeTokenHolders({ address: mint, limit: 20 });
		if (h?.status === 'ok') {
			if (h.holderCount != null) { count = h.holderCount; countSource = (h.sources || []).join('+') || 'indexer'; }
			if (topPct == null) {
				const curve = await deps.bondingCurveOwner(mint);
				const pct = topHolderPctExcluding(h.top, curve);
				if (pct != null) { topPct = pct; topSource = `${(h.sources || []).join('+') || 'solana-rpc'} (bonding curve excluded)`; }
			}
		}
	} catch { /* holder readers down: the fields stay unknown and a holder gate fails closed */ }
	return {
		count,
		top_holder_pct: topPct == null ? null : Number(topPct.toFixed(2)),
		source: { count: countSource, top_holder_pct: topSource },
		at,
	};
}

async function securitySection({ mint, network, payer, quoteLamports, deps }) {
	const at = new Date().toISOString();
	let assessment = null;
	try {
		assessment = await deps.assessTradeSafety({
			network,
			mint: new PublicKey(mint),
			side: 'buy',
			payer: payer ? new PublicKey(payer) : null,
			quoteAmount: quoteLamports,
		});
	} catch {
		assessment = null;
	}
	const authCheck = assessment?.checks?.find((c) => c.name === 'mint_authority');
	const known = !!authCheck && authCheck.detail && 'mint_authority' in authCheck.detail && 'freeze_authority' in authCheck.detail;
	return {
		assessment,
		authority: {
			known,
			mint_authority: known ? authCheck.detail.mint_authority : null,
			freeze_authority: known ? authCheck.detail.freeze_authority : null,
			source: 'spl mint account (trade firewall)',
			at,
		},
		security: {
			score: assessment ? num(assessment.score) : null,
			verdict: assessment?.verdict || null,
			simulated: assessment?.simulated === true,
			reasons: Array.isArray(assessment?.reasons) ? assessment.reasons.slice(0, 5) : [],
			source: 'trade firewall',
			at,
		},
	};
}

async function devSection({ launch, intel, deps }) {
	const at = new Date().toISOString();
	const l = launch ? { ...launch } : {};
	if (l.creator && l.creator_launches == null) await deps.enrichCreatorStats(l).catch(() => {});
	return {
		creator: l.creator || intel?.creator || null,
		launches: num(l.creator_launches),
		graduated: num(l.creator_graduated),
		sold: intel && typeof intel.dev_sold === 'boolean' ? intel.dev_sold : null,
		source: { history: l.creator_launches != null ? 'pump.fun creator history' : null, sold: intel ? 'pump_coin_intel' : null },
		at,
	};
}

export function realResearchDeps() {
	return { composeTokenHolders, assessTradeSafety, enrichCreatorStats, readIntel, bondingCurveOwner };
}

/**
 * Build the gate report for one candidate. Never throws: an unreachable reader
 * leaves its fields null, and the evaluator fails a gate on unknown data closed.
 *
 * @param {object} o
 * @param {object} o.config        normalized strategy config
 * @param {object} o.launch        feed launch ({ mint, name, symbol, creator, liquidity_sol, market_cap_usd, creator_launches, creator_graduated })
 * @param {string} [o.network]
 * @param {string} [o.payer]       the agent wallet address (firewall round trip runs as it)
 * @param {boolean} [o.forApproval] ask mode: fetch every section so the approval card shows full risk notes
 * @returns {Promise<{ report: object, assessment: object|null }>}
 */
export async function buildGateReport({ config, launch, network = 'mainnet', payer = null, forApproval = false }, deps = realResearchDeps()) {
	const mint = launch.mint;
	const need = sectionsNeeded(config, { forApproval });
	const quoteLamports = BigInt(Math.floor((config?.sizing?.amount_sol || 0) * LAMPORTS_PER_SOL));
	const intel = await deps.readIntel(mint, network);
	const at = new Date().toISOString();

	const [holders, sec, dev] = await Promise.all([
		need.holders ? holdersSection({ mint, intel, deps }) : null,
		need.security ? securitySection({ mint, network, payer, quoteLamports, deps }) : null,
		need.dev ? devSection({ launch, intel, deps }) : null,
	]);

	const report = {
		mint,
		network,
		generated_at: at,
		identity: {
			mint,
			name: launch.name || intel?.name || null,
			symbol: launch.symbol || intel?.symbol || null,
			creator: launch.creator || intel?.creator || null,
			source: 'pump.fun launch feed',
			at,
		},
		liquidity: {
			sol: num(launch.liquidity_sol),
			market_cap_usd: num(launch.market_cap_usd),
			source: 'pump.fun launch feed',
			at,
		},
		holders: holders || { count: null, top_holder_pct: null, source: null, at: null, skipped: true },
		authority: sec?.authority || { known: false, mint_authority: null, freeze_authority: null, source: null, at: null, skipped: true },
		security: sec?.security || { score: null, verdict: null, reasons: [], source: null, at: null, skipped: true },
		dev: dev || { creator: launch.creator || null, launches: null, graduated: null, sold: null, source: null, at: null, skipped: true },
	};
	return { report, assessment: sec?.assessment || null };
}

/**
 * Short, owner-facing risk notes for an approval card, built from a gate report
 * and its evaluation. Plain text only: token names and symbols are untrusted
 * data, so they never appear in a note.
 */
export function riskNotesFromReport(report, evaluation) {
	const notes = [];
	const sec = report?.security;
	if (sec?.score != null) notes.push(`Firewall score ${Math.round(sec.score)}/100 (${sec.verdict || 'unrated'}).`);
	for (const r of (sec?.reasons || []).slice(0, 3)) notes.push(String(r).slice(0, 160));
	if (report?.holders?.top_holder_pct != null) notes.push(`Largest holder owns ${report.holders.top_holder_pct}% of bought supply.`);
	if (report?.holders?.count != null) notes.push(`${report.holders.count} holders.`);
	if (report?.liquidity?.sol != null) notes.push(`${Number(report.liquidity.sol).toFixed(2)} SOL liquidity on the curve.`);
	if (report?.dev?.sold === true) notes.push('The creator has already sold.');
	if (report?.authority?.known && report.authority.mint_authority) notes.push('Mint authority is still active.');
	if (report?.authority?.known && report.authority.freeze_authority) notes.push('Freeze authority is still active.');
	for (const c of evaluation?.checks || []) {
		if (c.status === 'unknown') notes.push(c.reason);
	}
	return notes.slice(0, 10);
}
