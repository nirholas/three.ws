// Pure rule for a notable odds move. No I/O, so the processor and the tests
// agree on what counts.

import { feedConfig } from './feed-config.js';

/** Window bucket a timestamp falls in: the key that makes one crossing fire once. */
export function moveBucket(atMs, windowSeconds = feedConfig.move.windowSeconds) {
	return Math.floor(atMs / (windowSeconds * 1000));
}

/** Scale shares so they sum to 1, whether the source gave fractions or percents. */
export function normalizeShares(rows) {
	const total = rows.reduce((s, r) => s + (Number(r.share) || 0), 0);
	if (!(total > 0)) return rows.map((r) => ({ ...r, share: rows.length ? 1 / rows.length : 0 }));
	return rows.map((r) => ({ ...r, share: (Number(r.share) || 0) / total }));
}

/**
 * Outcomes whose share changed by at least the threshold (percentage points)
 * between `baseline` (outcome_id to share at the start of the window) and now.
 */
export function notableMoves(baseline, current, thresholdPoints = feedConfig.move.thresholdPoints) {
	const base = baseline instanceof Map ? baseline : new Map(Object.entries(baseline || {}));
	const out = [];
	for (const row of current) {
		if (!base.has(row.outcome_id)) continue;
		const from = base.get(row.outcome_id);
		// Rounded first: 0.55 - 0.6 is -4.999... in floats, which must still count as 5 points.
		const delta = Math.round((row.share - from) * 10000) / 100;
		if (Math.abs(delta) >= thresholdPoints) {
			out.push({
				outcome_id: row.outcome_id,
				share_from: from,
				share_to: row.share,
				delta_points: delta,
			});
		}
	}
	return out;
}
