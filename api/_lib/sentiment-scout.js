// Sentiment Scout: surfaces pump.fun momentum candidates with EVIDENCE a
// trading agent (or a human) can cite to followers. It never trades.
//
// Contract (roadmap 917, prompt 14.2):
//   { mint, ticker, momentum_score: 0-100,
//     evidence: [{ type, detail, source }], caution }
//
// "Cite only real, retrievable evidence; never fabricate" is enforced by
// construction rather than by asking a model nicely: every evidence line is
// rendered from a row or an upstream read this module just made, and carries a
// source a reader can open to check it. A signal we could not read is left out
// (and listed under `unavailable`), never estimated.
//
// Pipeline (cheap on everything, expensive on candidates):
//   1. Window: every coin the Coin Intelligence Engine observed in the last
//      N minutes (pump_coin_intel, ~1k rows/hour on mainnet).
//   2. Rank: percentile of early buy volume and distinct buyers against that
//      same window. Percentiles, not lift over the median: the median launch
//      has one buyer, so "40x the median" would be noise dressed as signal.
//   3. Screen: coordinated launches and dumped devs never qualify; a coin has
//      to sit in the top quartile of its window on buy volume.
//   4. Enrich the survivors only: live bonding-curve state, pump.fun
//      callouts (the coin page's community commentary; pump.fun now serves
//      these only to signed-in sessions, so they usually land under
//      `unavailable`), and the fleet's paid Crypto Intel sentiment reads,
//      each backed by the x402 payment transaction that bought it.
//   5. Score + one caution line, both deterministic and explainable.

import { sql } from './db.js';
import { getBondingStatus } from './pump-bonding.js';
import { fetchPumpFunCallouts } from './pump-callouts.js';
import { receiptTxUrl } from './trade-receipt.js';

export const EVIDENCE_TYPES = Object.freeze([
	'volume_spike',
	'fresh_buyers',
	'social_mention',
	'graduation_approach',
	'smart_money',
	'news_match',
	'paid_signal',
]);

// A coordinated launch or a dev who already sold is not "momentum", whatever
// the volume says. These never reach the candidate list.
const DISQUALIFYING_FLAGS = new Set(['bundle_launch', 'dev_dumped']);

const MIN_WINDOW_MIN = 15;
const MAX_WINDOW_MIN = 240;
const DEFAULT_WINDOW_MIN = 60;
const MAX_LIMIT = 10;
const MIN_VOLUME_PCTL = 0.75;
const MIN_BUYERS = 3;
const ENRICH_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 30_000;
const PAID_SIGNAL_MAX_AGE_H = 6;

const cache = new Map();

const lamportsToSol = (v) => (v == null ? null : Number(v) / 1e9);
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (x) => `${Math.round(x * 100)}%`;
const fmtSol = (x) => (x >= 10 ? x.toFixed(1) : x.toFixed(2));

export function appOrigin() {
	return (process.env.PUBLIC_APP_ORIGIN || 'https://three.ws').replace(/\/+$/, '');
}

export function clampWindow(minutes) {
	const n = Number(minutes);
	if (minutes == null || minutes === '' || !Number.isFinite(n)) return DEFAULT_WINDOW_MIN;
	return Math.max(MIN_WINDOW_MIN, Math.min(MAX_WINDOW_MIN, Math.round(n)));
}

export function clampLimit(limit) {
	const n = Number(limit);
	if (limit == null || limit === '' || !Number.isFinite(n)) return 5;
	return Math.max(1, Math.min(MAX_LIMIT, Math.round(n)));
}

/**
 * Fraction of `sorted` (ascending) strictly below `value`. 0.97 means the value
 * beat 97% of the window.
 */
export function percentileRank(sorted, value) {
	if (!sorted.length || value == null) return 0;
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] < value) lo = mid + 1;
		else hi = mid;
	}
	return lo / sorted.length;
}

/** "top 3%" phrasing for a percentile rank, floored at 1 so it never reads "top 0%". */
export function topPct(rank) {
	return Math.max(1, Math.ceil((1 - rank) * 100));
}

