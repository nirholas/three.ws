// @ts-check
// Honesty guard for the "Match my photo" lane (pixal3d).
//
// Measured on 2026-11-26 from forge_creations (30 days): 94 pixal3d jobs, 2 done
// (each about 16 minutes, a cold start streaming ~46 GB of weights), 55 failed as
// "task orphaned: its runner instance stopped mid-job", and the rest failed on
// reference images the worker could not fetch. Poll-time failover already rescued
// 53 of the 55 orphans, but only after the user had waited out the whole failure.
//
// Two rules close the gap without touching the protected TRELLIS lane:
//   1. Allowance. A pixal3d job that has not finished inside PIXAL3D_ALLOWANCE_S is
//      treated as failed so the existing poll-time failover continues the same job
//      on the standard photo lane right away, with the user's original photo.
//   2. Health gate. When the lane's recent worker-attributable success rate is low,
//      a new submit goes straight to the standard lane instead of queueing behind a
//      lane that will most likely fail. Input faults (a reference URL the worker
//      cannot fetch) are not the lane's fault and are not counted against it.

import { sql } from './db.js';

export const PIXAL3D_LANE = 'pixal3d';

// Seconds a Match-my-photo job may stay queued or running before the job moves to
// the standard engine. A warm run is about 100 s and a cold start about 110 s on
// paper; real cold starts measured 16 minutes. 7 minutes covers a slow warm run
// and cuts the wait for a model by more than half versus the measured cold start.
export const PIXAL3D_ALLOWANCE_S = 420;

// The gate needs this many finished jobs in the window before it will judge the
// lane, and closes below this success rate (worker-attributable failures only).
export const GATE_MIN_SAMPLE = 5;
export const GATE_MIN_SUCCESS = 0.5;
export const GATE_WINDOW_DAYS = 7;

// Worker errors that name the caller's input, not the lane's health.
const INPUT_FAULT_RE = /^(image source |unsupported image source|invalid image)/i;

/** @param {string|null|undefined} error */
export function isInputFault(error) {
	return INPUT_FAULT_RE.test(String(error || '').trim());
}

/**
 * True when a pixal3d job is still pending past its allowance.
 * @param {{ backend?: string|null, status?: string|null, createdAt?: string|null, now?: number, allowanceS?: number }} input
 */
export function allowanceExceeded({ backend, status, createdAt, now = Date.now(), allowanceS = PIXAL3D_ALLOWANCE_S }) {
	if (backend !== PIXAL3D_LANE) return false;
	if (status !== 'queued' && status !== 'running') return false;
	const started = createdAt ? Date.parse(createdAt) : NaN;
	if (!Number.isFinite(started)) return false;
	return now - started > allowanceS * 1000;
}

/**
 * Decide whether the lane is healthy enough to take a new job. Pure.
 * @param {{ done: number, workerFailed: number, minSample?: number, minSuccess?: number }} stats
 * @returns {{ gated: boolean, finished: number, success_pct: number|null, reason: string|null }}
 */
export function decideLaneGate({ done, workerFailed, minSample = GATE_MIN_SAMPLE, minSuccess = GATE_MIN_SUCCESS }) {
	const finished = (done || 0) + (workerFailed || 0);
	if (finished < minSample) return { gated: false, finished, success_pct: finished ? pct(done, finished) : null, reason: null };
	const rate = done / finished;
	if (rate >= minSuccess) return { gated: false, finished, success_pct: pct(done, finished), reason: null };
	return {
		gated: true,
		finished,
		success_pct: pct(done, finished),
		reason: `Match my photo finished ${done} of its last ${finished} jobs, so new photos are made with the standard engine until it recovers.`,
	};
}

function pct(n, d) {
	return Math.round((n / d) * 1000) / 10;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null;

/** Test hook. */
export function resetPixal3dStatsCache() {
	cache = null;
}

/**
 * Recent measured health of the lane: gate decision plus the real typical
 * duration of a successful job. Fail-open: a database error means "not gated, no
 * measurement", never a blocked lane.
 */
export async function pixal3dLaneHealth({ now = Date.now() } = {}) {
	if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
	let value;
	try {
		const rows = await sql`
			select status, left(coalesce(error, ''), 80) as error,
			       extract(epoch from (completed_at - created_at)) as seconds
			from forge_creations
			where backend = ${PIXAL3D_LANE}
			  and status in ('done', 'failed')
			  and created_at > now() - make_interval(days => ${GATE_WINDOW_DAYS})
		`;
		let done = 0;
		let workerFailed = 0;
		const secs = [];
		for (const r of rows) {
			if (r.status === 'done') {
				done += 1;
				if (Number(r.seconds) > 0) secs.push(Number(r.seconds));
			} else if (!isInputFault(r.error)) {
				workerFailed += 1;
			}
		}
		secs.sort((a, b) => a - b);
		const typicalSeconds = secs.length ? Math.round(secs[Math.floor((secs.length - 1) / 2)]) : null;
		value = { ...decideLaneGate({ done, workerFailed }), typical_seconds: typicalSeconds, allowance_seconds: PIXAL3D_ALLOWANCE_S };
	} catch {
		value = { gated: false, finished: 0, success_pct: null, reason: null, typical_seconds: null, allowance_seconds: PIXAL3D_ALLOWANCE_S };
	}
	cache = { at: now, value };
	return value;
}
