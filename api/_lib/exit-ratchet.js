/**
 * Two-phase ratcheting trailing stop and the stable reason codes for exits and
 * refusals (order engine, lane D).
 *
 * Phase 1 is a wide fixed stop below the entry (`initialStopPct`): the position
 * gets room to breathe. Each lock tier `{ profit_pct, lock_pct }` arms once the
 * high-water mark has shown `profit_pct` of profit over the entry, and from then
 * on the stop never falls below `entry * (1 + lock_pct / 100)`. The stop only
 * ever ratchets up: the high-water mark is monotonic, so a tier, once reached,
 * stays reached even when price falls back under the tier's trigger level.
 *
 * Everything here is pure (no I/O) so the sweep worker, the HTTP preview and the
 * tests share one answer.
 */

/** Stable codes carried by every refusal or exit. Never rename a code. */
export const REASON_CODES = Object.freeze({
	DAILY_LOSS: 'Daily loss limit reached',
	DRAWDOWN: 'Fell through the initial stop',
	IMPACT: 'Price impact above the safety limit',
	TIER_LOCK: 'Fell back to a locked-in profit tier',
});

const GUARD_TO_REASON = new Map([
	['daily_loss_limit', 'DAILY_LOSS'],
	['price_impact', 'IMPACT'],
	['price_impact_too_high', 'IMPACT'],
]);

/** The stable code for a guard reason (executor / guard vocabulary), or null. */
export function reasonCodeForGuard(reason) {
	return GUARD_TO_REASON.get(String(reason || '')) || null;
}

export const MAX_RATCHET_TIERS = 8;

const finite = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Validate a ratchet spec. Tiers must strictly ascend in profit_pct and lock_pct,
 * and every lock must sit below the profit that arms it (a lock at or above its
 * own trigger would sell instantly).
 * @returns {{ ok: true, ratchet: { initial_stop_pct: number, tiers: Array<{profit_pct:number, lock_pct:number}> } } | { ok: false, message: string }}
 */
export function normalizeRatchet(raw) {
	if (!raw || typeof raw !== 'object') return { ok: false, message: 'ratchet { initial_stop_pct, tiers } is required' };
	const initial = finite(raw.initial_stop_pct);
	if (initial == null || initial <= 0 || initial >= 100) {
		return { ok: false, message: 'ratchet.initial_stop_pct must be between 0 and 100' };
	}
	if (!Array.isArray(raw.tiers) || raw.tiers.length < 1) return { ok: false, message: 'ratchet.tiers needs at least one tier' };
	if (raw.tiers.length > MAX_RATCHET_TIERS) return { ok: false, message: `ratchet.tiers may have at most ${MAX_RATCHET_TIERS} tiers` };
	const tiers = [];
	for (const t of raw.tiers) {
		const profit = finite(t?.profit_pct);
		const lock = finite(t?.lock_pct);
		if (profit == null || profit <= 0) return { ok: false, message: 'every tier needs a profit_pct above 0' };
		if (lock == null || lock < -initial) return { ok: false, message: `every tier needs a lock_pct of at least -${initial}` };
		if (lock >= profit) return { ok: false, message: 'a tier lock_pct must be below its profit_pct' };
		const prev = tiers[tiers.length - 1];
		if (prev && (profit <= prev.profit_pct || lock <= prev.lock_pct)) {
			return { ok: false, message: 'tiers must ascend: each profit_pct and lock_pct above the previous tier' };
		}
		tiers.push({ profit_pct: profit, lock_pct: lock });
	}
	return { ok: true, ratchet: { initial_stop_pct: initial, tiers } };
}

/**
 * Where the stop sits and why.
 * @param {{ entry: number, peak: number, ratchet: { initial_stop_pct: number, tiers: Array<{profit_pct:number, lock_pct:number}> } }} p
 * @returns {{ stop: number, phase: 1|2, tier: number|null, code: 'DRAWDOWN'|'TIER_LOCK' }}
 */
export function ratchetStop({ entry, peak, ratchet }) {
	const e = Number(entry);
	const hwm = Math.max(Number(peak) || 0, e);
	const initialStop = e * (1 - ratchet.initial_stop_pct / 100);
	let stop = initialStop;
	let tier = null;
	ratchet.tiers.forEach((t, i) => {
		if (hwm >= e * (1 + t.profit_pct / 100)) {
			const floor = e * (1 + t.lock_pct / 100);
			if (floor > stop) { stop = floor; tier = i; }
		}
	});
	return tier == null
		? { stop, phase: 1, tier: null, code: 'DRAWDOWN' }
		: { stop, phase: 2, tier, code: 'TIER_LOCK' };
}

/**
 * Decide an exit at the observed `value`. A gap straight through a lock tier
 * still fires (the test is `value <= stop`, not equality), at the first value the
 * sweep sees, which is the best fill the engine can honestly promise.
 * @returns {{ fire: boolean, code: 'DRAWDOWN'|'TIER_LOCK'|null, stop: number, phase: 1|2, tier: number|null }}
 */
export function evaluateRatchet({ entry, peak, value, ratchet }) {
	const e = Number(entry);
	const v = Number(value);
	if (!(e > 0) || !Number.isFinite(v)) return { fire: false, code: null, stop: NaN, phase: 1, tier: null };
	const s = ratchetStop({ entry: e, peak: Math.max(Number(peak) || 0, v), ratchet });
	return v <= s.stop ? { fire: true, ...s } : { fire: false, code: null, stop: s.stop, phase: s.phase, tier: s.tier };
}