function median(sorted) {
	if (!sorted.length) return 0;
	const m = sorted.length >> 1;
	return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function symbolKey(sym) {
	return String(sym || '').trim().toLowerCase();
}

/**
 * Per-window statistics every candidate is measured against. Pure.
 * @param {Array<object>} rows pump_coin_intel rows (the window)
 */
export function windowStats(rows) {
	const vols = [];
	const buyers = [];
	const concs = [];
	const symbols = new Map();
	for (const r of rows) {
		vols.push(lamportsToSol(r.buy_volume_lamports) ?? 0);
		buyers.push(Number(r.unique_buyers) || 0);
		// Concentration is only comparable between coins that actually traded:
		// a one-buyer launch is 100% concentrated by definition.
		if ((Number(r.unique_buyers) || 0) >= MIN_BUYERS && r.concentration_top10 != null) concs.push(Number(r.concentration_top10));
		const k = symbolKey(r.symbol);
		if (k) symbols.set(k, (symbols.get(k) || 0) + 1);
	}
	vols.sort((a, b) => a - b);
	buyers.sort((a, b) => a - b);
	concs.sort((a, b) => a - b);
	return { size: rows.length, vols, buyers, concs, symbols, medianVol: median(vols), medianBuyers: median(buyers) };
}

function buySellRatio(r) {
	const fromSignals = r.signals?.buy_sell_ratio;
	if (fromSignals != null && Number.isFinite(Number(fromSignals))) return Number(fromSignals);
	const buys = Number(r.buy_count) || 0;
	const sells = Number(r.sell_count) || 0;
	if (!buys) return null;
	return sells ? buys / sells : buys;
}

/** Window-relative measurements for one row, with no qualification screen. Pure. */
export function measure(r, stats) {
	const vol = lamportsToSol(r.buy_volume_lamports) ?? 0;
	const nBuyers = Number(r.unique_buyers) || 0;
	const volPct = percentileRank(stats.vols, vol);
	const buyerPct = percentileRank(stats.buyers, nBuyers);
	const bsr = buySellRatio(r);
	const bsrScore = bsr == null ? 0 : clamp01((bsr - 1) / 2);
	const smScore = clamp01((Number(r.smart_money_count) || 0) / 3);
	// Early top-10 share is 90%+ for most launches in their first 90 seconds, so
	// an absolute threshold flags everything. Rank it against comparable coins.
	const top10 = r.concentration_top10 != null ? Number(r.concentration_top10) : null;
	const concPct = top10 == null || !stats.concs?.length ? null : percentileRank(stats.concs, top10);
	return {
		vol,
		top10,
		concPct,
		nBuyers,
		volPct,
		buyerPct,
		bsr,
		bsrScore,
		smScore,
		base: 30 * volPct + 25 * buyerPct + 10 * bsrScore + 10 * smScore,
	};
}

/**
 * Rank one intel row against its window before any network enrichment. Pure.
 * Returns null when the row does not qualify as a board candidate.
 */
export function preScore(r, stats) {
	const flags = Array.isArray(r.risk_flags) ? r.risk_flags : [];
	if (flags.some((f) => DISQUALIFYING_FLAGS.has(f))) return null;
	const m = measure(r, stats);
	if (m.nBuyers < MIN_BUYERS || m.volPct < MIN_VOLUME_PCTL) return null;
	return m;
}

/**
 * Final 0-100 momentum score with its parts, so a reader can see why. Pure.
 */
export function momentumScore(pre, { curve, calloutCount, newsMatch, paidSignal, flags, copycats }) {
	let curveScore = 0;
	if (curve?.graduated) curveScore = 0.6;
	else if (curve?.bondingProgressPct != null) curveScore = clamp01(curve.bondingProgressPct / 100);
	const paidBoost = paidSignal?.signal === 'bullish' ? 0.4 * clamp01(Number(paidSignal.confidence) || 0) : 0;
	const socialScore = clamp01((calloutCount || 0) / 5 + (newsMatch ? 0.5 : 0) + paidBoost);
	let penalty = 8 * (flags || []).length;
	if (copycats > 0) penalty += 10;
	if (pre.concPct != null && pre.concPct >= 0.9) penalty += 10;
	const parts = {
		volume: round(30 * pre.volPct, 1),
		buyers: round(25 * pre.buyerPct, 1),
		buy_pressure: round(10 * pre.bsrScore, 1),
		smart_money: round(10 * pre.smScore, 1),
		curve: round(15 * curveScore, 1),
		social: round(10 * socialScore, 1),
		risk_penalty: -penalty,
	};
	const total = Object.values(parts).reduce((s, v) => s + (v || 0), 0);
	return { score: Math.max(0, Math.min(100, Math.round(total))), parts };
}

/**
 * Build the evidence list. Every line comes from a value read in this run and
 * points at a source that returns it. Pure.
 */
export function buildEvidence(r, pre, stats, { curve, callouts, paidSignal, origin }) {
	const mint = r.mint;
	const intelApi = `${origin}/api/pump/coin-intel?mint=${encodeURIComponent(mint)}`;
	const pumpPage = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
	const obs = Number(r.observation_seconds) || null;
	const inWindow = obs ? `in its first ${obs}s` : 'in its observation window';
	const evidence = [];

	evidence.push({
		type: 'volume_spike',
		detail: `${fmtSol(pre.vol)} SOL bought ${inWindow}, top ${topPct(pre.volPct)}% of ${stats.size} launches in the window (median ${fmtSol(stats.medianVol)} SOL)`,
		source: intelApi,
	});

	const fresh = r.fresh_wallet_ratio != null ? Number(r.fresh_wallet_ratio) : null;
	evidence.push({
		type: 'fresh_buyers',
		detail: `${pre.nBuyers} distinct buyers ${inWindow}, top ${topPct(pre.buyerPct)}% of the window`
			+ (fresh != null ? `; ${pct(fresh)} of them brand-new wallets` : '')
			+ (pre.bsr != null ? `; ${round(pre.bsr, 2)} buys per sell` : ''),
		source: intelApi,
	});

	const sm = Number(r.smart_money_count) || 0;
	if (sm > 0) {
		const notable = Array.isArray(r.smart_money_notable) ? r.smart_money_notable : [];
		const best = notable
			.map((n) => Number(n?.win_rate))
			.filter((w) => Number.isFinite(w))
			.sort((a, b) => b - a)[0];
		evidence.push({
			type: 'smart_money',
			detail: `${sm} wallet${sm === 1 ? '' : 's'} with a profitable pump.fun record bought early`
				+ (best != null ? ` (best win rate ${pct(best > 1 ? best / 100 : best)})` : ''),
			source: intelApi,
		});
	}

	if (curve?.graduated) {
		evidence.push({
			type: 'graduation_approach',
			detail: `already graduated off the bonding curve${curve.migratedTo ? ` to ${curve.migratedTo}` : ''}`,
			source: pumpPage,
		});
	} else if (curve?.bondingProgressPct != null) {
		evidence.push({
			type: 'graduation_approach',
			detail: `bonding curve ${Math.round(curve.bondingProgressPct)}% of the way to graduation`
				+ (curve.solInCurve != null ? `, ${fmtSol(curve.solInCurve)} SOL in the curve` : ''),
			source: pumpPage,
		});
	}

	if (callouts?.length) {
		const latest = callouts[0];
		const flat = latest.text.replace(/\s+/g, ' ');
		const quote = flat.length > 140 ? `${flat.slice(0, 140)}...` : flat;
		evidence.push({
			type: 'social_mention',
			detail: `${callouts.length} pump.fun callout${callouts.length === 1 ? '' : 's'}; latest`
				+ (latest.author ? ` from @${latest.author}` : '')
				+ `: "${quote}"`,
			source: pumpPage,
		});
	}

	if (paidSignal?.signal) {
		const conf = Number(paidSignal.confidence);
		evidence.push({
			type: 'paid_signal',
			detail: `paid ${paidSignal.source || 'sentiment'} read (x402${Number.isFinite(conf) ? `, confidence ${pct(conf)}` : ''}): ${paidSignal.signal}`
				+ (paidSignal.headline ? `, "${String(paidSignal.headline).slice(0, 120)}"` : ''),
			source: receiptTxUrl(paidSignal.tx_signature) || intelApi,
		});
	}

	const headline = r.signals?.news_headline;
	if (r.is_news_meme && headline) {
		evidence.push({
			type: 'news_match',
			detail: `name matches a live news story: "${String(headline).slice(0, 140)}"`,
			source: r.signals?.news_url || intelApi,
		});
	}
	return evidence;
}

/**
 * The single most important risk, in one line. Deterministic priority order,
 * worst first. Pure.
 */
export function cautionFor(r, { copycats = 0, calloutCount = 0, calloutsRead = true, paidSignal = null, concPct = null } = {}) {
	const flags = new Set(Array.isArray(r.risk_flags) ? r.risk_flags : []);
	const fresh = r.fresh_wallet_ratio != null ? Number(r.fresh_wallet_ratio) : null;
	const top10 = r.concentration_top10 != null ? Number(r.concentration_top10) : null;
	const snipe = r.snipe_ratio != null ? Number(r.snipe_ratio) : null;
	const sym = r.symbol ? `$${r.symbol}` : 'this name';
	if (flags.has('dev_dumped')) return 'The creator already sold; momentum from here is exit liquidity.';
	if (flags.has('bundle_launch')) return 'Launch was bundled: a coordinated group bought the early supply.';
	if (flags.has('single_whale')) return 'One wallet holds most of the early supply; a single sell can erase the move.';
	if (flags.has('fresh_wallet_swarm') || (fresh != null && fresh >= 0.5)) {
		return `${fresh != null ? pct(fresh) : 'Most'} of early buyers are brand-new wallets, a common sign of manufactured volume.`;
	}
	if (top10 != null && concPct != null && concPct >= 0.8) {
		return `The top 10 wallets hold ${pct(top10)} of what was bought early, more concentrated than ${Math.floor(concPct * 100)}% of comparable launches; exits can be sudden.`;
	}
	if (copycats > 0) {
		return `${copycats} other coin${copycats === 1 ? '' : 's'} named ${sym} launched in the same window; check you have the right mint.`;
	}
	if (paidSignal?.signal === 'bearish') {
		return `A paid sentiment read on this coin came back bearish${paidSignal.headline ? `: "${String(paidSignal.headline).slice(0, 100)}"` : '.'}`;
	}
	if (flags.has('sell_pressure')) return 'Sells are already heavy against buys; the early pump may be distributing.';
	// The engine's own `sniped` flag, not the raw ratio: most launches are
	// majority-sniped in their first block, so a bare threshold flags nearly all.
	if (flags.has('sniped')) {
		return `${snipe != null ? pct(snipe) : 'Much'} of early volume came from first-block snipers, who usually sell into the first pump.`;
	}
	if (!r.twitter && !r.telegram && !r.website && !calloutCount) {
		return calloutsRead
			? 'No X, Telegram, website or callouts: nothing outside the chart is holding attention.'
			: 'No X, Telegram or website linked: nothing outside the chart is holding attention.';
	}
	const obs = Number(r.observation_seconds) || null;
	return `These signals cover only the first ${obs ? `${obs}s` : 'minutes'} of trading; most early momentum on pump.fun fades.`;
}

const intelColumns = () => sql`
	mint, network, symbol, name, image_uri, twitter, telegram, website,
	first_seen_at, observation_seconds, buy_count, sell_count,
	buy_volume_lamports, sell_volume_lamports, unique_buyers, signals,
	snipe_ratio, concentration_top10, fresh_wallet_ratio, quality_score,
	risk_flags, smart_money_count, smart_money_notable, is_news_meme
`;

async function loadWindow({ network, windowMinutes }) {
	return sql`
		select ${intelColumns()}
		from pump_coin_intel
		where network = ${network}
		  and first_seen_at > now() - make_interval(mins => ${windowMinutes})
		order by first_seen_at desc
		limit 5000
	`;
}

// Peers for a single-coin scout: every coin first seen within half the window
// either side of it, so an older coin is still measured against its own hour.
async function loadPeers({ network, mint, windowMinutes }) {
	const [row] = await sql`
		select ${intelColumns()} from pump_coin_intel
		where mint = ${mint} and network = ${network} limit 1
	`;
	if (!row) return { row: null, peers: [] };
	const half = Math.max(1, Math.round(windowMinutes / 2));
	const peers = await sql`
		select ${intelColumns()} from pump_coin_intel
		where network = ${network}
		  and first_seen_at between ${row.first_seen_at}::timestamptz - make_interval(mins => ${half})
		                        and ${row.first_seen_at}::timestamptz + make_interval(mins => ${half})
		limit 5000
	`;
	return { row, peers };
}

function withTimeout(promise, ms) {
	let tid;
	return Promise.race([
		promise,
		new Promise((resolve) => { tid = setTimeout(() => resolve({ timedOut: true }), ms); }),
	]).finally(() => clearTimeout(tid));
}

// Latest paid Crypto Intel read per mint (sniper_coin_sentiment), one query for
// the whole shortlist. A read older than a few hours says nothing about now.
async function loadPaidSignals(network, mints) {
	if (!mints.length) return new Map();
	const rows = await sql`
		select distinct on (mint) mint, signal, headline, confidence, source, tx_signature, checked_at
		from sniper_coin_sentiment
		where network = ${network}
		  and mint = any(${mints}::text[])
		  and checked_at > now() - make_interval(hours => ${PAID_SIGNAL_MAX_AGE_H})
		order by mint, checked_at desc
	`.catch(() => null);
	return rows ? new Map(rows.map((r) => [r.mint, r])) : null;
}

async function enrich(mint) {
	const [curveRes, calloutRes] = await Promise.all([
		withTimeout(getBondingStatus(mint).catch(() => ({ kind: 'upstream_down' })), ENRICH_TIMEOUT_MS),
		withTimeout(
			fetchPumpFunCallouts(mint, 20, { timeoutMs: ENRICH_TIMEOUT_MS - 500 }).catch(() => ({ error: 'unreachable' })),
			ENRICH_TIMEOUT_MS,
		),
	]);
	const unavailable = [];
	let curve = null;
	let socials = null;
	if (curveRes?.kind === 'ok') {
		curve = curveRes.status;
		// Creators often add links after the intel window closes; the live coin
		// object is the fresher read.
		const c = curveRes.coin || {};
		socials = { twitter: c.twitter || null, telegram: c.telegram || null, website: c.website || null };
	}
	else if (curveRes?.kind !== 'not_found') unavailable.push('bonding_curve');
	let callouts = [];
	if (Array.isArray(calloutRes?.posts)) callouts = calloutRes.posts;
	else unavailable.push('callouts');
	return { curve, callouts, socials, calloutsRead: !unavailable.includes('callouts'), unavailable };
}

export function shapeCandidate(row, pre, stats, extra, origin) {
	const live = extra.socials || {};
	const r = {
		...row,
		twitter: row.twitter || live.twitter || null,
		telegram: row.telegram || live.telegram || null,
		website: row.website || live.website || null,
	};
	const copycats = Math.max(0, (stats.symbols.get(symbolKey(r.symbol)) || 1) - 1);
	const flags = Array.isArray(r.risk_flags) ? r.risk_flags : [];
	const { score, parts } = momentumScore(pre, {
		curve: extra.curve,
		calloutCount: extra.callouts.length,
		paidSignal: extra.paidSignal,
		newsMatch: !!(r.is_news_meme && r.signals?.news_headline),
		flags,
		copycats,
	});
	const disqualified = flags.some((f) => DISQUALIFYING_FLAGS.has(f));
	const mint = r.mint;
	return {
		mint,
		ticker: r.symbol ? `$${r.symbol}` : null,
		name: r.name || null,
		image_uri: r.image_uri || null,
		momentum_score: disqualified ? 0 : score,
		score_parts: parts,
		evidence: buildEvidence(r, pre, stats, { ...extra, origin }),
		caution: cautionFor(r, {
			copycats,
			calloutCount: extra.callouts.length,
			calloutsRead: extra.calloutsRead !== false,
			paidSignal: extra.paidSignal,
			concPct: pre.concPct,
		}),
		socials: { twitter: r.twitter, telegram: r.telegram, website: r.website },
		risk_flags: flags,
		quality_score: r.quality_score ?? null,
		first_seen_at: r.first_seen_at,
		unavailable: extra.unavailable,
		links: {
			intel: `${origin}/oracle?mint=${encodeURIComponent(mint)}`,
			pump: `https://pump.fun/coin/${encodeURIComponent(mint)}`,
			fork: `${origin}/trades?fork=${encodeURIComponent(mint)}`,
		},
	};
}

/**
 * Run the scout.
 * @param {{ network?: 'mainnet'|'devnet', windowMinutes?: number, limit?: number, mint?: string|null }} opts
 */
export async function runSentimentScout({ network = 'mainnet', windowMinutes, limit, mint = null } = {}) {
	const net = network === 'devnet' ? 'devnet' : 'mainnet';
	const win = clampWindow(windowMinutes);
	const lim = clampLimit(limit);
	const key = `${net}:${win}:${lim}:${mint || ''}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

	const origin = appOrigin();
	const generated_at = new Date().toISOString();
	let value;

	if (mint) {
		// A single-coin read always answers, even for a coin that would not
		// qualify on the board: the caller asked about THIS coin.
		const { row, peers } = await loadPeers({ network: net, mint, windowMinutes: win });
		if (!row) {
			value = {
				network: net, window_minutes: win, observed: 0, generated_at, found: false, candidates: [],
				reason: 'This coin has not been observed by the Coin Intelligence Engine (launched before it was watching, or still in its first seconds).',
			};
		} else {
			const stats = windowStats(peers.length ? peers : [row]);
			const [extra, paid] = await Promise.all([enrich(row.mint), loadPaidSignals(net, [row.mint])]);
			extra.paidSignal = paid?.get(row.mint) || null;
			if (!paid) extra.unavailable.push('paid_signals');
			value = {
				network: net, window_minutes: win, observed: stats.size, generated_at, found: true,
				candidates: [shapeCandidate(row, measure(row, stats), stats, extra, origin)],
			};
		}
	} else {
		const rows = await loadWindow({ network: net, windowMinutes: win });
		const stats = windowStats(rows);
		const ranked = [];
		for (const r of rows) {
			const pre = preScore(r, stats);
			if (pre) ranked.push({ r, pre });
		}
		ranked.sort((a, b) => b.pre.base - a.pre.base);
		const shortlist = ranked.slice(0, Math.min(MAX_LIMIT, lim * 2));
		const paid = await loadPaidSignals(net, shortlist.map(({ r }) => r.mint));
		const enriched = await Promise.all(
			shortlist.map(async ({ r, pre }) => {
				const extra = await enrich(r.mint);
				extra.paidSignal = paid?.get(r.mint) || null;
				if (!paid) extra.unavailable.push('paid_signals');
				return shapeCandidate(r, pre, stats, extra, origin);
			}),
		);
		enriched.sort((a, b) => b.momentum_score - a.momentum_score);
		value = {
			network: net,
			window_minutes: win,
			observed: stats.size,
			qualified: ranked.length,
			generated_at,
			candidates: enriched.slice(0, lim),
		};
		if (!value.candidates.length) {
			value.reason = stats.size
				? `None of the ${stats.size} launches in the last ${win} minutes cleared the screen (top-quartile buy volume, ${MIN_BUYERS}+ buyers, no bundle or dev dump).`
				: `The Coin Intelligence Engine has observed no ${net} launches in the last ${win} minutes.`;
		}
	}

	cache.set(key, { at: Date.now(), value });
	if (cache.size > 200) cache.delete(cache.keys().next().value);
	return value;
}

export function _resetScoutCache() {
	cache.clear();
}
