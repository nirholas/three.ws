// GPU-hour accounting for the LongCat host.
//
// The host is stopped and started on demand, so GPU spend is the sum of its
// running intervals. Each interval is {start, stop} in epoch milliseconds, with
// stop === null while the VM is still up. The ledger is a plain list kept in a
// small JSON object in Cloud Storage by host.mjs; everything below is pure so the
// cap logic is tested without a cloud.

export const DEFAULT_DAILY_CAP_HOURS = 6;
const HOUR = 3_600_000;

export function utcDayStart(ms) {
	const d = new Date(ms);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Insert or update an interval, keyed by its start time (idempotent). */
export function upsertInterval(ledger, interval) {
	const list = Array.isArray(ledger) ? ledger.filter((i) => i.start !== interval.start) : [];
	list.push({ start: interval.start, stop: interval.stop ?? null });
	list.sort((a, b) => a.start - b.start);
	return list;
}

/** Drop intervals that ended more than `keepDays` before `now`. */
export function pruneLedger(ledger, now, keepDays = 14) {
	const cutoff = now - keepDays * 24 * HOUR;
	return (ledger || []).filter((i) => (i.stop ?? now) >= cutoff);
}

/** GPU hours used on the UTC day containing `now`, counting an open interval up to `now`. */
export function hoursUsedToday(ledger, now) {
	const dayStart = utcDayStart(now);
	const dayEnd = dayStart + 24 * HOUR;
	let ms = 0;
	for (const i of ledger || []) {
		const a = Math.max(i.start, dayStart);
		const b = Math.min(i.stop ?? now, dayEnd, now);
		if (b > a) ms += b - a;
	}
	return ms / HOUR;
}

/**
 * Can the host be started? `minSessionHours` is the shortest useful session: a
 * start is refused when less than that remains, so the cap is a hard ceiling and
 * not a suggestion that one more boot can overshoot.
 */
export function capDecision({ ledger, now, capHours = DEFAULT_DAILY_CAP_HOURS, minSessionHours = 0.5 }) {
	const used = hoursUsedToday(ledger, now);
	const remaining = Math.max(0, capHours - used);
	if (remaining < minSessionHours) {
		return { allowed: false, reason: 'gpu_hour_cap_reached', usedHours: used, remainingHours: remaining, capHours };
	}
	return { allowed: true, reason: 'within_cap', usedHours: used, remainingHours: remaining, capHours };
}

/** Milliseconds until a running host must be stopped to stay inside the cap, or null when no cap is breached soon. */
export function msUntilCap({ ledger, now, capHours = DEFAULT_DAILY_CAP_HOURS }) {
	const remaining = capHours - hoursUsedToday(ledger, now);
	return Math.max(0, Math.round(remaining * HOUR));
}
