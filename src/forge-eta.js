// Forge wait estimates, derived from what the lanes actually did.
//
// The catalog's per-lane ETA (api/_lib/forge-tiers.js baseEta) is a hand-set
// figure, and for the lane that serves most jobs it understates reality by more
// than half. /api/nvidia/stats publishes the measured p50 and p95 of every GPU
// lane's finished jobs (public, anonymous, cached five minutes at the CDN), so
// the page phrases the wait from those numbers: what a typical run takes, what a
// slow one takes, and an honest statement once a job has passed the slow mark.
//
// Nothing here advances on its own. Every function is a pure read of (elapsed
// seconds, measured timing); the caller re-asks once a second with the real
// elapsed time, and the only network call is the one stats fetch.

export const LANE_STATS_URL = '/api/nvidia/stats';

// A lane needs this many finished jobs in a window before its percentiles are
// quoted. Fewer than that and the figure is an anecdote, so the page falls back
// to the catalog's own estimate and says which one it is using.
export const MIN_SAMPLE = 5;

const STATS_TTL_MS = 5 * 60 * 1000;
// A failed read is retried soon, but not on every call: the page asks on each
// engine change and each generation, and a broken endpoint must not be hammered.
const STATS_RETRY_MS = 30 * 1000;
const STATS_TIMEOUT_MS = 5000;

/**
 * The measured timing of one lane, or null when the stats hold too little to
 * quote. Prefers the 7 day window (it follows the lane as it is now) and falls
 * back to 30 days when the week is too quiet.
 *
 * @returns {{ laneId: string, window: '7d'|'30d', jobs: number, typicalS: number, slowS: number } | null}
 */
export function pickLaneTiming(stats, laneId) {
	const lane = Array.isArray(stats?.lanes) ? stats.lanes.find((l) => l?.id === laneId) : null;
	if (!lane?.jobs) return null;
	for (const window of ['7d', '30d']) {
		const w = lane.jobs[window];
		const done = Number(w?.done);
		const p50 = Number(w?.p50_ms);
		const p95 = Number(w?.p95_ms);
		if (!(done >= MIN_SAMPLE) || !(p50 > 0)) continue;
		const typicalS = Math.max(1, Math.round(p50 / 1000));
		// A slow run is by definition slower than a typical one. When the sample is
		// thin the two percentiles can coincide, so keep a floor above the median.
		const slowS = Math.max(Math.round((p95 > 0 ? p95 : p50) / 1000), Math.round(typicalS * 1.25));
		return { laneId, window, jobs: done, typicalS, slowS };
	}
	return null;
}

/** "45 s", "2 min 30 s", "7 min". Rounded, because the inputs are percentiles. */
export function formatDuration(seconds) {
	const s = Math.max(0, Math.round(Number(seconds) || 0));
	if (s < 60) return `${Math.max(1, Math.round(s / 5) * 5 || s)} s`;
	const step = s >= 180 ? 30 : 10;
	const rounded = Math.round(s / step) * step;
	const m = Math.floor(rounded / 60);
	const r = rounded % 60;
	return r ? `${m} min ${r} s` : `${m} min`;
}

