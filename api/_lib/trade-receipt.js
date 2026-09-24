/**
 * Trade receipts: why an agent took one trade, with the evidence it had.
 *
 * The track record answers "did it make money". A receipt answers the question a
 * copier asks next: "why did it buy that?" Every autonomous entry already passes
 * through a chain of real gates that each leave a row behind, so a receipt is not
 * an after-the-fact story. It is those rows, joined to one position and ordered
 * against its entry time:
 *
 *   trigger      agent_sniper_positions.entry_trigger / trigger_ref
 *   oracle       oracle_conviction_history (the score + pillars at entry) and
 *                oracle_conviction (the base-rate reasons behind the score)
 *   firewall     firewall_decisions (the buy/sell round-trip simulation and
 *                authority / concentration / impact checks run for this buy)
 *   judge        sniper_llm_verdicts (the LLM buy/skip thesis, when one ran)
 *   risk officer sniper_risk_reviews (the adversarial second opinion)
 *   sentiment    sniper_coin_sentiment (paid x402 market read, with its tx)
 *   token risk   token_intel_risk (paid x402 rug-pull score, with its tx)
 *   intel        pump_coin_intel (observed launch structure)
 *   legs         trading_journal (every entry / partial / exit leg + its tx)
 *
 * Honesty rules, enforced here so no renderer can break them:
 *   - Evidence recorded AFTER the exit is dropped: it cannot have caused the trade.
 *   - Evidence recorded after the entry but before the exit is kept and tagged
 *     `during_trade`, so the page can say "seen while holding", not "why it bought".
 *   - A paper fill stays labeled paper. A missing gate is simply absent, never
 *     filled with a guess.
 *
 * The shaping functions are pure and database-free (tests/trade-receipt.test.js);
 * loadTradeReceipt() is the single query path the API and the /trade/:id page share.
 */

import { sql } from './db.js';
import { isUuid } from './validate.js';
import { exitReasonLabel, solscanTx, solscanToken, SIMULATED_SIG } from './trade-card.js';

const LAMPORTS_PER_SOL = 1e9;

/** How far before the entry a firewall decision may sit and still be this buy's. */
const FIREWALL_LOOKBACK_MS = 15 * 60 * 1000;
/** Rows are stamped by separate writers, so allow a little clock skew past the fill. */
const ENTRY_SKEW_MS = 2 * 60 * 1000;
/** At most this many Oracle base-rate reasons: the ones that moved the score most. */
const MAX_ORACLE_REASONS = 5;

/** Entry triggers the sniper can write, in words a spectator understands. */
const TRIGGER_LABELS = {
	new_mint: {
		label: 'Fresh launch',
		detail: 'Bought at creation, scored on the launch itself before anyone else had traded it.',
	},
	oracle_crossing: {
		label: 'Oracle crossing',
		detail: 'The Oracle conviction score for this coin crossed the strategy\'s buy threshold.',
	},
	intel_confirmed: {
		label: 'Intel confirmed',
		detail: 'The coin was watched for its first minutes and bought once its observed trading cleared the bar.',
	},
	llm_intel: {
		label: 'LLM judgment',
		detail: 'An LLM judge read the observed launch data and voted to buy.',
	},
	graduation_ride: {
		label: 'Graduation ride',
		detail: 'Bought as the coin approached graduation from the bonding curve to the AMM.',
	},
};

export function triggerLabel(trigger) {
	const key = trigger || 'new_mint';
	return TRIGGER_LABELS[key] || { label: String(key).replace(/_/g, ' '), detail: null };
}

const JOURNAL_EVENT_LABELS = {
	entry: 'Entry',
	take_initials: 'Initials recovered',
	exit: 'Exit',
	exit_moonbag: 'Moon-bag exit',
};

