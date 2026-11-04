// agent-sniper telemetry: per-second price ticks and stage latencies.
//
// Ticks answer "what would a different exit rule have done?" and the stage
// stamps answer "where does entry time go?". Both are measurements only: they
// never gate a trade, and a failed write is logged and dropped.

import { sql } from '../../api/_lib/db.js';
import { log } from './log.js';

export const TICK_MIN_SPACING_MS = 1000;
/** A candidate is only worth timing from the signal until this long after it. */
export const CANDIDATE_WINDOW_MS = 120_000;
const SOURCES = new Set(['position', 'moonbag', 'candidate']);

/** True when at least TICK_MIN_SPACING_MS passed since the last sample (or the clock went backwards). */
export function shouldSampleTick(lastTs, now) {
	if (lastTs == null) return true;
	if (now < lastTs) return true;
	return now - lastTs >= TICK_MIN_SPACING_MS;
}

/** Shape one tick row. Price per token stays null when the base amount is unknown. */
export function tickRow(pos, valueLamports, source) {
	if (!SOURCES.has(source)) throw new Error(`unknown tick source: ${source}`);
	const value = Number(valueLamports);
	if (!Number.isFinite(value)) throw new Error('tick value must be finite');
	const base = Number(pos.base_amount);
	return {
		position_id: pos.position_id ?? pos.id,
		mint: pos.mint,
		network: pos.network,
		value_lamports: Math.round(value),
		price_lamports_per_token: base > 0 ? Math.round(value) / base : null,
		source,
	};
}

/** Per-stage gaps in ms between the four stamps, null when an endpoint is missing or the gap is negative. */
export function stageLatencies(row) {
	const t = (v) => (v ? new Date(v).getTime() : null);
	const gap = (a, b) => {
		const x = t(row[a]);
		const y = t(row[b]);
		if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
		return y - x >= 0 ? y - x : null;
	};
	return {
		signal_to_decision: gap('signal_seen_at', 'decision_at'),
		decision_to_sent: gap('decision_at', 'sent_at'),
		sent_to_landed: gap('sent_at', 'landed_at'),
		total: gap('signal_seen_at', 'landed_at'),
	};
}

/** Nearest-rank percentile; null for no data. */
export function percentile(values, p) {
	const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
	if (!a.length) return null;
	const rank = Math.max(1, Math.ceil((p / 100) * a.length));
	return a[Math.min(a.length, rank) - 1];
}

const lastSampled = new Map();

/** Insert a shaped tick row, throttled to one per second per position. Never throws. */
export async function writeTick(r, now = Date.now()) {
	if (!shouldSampleTick(lastSampled.get(r.position_id), now)) return false;
	try {
		lastSampled.set(r.position_id, now);
		await sql`
			INSERT INTO agent_sniper_price_ticks (position_id, mint, network, value_lamports, price_lamports_per_token, source)
			VALUES (${r.position_id}, ${r.mint}, ${r.network}, ${r.value_lamports}, ${r.price_lamports_per_token}, ${r.source})
		`;
		return true;
	} catch (err) {
		log.warn('price tick write failed', { mint: r.mint, err: err?.message });
		return false;
	}
}

/** Shape and record a tick for a position. Never throws. */
export async function recordPriceTick(pos, valueLamports, source = 'position', now = Date.now()) {
	try {
		return await writeTick(tickRow(pos, valueLamports, source), now);
	} catch (err) {
		log.warn('price tick rejected', { mint: pos.mint, err: err?.message });
		return false;
	}
}

/** Forget a position's sampling clock once it is done. */
export function forgetTickClock(id) {
	lastSampled.delete(id);
}