/** m:ss for the elapsed clock and the tab title. */
export function formatClock(seconds) {
	const s = Math.max(0, Math.floor(Number(seconds) || 0));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The range sentence shown before a job starts (the estimate line under the
 * Generate button and the tier tooltips). Measured when the stats allow,
 * otherwise the catalog figure, worded as the catalog's rather than a
 * measurement.
 */
export function describeRange({ timing, catalogEtaS = null }) {
	if (timing) {
		return `typically ${formatDuration(timing.typicalS)}, slower runs up to ${formatDuration(timing.slowS)}`;
	}
	if (Number(catalogEtaS) > 0) return `estimated ${formatDuration(catalogEtaS)}`;
	return '';
}

/**
 * What the wait meter says at this moment.
 *
 * phase:
 *   'typical'  inside the typical time
 *   'slower'   past the typical time, still inside the range slow runs take
 *   'slowest'  past the slow mark: slower than the slowest recent runs
 *   'unknown'  nothing is known about this lane's duration
 * `over` is true once the job has passed the typical time, so the page can tint
 * the meter. `text` is the sentence for the meter line, `announce` is the same
 * fact phrased for a screen reader and is only set on a phase change.
 */
export function describeWait({ elapsedS, timing, catalogEtaS = null, cold = false, coldAllowanceS = null }) {
	const e = Math.max(0, Math.floor(Number(elapsedS) || 0));
	const coldNote =
		cold && Number(coldAllowanceS) > 0
			? ` A cold start can add up to ${formatDuration(coldAllowanceS)} on top.`
			: '';

	if (timing) {
		const typical = formatDuration(timing.typicalS);
		const slow = formatDuration(timing.slowS);
		if (e < timing.typicalS) {
			return {
				phase: 'typical',
				over: false,
				text: `Typically ${typical}, slower runs up to ${slow}.${coldNote}`,
			};
		}
		if (e < timing.slowS) {
			return {
				phase: 'slower',
				over: true,
				text: `Past the typical ${typical}, still inside what slower runs take (up to ${slow}). Still running.`,
			};
		}
		return {
			phase: 'slowest',
			over: true,
			text:
				timing.jobs >= 20
					? `Slower than 19 in 20 recent runs, which finished within ${slow}. Still running, and nothing is lost.`
					: `Past the ${slow} that recent runs on this engine finished within. Still running, and nothing is lost.`,
		};
	}

	if (Number(catalogEtaS) > 0) {
		const eta = Number(catalogEtaS);
		if (e <= eta) {
			return { phase: 'typical', over: false, text: `Estimated ${formatDuration(eta)}.${coldNote}` };
		}
		return {
			phase: 'slowest',
			over: true,
			text: `Past the ${formatDuration(eta)} estimate. Still running, and nothing is lost.`,
		};
	}

	return { phase: 'unknown', over: false, text: '' };
}

/** Phrase a phase change for a screen reader, or '' when there is nothing new. */
export function announceFor(phase, previous) {
	if (phase === previous) return '';
	if (phase === 'slower') return 'Taking a little longer than typical. Still running.';
	if (phase === 'slowest') return 'Taking longer than most runs. Still running, nothing is lost.';
	return '';
}

/**
 * A small cache around the stats request. `timing(laneId)` is synchronous and
 * returns null until the first answer lands, so a slow or failed request only
 * means the catalog estimate is shown, never that the page waits.
 */
export function createLaneTimings({ fetchImpl = (...a) => fetch(...a), now = () => Date.now(), url = LANE_STATS_URL } = {}) {
	let stats = null;
	let fetchedAt = 0;
	let failedAt = 0;
	let inflight = null;
	const listeners = new Set();

	function fresh() {
		return stats && now() - fetchedAt < STATS_TTL_MS;
	}

	async function load() {
		if (fresh()) return stats;
		if (inflight) return inflight;
		if (failedAt && now() - failedAt < STATS_RETRY_MS) return stats;
		inflight = (async () => {
			const ctl = typeof AbortController === 'function' ? new AbortController() : null;
			const timer = ctl ? setTimeout(() => ctl.abort(), STATS_TIMEOUT_MS) : null;
			try {
				const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: ctl?.signal });
				if (!res.ok) throw new Error(`stats ${res.status}`);
				const body = await res.json();
				if (!Array.isArray(body?.lanes)) throw new Error('stats payload has no lanes');
				stats = body;
				fetchedAt = now();
				failedAt = 0;
				for (const fn of listeners) fn();
			} catch {
				// The estimate falls back to the catalog figure. Keep any older stats
				// (still better than none) and note the failure so it is not retried
				// on every call.
				failedAt = now();
			} finally {
				if (timer) clearTimeout(timer);
				inflight = null;
			}
			return stats;
		})();
		return inflight;
	}

	return {
		load,
		timing: (laneId) => pickLaneTiming(stats, laneId),
		/** Called whenever fresh stats arrive, so a visible estimate can repaint. */
		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
	};
}