function num(v) {
	if (v == null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function lamToSol(v) {
	const n = num(v);
	return n == null ? null : n / LAMPORTS_PER_SOL;
}

function ms(ts) {
	if (!ts) return null;
	const t = new Date(ts).getTime();
	return Number.isFinite(t) ? t : null;
}

function iso(ts) {
	const t = ms(ts);
	return t == null ? null : new Date(t).toISOString();
}

/**
 * Where a piece of evidence sits against the trade: before the entry (it could
 * have caused the buy), during the hold, or after the exit (it could not have).
 */
export function evidenceTiming(at, openedAt, closedAt) {
	const t = ms(at);
	const open = ms(openedAt);
	if (t == null || open == null) return null;
	if (t <= open + ENTRY_SKEW_MS) return 'before_entry';
	const close = ms(closedAt);
	if (close != null && t > close) return 'after_exit';
	return 'during_trade';
}

/**
 * A transaction explorer link for any signature a receipt carries. Solana
 * signatures go to Solscan; an EVM hash (an x402 payment settled on Base) goes
 * to Basescan, so a paid-signal receipt always opens on the chain it settled on.
 */
export function receiptTxUrl(sig, network = 'mainnet') {
	const s = typeof sig === 'string' ? sig.trim() : '';
	if (!s || s === SIMULATED_SIG) return null;
	if (/^0x[0-9a-fA-F]{64}$/.test(s)) return `https://basescan.org/tx/${s}`;
	if (/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s)) return solscanTx(s, network);
	return null;
}

function shapeOracle(history, current, position) {
	if (!history && !current) return null;
	const base = history || current;
	const reasonsTiming = current ? evidenceTiming(current.scored_at, position.opened_at, position.closed_at) : null;
	const reasons = current && reasonsTiming && reasonsTiming !== 'after_exit' && Array.isArray(current.reasons)
		? current.reasons
			.filter((r) => r && typeof r.text === 'string')
			.map((r) => ({ text: r.text, pillar: r.pillar || null, lift: num(r.lift), samples: num(r.samples) }))
			.sort((a, b) => Math.abs((b.lift ?? 1) - 1) - Math.abs((a.lift ?? 1) - 1))
			.slice(0, MAX_ORACLE_REASONS)
		: [];
	return {
		score: num(base.score),
		tier: base.tier || null,
		pillars: {
			pedigree: num(base.pedigree),
			structure: num(base.structure),
			narrative: num(base.narrative),
			momentum: num(base.momentum),
		},
		rug_risk: num(base.rug_risk),
		upside: num(base.upside),
		give_back_risk: num(base.give_back_risk),
		scored_at: iso(base.scored_at),
		timing: evidenceTiming(base.scored_at, position.opened_at, position.closed_at),
		reasons,
		reasons_scored_at: reasons.length ? iso(current.scored_at) : null,
		reasons_timing: reasons.length ? reasonsTiming : null,
	};
}

function shapeFirewall(row, position) {
	if (!row) return null;
	const checks = Array.isArray(row.checks)
		? row.checks
			.filter((c) => c && c.name)
			.map((c) => ({ name: String(c.name), status: c.status || null, reason: c.reason || null }))
		: [];
	return {
		verdict: row.verdict || null,
		score: num(row.score),
		reasons: Array.isArray(row.reasons) ? row.reasons.filter((r) => typeof r === 'string') : [],
		checks,
		simulated: row.simulated !== false,
		enforced: row.enforced === true,
		at: iso(row.created_at),
		timing: evidenceTiming(row.created_at, position.opened_at, position.closed_at),
	};
}

function shapeJudge(row, position) {
	if (!row) return null;
	const timing = evidenceTiming(row.created_at, position.opened_at, position.closed_at);
	if (timing !== 'before_entry') return null;
	return {
		buy: row.buy === true,
		confidence: num(row.confidence),
		thesis: row.thesis || null,
		model: row.model || null,
		at: iso(row.created_at),
		timing,
	};
}

function shapeRiskReview(row, position) {
	if (!row) return null;
	return {
		level: row.level || null,
		veto: row.veto === true,
		severity: row.severity || null,
		reasons: Array.isArray(row.reasons) ? row.reasons.filter((r) => typeof r === 'string') : [],
		proposed_sol: lamToSol(row.proposed_lamports),
		adjusted_sol: lamToSol(row.adjusted_lamports),
		enforced: row.enforced === true,
		model: row.model || null,
		at: iso(row.created_at),
		timing: evidenceTiming(row.created_at, position.opened_at, position.closed_at),
	};
}

function shapePaidSignal(row, position, fields) {
	if (!row) return null;
	const timing = evidenceTiming(row.checked_at, position.opened_at, position.closed_at);
	if (!timing || timing === 'after_exit') return null;
	const out = { at: iso(row.checked_at), timing, receipt_url: receiptTxUrl(row.tx_signature, position.network) };
	for (const [key, kind] of Object.entries(fields)) {
		if (kind === 'num') out[key] = num(row[key]);
		else if (kind === 'bool') out[key] = row[key] === true;
		else out[key] = row[key] ?? null;
	}
	return out;
}

function shapeIntel(row, position) {
	if (!row) return null;
	const observedAt = row.observation_ended_at || row.updated_at || row.first_seen_at;
	const timing = evidenceTiming(observedAt, position.opened_at, position.closed_at);
	if (!timing || timing === 'after_exit') return null;
	return {
		quality_score: num(row.quality_score),
		category: row.category || null,
		narrative: row.narrative || null,
		smart_money_count: num(row.smart_money_count),
		bundle_score: num(row.bundle_score),
		organic_score: num(row.organic_score),
		concentration_top10: num(row.concentration_top10),
		unique_buyers: num(row.unique_buyers),
		risk_flags: Array.isArray(row.risk_flags) ? row.risk_flags.filter(Boolean) : [],
		is_news_meme: row.is_news_meme === true,
		observed_at: iso(observedAt),
		timing,
	};
}

function shapeLeg(row, network) {
	return {
		event: row.event,
		label: JOURNAL_EVENT_LABELS[row.event] || String(row.event || '').replace(/_/g, ' '),
		reason: row.reason || null,
		rationale: row.rationale || null,
		sold_fraction: num(row.sold_fraction),
		leg_pnl_sol: lamToSol(row.leg_pnl_lamports),
		market_cap_usd: num(row.market_cap_usd),
		venue: row.venue || null,
		mode: row.mode || null,
		at: iso(row.ts),
		tx_url: receiptTxUrl(row.sig, network),
	};
}

function fmtPctPlain(p) {
	if (p == null) return null;
	const sign = p > 0 ? '+' : p < 0 ? '-' : '';
	return `${sign}${Math.abs(p).toFixed(Math.abs(p) >= 100 ? 0 : 1)}%`;
}

/**
 * One plain-English line that states the drivers, built only from evidence the
 * receipt actually carries. Never a prediction, never a superlative.
 */
export function summarizeReceipt(r) {
	const p = r.position;
	const who = p.agent_name || 'This agent';
	const coin = p.symbol ? `$${p.symbol}` : 'this coin';
	const e = r.evidence;
	const drivers = [];
	if (e.oracle && e.oracle.timing === 'before_entry' && e.oracle.score != null) {
		drivers.push(`Oracle score ${e.oracle.score}${e.oracle.tier ? ` ${e.oracle.tier}` : ''}`);
	}
	if (e.firewall && e.firewall.verdict) drivers.push(`firewall ${e.firewall.verdict}`);
	if (e.judge) {
		const conf = e.judge.confidence != null ? ` at ${Math.round(e.judge.confidence * 100)}%` : '';
		drivers.push(`LLM judge voted ${e.judge.buy ? 'buy' : 'skip'}${conf}`);
	}
	if (e.risk_review && e.risk_review.severity) drivers.push(`risk officer ${e.risk_review.severity}`);
	let line = `${who} ${p.paper ? 'paper-bought' : 'bought'} ${coin}. Trigger: ${r.trigger.label}.`;
	if (drivers.length) line += ` ${drivers.join(', ').replace(/^./, (c) => c.toUpperCase())}.`;
	if (p.status === 'closed') {
		const pct = fmtPctPlain(p.pnl_pct);
		line += ` Exited on ${p.exit_label.toLowerCase()}${pct ? ` at ${pct}` : ''}.`;
	} else {
		line += ' Still open.';
	}
	return line;
}

/**
 * Shape the raw rows into the receipt model. PURE.
 *
 * @param {object} parts
 *   position   agent_sniper_positions row joined with agent_name / agent_image / is_public
 *   journal    trading_journal rows for the position (any order)
 *   oracleHistory, oracleCurrent, firewall, judge, riskReview, sentiment, tokenRisk, intel
 * @returns {object} the receipt the API returns and both renderers read
 */
export function shapeTradeReceipt(parts) {
	const row = parts.position;
	const network = row.network === 'devnet' ? 'devnet' : 'mainnet';
	const paper = !row.buy_sig || row.buy_sig === SIMULATED_SIG;
	const trigger = triggerLabel(row.entry_trigger);
	const position = {
		id: row.id,
		agent_id: row.agent_id,
		agent_name: row.agent_name || null,
		agent_image: row.agent_image || null,
		network,
		mint: row.mint,
		symbol: row.symbol || null,
		name: row.name || null,
		status: row.status,
		paper,
		entry_trigger: row.entry_trigger || 'new_mint',
		trigger_ref: row.trigger_ref || null,
		opened_at: iso(row.opened_at),
		closed_at: iso(row.closed_at),
		entry_sol: lamToSol(row.entry_quote_lamports),
		exit_sol: lamToSol(row.exit_quote_lamports),
		pnl_sol: lamToSol(row.realized_pnl_lamports),
		pnl_pct: num(row.realized_pnl_pct),
		entry_price_impact_pct: num(row.entry_price_impact_pct),
		exit_reason: row.exit_reason || null,
		exit_label: exitReasonLabel(row.exit_reason),
		buy_url: solscanTx(row.buy_sig, network),
		sell_url: solscanTx(row.sell_sig, network),
		token_url: solscanToken(row.mint, network),
		trader_url: `/trader/${row.agent_id}`,
		share_url: row.status === 'closed' ? `/trade/${row.id}` : null,
	};
	const legs = (parts.journal || [])
		.slice()
		.sort((a, b) => (ms(a.ts) ?? 0) - (ms(b.ts) ?? 0))
		.map((j) => shapeLeg(j, network));
	const evidence = {
		oracle: shapeOracle(parts.oracleHistory, parts.oracleCurrent, position),
		firewall: shapeFirewall(parts.firewall, position),
		judge: shapeJudge(parts.judge, position),
		risk_review: shapeRiskReview(parts.riskReview, position),
		sentiment: shapePaidSignal(parts.sentiment, position, {
			signal: 'text', headline: 'text', rationale: 'text', confidence: 'num', sentiment_adj: 'num', source: 'text',
		}),
		token_risk: shapePaidSignal(parts.tokenRisk, position, {
			rugpull_score: 'num', risk_level: 'text', signal: 'text', confidence: 'num', rejected: 'bool',
		}),
		intel: shapeIntel(parts.intel, position),
	};
	const receipt = {
		position,
		trigger: { key: position.entry_trigger, ...trigger, ref: position.trigger_ref },
		legs,
		evidence,
		evidence_count: Object.values(evidence).filter(Boolean).length,
	};
	receipt.summary = summarizeReceipt(receipt);
	return receipt;
}

/** Run one best-effort evidence query: a table that is absent in this env yields []. */
async function all(query) {
	try {
		return (await query) || [];
	} catch {
		return [];
	}
}

/** The first row of a best-effort evidence query, or null. */
async function first(query) {
	return (await all(query))[0] || null;
}

/**
 * Load the full receipt for one position. Returns null when the id is unknown,
 * the position never filled, or its agent is deleted or private (the same gate
 * /api/sniper/trader applies, so a receipt never reveals what a profile hides).
 *
 * @param {string} id  agent_sniper_positions.id
 * @returns {Promise<object|null>}
 */
export async function loadTradeReceipt(id) {
	if (!isUuid(id)) return null;
	// The position itself is NOT best-effort: a database outage must surface as
	// an error (503 at the boundary), never as a "not found" that reads as a lie.
	const [position] = await sql`
		select p.id, p.agent_id, p.network, p.mint, p.symbol, p.name, p.status,
		       p.exit_reason, p.entry_trigger, p.trigger_ref,
		       p.entry_quote_lamports, p.exit_quote_lamports,
		       p.realized_pnl_lamports, p.realized_pnl_pct, p.entry_price_impact_pct,
		       p.buy_sig, p.sell_sig, p.opened_at, p.closed_at,
		       a.name as agent_name,
		       coalesce(a.profile_image_url, a.avatar_url) as agent_image
		from agent_sniper_positions p
		join agent_identities a on a.id = p.agent_id and a.deleted_at is null and a.is_public is not false
		where p.id = ${id} and p.status in ('open', 'closing', 'closed')
		limit 1
	`;
	if (!position) return null;

	const { mint, network, agent_id: agentId } = position;
	const opened = new Date(position.opened_at);
	const lookback = new Date(opened.getTime() - FIREWALL_LOOKBACK_MS);
	const entryCutoff = new Date(opened.getTime() + ENTRY_SKEW_MS);
	const judgeModel = position.entry_trigger === 'llm_intel' ? position.trigger_ref : null;

	const [journal, oracleHistory, oracleCurrent, firewall, judge, riskReview, sentiment, tokenRisk, intel] = await Promise.all([
		all(sql`
			select event, reason, rationale, sold_fraction, leg_pnl_lamports, market_cap_usd, venue, mode, ts, sig
			from trading_journal where position_id = ${id}
			order by ts asc limit 50
		`),
		first(sql`
			select score, tier, pedigree, structure, narrative, momentum, rug_risk, upside, give_back_risk, scored_at
			from oracle_conviction_history
			where mint = ${mint} and network = ${network} and scored_at <= ${entryCutoff}
			order by scored_at desc limit 1
		`),
		first(sql`
			select score, tier, pedigree, structure, narrative, momentum, rug_risk, upside, give_back_risk, reasons, scored_at
			from oracle_conviction where mint = ${mint} and network = ${network} limit 1
		`),
		first(sql`
			select verdict, score, reasons, checks, simulated, enforced, created_at
			from firewall_decisions
			where mint = ${mint} and network = ${network} and side = 'buy' and agent_id = ${String(agentId)}
			  and created_at between ${lookback} and ${entryCutoff}
			order by abs(extract(epoch from (created_at - ${opened}::timestamptz))) asc
			limit 1
		`),
		judgeModel
			? first(sql`
				select buy, confidence, thesis, model, created_at from sniper_llm_verdicts
				where mint = ${mint} and network = ${network} and model = ${judgeModel} limit 1
			`)
			: first(sql`
				select buy, confidence, thesis, model, created_at from sniper_llm_verdicts
				where mint = ${mint} and network = ${network} and created_at <= ${entryCutoff}
				order by created_at desc limit 1
			`),
		first(sql`
			select level, veto, severity, reasons, proposed_lamports, adjusted_lamports, enforced, model, created_at
			from sniper_risk_reviews where position_id = ${id}
			order by created_at desc limit 1
		`),
		first(sql`
			select signal, headline, rationale, confidence, sentiment_adj, source, tx_signature, checked_at
			from sniper_coin_sentiment where mint = ${mint} and network = ${network} limit 1
		`),
		first(sql`
			select rugpull_score, risk_level, signal, confidence, rejected, tx_signature, checked_at
			from token_intel_risk where mint = ${mint} and network = ${network} limit 1
		`),
		first(sql`
			select quality_score, category, narrative, smart_money_count, bundle_score, organic_score,
			       concentration_top10, unique_buyers, risk_flags, is_news_meme,
			       first_seen_at, observation_ended_at, updated_at
			from pump_coin_intel where mint = ${mint} limit 1
		`),
	]);

	return shapeTradeReceipt({
		position, journal, oracleHistory, oracleCurrent, firewall, judge, riskReview, sentiment, tokenRisk, intel,
	});
}
