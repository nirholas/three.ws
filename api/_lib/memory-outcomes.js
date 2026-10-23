/**
 * Outcome weighting for memory recall.
 *
 * A memory that was recalled into a decision inherits that decision's realized
 * result (pnl in USD, win/loss, hold time) when the trade, order or payment
 * closes. Recall then nudges such memories up or down by a bounded weight.
 *
 *   weight = 1 + OUTCOME_SPAN * m,   m = Σ s_i·d_i / (Σ d_i + 1)
 *   s_i    = tanh(pnl_usd / PNL_SCALE_USD)   signed outcome strength in (-1, 1)
 *   d_i    = 0.5 ^ (age_i / HALF_LIFE_DAYS)  recency decay of each outcome
 *
 * The "+ 1" shrinks a lone or old outcome toward neutral, so evidence fades as it
 * ages. The weight is clamped to [MIN_WEIGHT, MAX_WEIGHT] and can never reach
 * zero: a memory tied to a loss is demoted, not hidden, so it still returns as a
 * warning. With no outcomes the weight is exactly 1.
 */

export const PNL_SCALE_USD = 50;
export const HALF_LIFE_DAYS = 45;
export const OUTCOME_SPAN = 0.35;
export const MIN_WEIGHT = 0.65;
export const MAX_WEIGHT = 1.35;

const DAY_MS = 86_400_000;

/**
 * @param {Array<{pnl_usd:number|null, win:boolean|null, closed_at:Date|string|number}>} outcomes
 * @param {number} [now]
 * @returns {{weight:number, samples:number, wins:number, losses:number, net_pnl_usd:number, last_closed_at:string|null}}
 */
export function outcomeWeight(outcomes, now = Date.now()) {
	const list = Array.isArray(outcomes) ? outcomes : [];
	let num = 0;
	let den = 0;
	let wins = 0;
	let losses = 0;
	let net = 0;
	let last = 0;
	for (const o of list) {
		const pnl = Number(o.pnl_usd);
		const hasPnl = Number.isFinite(pnl);
		const closed = new Date(o.closed_at).getTime();
		const ageDays = Number.isFinite(closed) ? Math.max(0, (now - closed) / DAY_MS) : 0;
		const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
		let s;
		if (hasPnl) s = Math.tanh(pnl / PNL_SCALE_USD);
		else if (o.win === true) s = 0.25;
		else if (o.win === false) s = -0.25;
		else continue;
		if (o.win === true || (o.win == null && s > 0)) wins++;
		else losses++;
		if (hasPnl) net += pnl;
		if (Number.isFinite(closed) && closed > last) last = closed;
		num += s * decay;
		den += decay;
	}
	const samples = wins + losses;
	const m = samples ? num / (den + 1) : 0;
	const weight = Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, 1 + OUTCOME_SPAN * m));
	return {
		weight: Number(weight.toFixed(4)),
		samples,
		wins,
		losses,
		net_pnl_usd: Number(net.toFixed(2)),
		last_closed_at: last ? new Date(last).toISOString() : null,
	};
}

/** Group flat memory_outcomes rows by memory id. */
export function groupOutcomes(rows) {
	const by = new Map();
	for (const r of rows || []) {
		const k = String(r.memory_id);
		if (!by.has(k)) by.set(k, []);
		by.get(k).push(r);
	}
	return by;
}
