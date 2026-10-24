// Shadow mode for agent prediction strategies.
//
// Every agent's strategy defaults to `shadow`. An intent (market, side, stake)
// is priced against the live order book, recorded to prediction_shadow_ledger
// with the price at decision time, and nothing else happens: no preview, no
// order build, no wallet access. Going live is an explicit setting only the
// signed-in owner can flip (PUT .../predictions/strategy); even then an intent
// only produces the engine's normal preview, and the confirmed execute stays
// the owner's call.
//
// Open entries are marked to market from the venue's bid and settled when the
// market resolves, so the dashboard can compare what shadow would have earned,
// net of fees and slippage, before the owner enables live.

import { sql } from '../db.js';
import { logAudit } from '../audit.js';
import { getVenue, DEFAULT_VENUE } from './index.js';
import { asksFor, estimateBuy } from './book.js';
import { totalFee, DEFAULT_MODELS } from './arb.js';
import { PredictionError, MIN_STAKE_USD, MAX_STAKE_USD, loadOwnedAgent, previewOpen } from './engine.js';

export const MODES = Object.freeze(['shadow', 'live']);
const round = (n, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp + 0;

// ── Strategy setting ─────────────────────────────────────────────────────────

/** The agent's strategy, with defaults. Anything but an explicit 'live' is shadow. */
export function getStrategy(meta, models = DEFAULT_MODELS) {
	const d = models.strategy_defaults;
	const s = meta?.prediction_strategy || {};
	const num = (v, fallback, lo, hi) => {
		const n = Number(v);
		return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
	};
	return {
		mode: s.mode === 'live' ? 'live' : 'shadow',
		max_stake_usd: num(s.max_stake_usd, d.max_stake_usd, MIN_STAKE_USD, MAX_STAKE_USD),
		min_edge_pct: num(s.min_edge_pct, d.min_edge_pct, 0, 100),
		updated_at: s.updated_at || null,
	};
}

/** Whether a patch moves the strategy toward live or loosens a cap. */
export function strategyLoosens(prev, next) {
	return (next.mode === 'live' && prev.mode !== 'live') || next.max_stake_usd > prev.max_stake_usd || next.min_edge_pct < prev.min_edge_pct;
}

/**
 * Patch the strategy. Loosening (live, a larger stake cap, a lower edge floor)
 * needs the owner's signed-in session; tightening is open to any caller.
 */
export async function setStrategy({ agentId, userId, patch, ownerSession, req = null }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const prev = getStrategy(agent.meta);
	const p = patch && typeof patch === 'object' ? patch : {};
	if ('mode' in p && !MODES.includes(p.mode)) throw new PredictionError('invalid_mode', `mode must be one of: ${MODES.join(', ')}.`);
	const next = getStrategy({ prediction_strategy: { ...prev, ...pick(p, ['mode', 'max_stake_usd', 'min_edge_pct']) } });
	if (strategyLoosens(prev, next) && !ownerSession) {
		throw new PredictionError(
			'owner_session_required',
			'Turning live on or loosening a strategy cap needs the owner signed in on three.ws. Nothing changed.',
			403,
			{ keys: Object.keys(p) },
		);
	}
	next.updated_at = new Date().toISOString();
	await sql`
		UPDATE agent_identities
		SET meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{prediction_strategy}', ${JSON.stringify(next)}::jsonb)
		WHERE id = ${agentId}
	`;
	logAudit({ userId, action: 'custody.prediction_strategy_change', resourceId: agentId, meta: { prev, next }, req });
	return next;
}

function pick(obj, keys) {
	const out = {};
	for (const k of keys) if (k in obj) out[k] = obj[k];
	return out;
}

// ── Pricing an intent ────────────────────────────────────────────────────────

/**
 * Price a buy of `stakeUsd` of one side from the order book. Pure.
 * @returns {{ price_at_decision: number, entry_price: number, contracts: number, cost_usd: number, fees_usd: number, filled_fully: boolean }|null}
 */
export function priceIntent({ book, side, stakeUsd, provider, maxPrice = 0.99, models = DEFAULT_MODELS }) {
	const asks = asksFor(book, side);
	if (!asks.length) return null;
	const est = estimateBuy(asks, stakeUsd, maxPrice);
	if (!est.contracts || est.avg_price == null) return null;
	const cost = est.spent_usd;
	const fees = est.contracts * totalFee(models, provider, est.avg_price);
	return {
		price_at_decision: asks[0][0],
		entry_price: round(est.avg_price),
		contracts: round(est.contracts),
		cost_usd: round(cost),
		fees_usd: round(fees),
		filled_fully: est.filled_fully,
	};
}

// ── Marking ──────────────────────────────────────────────────────────────────

/**
 * Mark or settle one ledger entry against the current market. Pure.
 * A resolved market pays $1 a contract on the winning side; a refund or draw
 * returns the cost; an open market is valued at the side's bid, less the exit
 * fee, which is what selling now would have realized.
 */
export function markEntry(entry, market, models = DEFAULT_MODELS) {
	const contracts = Number(entry.contracts);
	const spent = Number(entry.cost_usd) + Number(entry.fees_usd);
	const result = market?.result || null;
	if (result === 'yes' || result === 'no') {
		const won = result === entry.side;
		const payout = won ? contracts : 0;
		return { status: won ? 'won' : 'lost', mark_price: won ? 1 : 0, payout_usd: round(payout), pnl_usd: round(payout - spent), resolved: true };
	}
	if (result === 'refund' || result === 'draw' || market?.status === 'void') {
		return {
			status: 'void',
			mark_price: Number(entry.entry_price),
			payout_usd: round(Number(entry.cost_usd)),
			pnl_usd: round(-Number(entry.fees_usd)),
			resolved: true,
		};
	}
	const bid = market?.outcomes?.find((o) => o.side === entry.side)?.sell_price;
	if (bid == null) return { status: 'open', mark_price: null, payout_usd: null, pnl_usd: null, resolved: false };
	const exitFee = contracts * totalFee(models, market.provider, bid);
	return {
		status: 'open',
		mark_price: bid,
		payout_usd: round(contracts * bid - exitFee),
		pnl_usd: round(contracts * bid - exitFee - spent),
		resolved: false,
	};
}

// ── Summary ──────────────────────────────────────────────────────────────────

/**
 * Compare shadow with live. For each mode: realized P&L (settled entries),
 * unrealized P&L (open entries at the bid), win rate, and the gross P&L the
 * same trades would show with no fees and no slippage, to expose what the
 * costs take. Pure.
 */
export function summarize(rows) {
	const blank = () => ({
		entries: 0,
		open: 0,
		settled: 0,
		won: 0,
		lost: 0,
		staked_usd: 0,
		realized_pnl_usd: 0,
		unrealized_pnl_usd: 0,
		total_pnl_usd: 0,
		gross_pnl_usd: 0,
		costs_usd: 0,
		win_rate: null,
	});
	const out = { shadow: blank(), live: blank() };
	for (const r of rows) {
		const s = out[r.mode] || out.shadow;
		const contracts = Number(r.contracts);
		const cost = Number(r.cost_usd);
		const fees = Number(r.fees_usd);
		s.entries += 1;
		s.staked_usd += cost;
		if (r.status === 'open') s.open += 1;
		else s.settled += 1;
		if (r.status === 'won') s.won += 1;
		if (r.status === 'lost') s.lost += 1;
		if (r.pnl_usd != null) {
			if (r.status === 'open') s.unrealized_pnl_usd += Number(r.pnl_usd);
			else s.realized_pnl_usd += Number(r.pnl_usd);
		}
		const quoted = contracts * Number(r.price_at_decision);
		if (r.status === 'won') s.gross_pnl_usd += contracts - quoted;
		else if (r.status === 'lost') s.gross_pnl_usd -= quoted;
		else if (r.status === 'open' && r.mark_price != null) s.gross_pnl_usd += contracts * Number(r.mark_price) - quoted;
		s.costs_usd += fees + contracts * (Number(r.entry_price) - Number(r.price_at_decision));
	}
	for (const s of Object.values(out)) {
		s.total_pnl_usd = round(s.realized_pnl_usd + s.unrealized_pnl_usd, 2);
		for (const k of ['staked_usd', 'realized_pnl_usd', 'unrealized_pnl_usd', 'gross_pnl_usd', 'costs_usd']) s[k] = round(s[k], 2);
		s.win_rate = s.won + s.lost > 0 ? round(s.won / (s.won + s.lost), 4) : null;
	}
	return out;
}

// ── Ledger I/O ───────────────────────────────────────────────────────────────

/**
 * Record an intent. In shadow mode this is the whole story: no engine call, no
 * wallet read, no order. In live mode the intent is recorded as well and the
 * engine's normal preview is returned for the owner to confirm.
 */
export async function submitIntent({ agentId, userId, intent, source = 'agent', venueId = DEFAULT_VENUE, deps = {} }) {
	const preview = deps.previewOpen || previewOpen;
	const agent = await loadOwnedAgent(agentId, userId);
	const strategy = getStrategy(agent.meta);
	const side = String(intent?.side || '').toLowerCase();
	if (side !== 'yes' && side !== 'no') throw new PredictionError('invalid_side', 'side must be "yes" or "no".');
	const stake = Number(intent?.stake_usd);
	if (!Number.isFinite(stake) || stake < MIN_STAKE_USD || stake > strategy.max_stake_usd) {
		throw new PredictionError('invalid_stake', `stake_usd must be between $${MIN_STAKE_USD} and this agent's strategy cap of $${strategy.max_stake_usd}.`);
	}
	const venue = getVenue(venueId);
	const market = await venue.getMarket(String(intent?.market_id || ''));
	if (!market.tradable) throw new PredictionError('market_closed', `This market is ${market.status || 'not open'}; there is nothing to decide on.`, 409);
	const book = await venue.getOrderbook(market.id);
	const priced = priceIntent({ book, side, stakeUsd: stake, provider: market.provider, maxPrice: intent?.max_price ?? 0.99 });
	if (!priced) throw new PredictionError('no_liquidity', 'Nobody is selling this side right now, so there is no price to decide at.', 409);
	const edge = intent?.edge_pct != null && Number.isFinite(Number(intent.edge_pct)) ? Number(intent.edge_pct) : null;
	if (edge != null && edge < strategy.min_edge_pct) {
		throw new PredictionError(
			'edge_below_floor',
			`The stated edge of ${edge}% is under this agent's floor of ${strategy.min_edge_pct}%, so nothing was recorded.`,
			409,
		);
	}

	const [row] = await sql`
    INSERT INTO prediction_shadow_ledger
      (agent_id, user_id, venue, mode, market_id, event_id, title, provider, side, stake_usd, contracts,
       price_at_decision, entry_price, fees_usd, cost_usd, edge_pct, reason, source, close_time)
    VALUES
      (${agent.id}, ${userId}, ${venue.id}, ${strategy.mode}, ${market.id}, ${market.event_id}, ${market.title}, ${market.provider},
       ${side}, ${stake}, ${priced.contracts}, ${priced.price_at_decision}, ${priced.entry_price}, ${priced.fees_usd},
       ${priced.cost_usd}, ${edge}, ${intent?.reason ? String(intent.reason).slice(0, 500) : null}, ${source}, ${market.close_time})
    RETURNING *
  `;
	if (strategy.mode === 'shadow') {
		return { mode: 'shadow', recorded: row, note: 'Shadow mode: the decision was recorded at the live price. No order was built and no funds can move.' };
	}
	const quote = await preview({ agentId, userId, venueId: venue.id, marketId: market.id, side, stakeUsd: stake, maxPrice: intent?.max_price });
	return {
		mode: 'live',
		recorded: row,
		preview: quote,
		note: 'Live mode: the decision was recorded and the order is previewed. Nothing is sent until the owner confirms the preview.',
	};
}

/** Mark every open entry for an agent against current markets, then return the page. */
export async function listLedger({ agentId, userId, limit = 100, venueId = DEFAULT_VENUE, deps = {} }) {
	await loadOwnedAgent(agentId, userId);
	const venue = deps.venue || getVenue(venueId);
	const open = await sql`SELECT * FROM prediction_shadow_ledger WHERE agent_id = ${agentId} AND status = 'open'`;
	const ids = [...new Set(open.map((r) => r.market_id))].slice(0, 40);
	const markets = new Map();
	await Promise.all(
		ids.map(async (id) => {
			try {
				markets.set(id, await venue.getMarket(id));
			} catch {
				/* an unreadable market keeps its last mark */
			}
		}),
	);
	for (const r of open) {
		const m = markets.get(r.market_id);
		if (!m) continue;
		const mk = markEntry(r, m);
		await sql`
      UPDATE prediction_shadow_ledger
      SET status = ${mk.status}, mark_price = ${mk.mark_price}, payout_usd = ${mk.payout_usd}, pnl_usd = ${mk.pnl_usd}, marked_at = now(),
          resolved_at = ${mk.resolved ? new Date().toISOString() : null}
      WHERE id = ${r.id}
    `;
	}
	const rows = await sql`
    SELECT * FROM prediction_shadow_ledger WHERE agent_id = ${agentId}
    ORDER BY decided_at DESC LIMIT ${Math.min(500, Math.max(1, limit))}
  `;
	const all =
		await sql`SELECT mode, status, contracts, cost_usd, fees_usd, price_at_decision, entry_price, mark_price, pnl_usd FROM prediction_shadow_ledger WHERE agent_id = ${agentId}`;
	return { entries: rows, summary: summarize(all) };
}
