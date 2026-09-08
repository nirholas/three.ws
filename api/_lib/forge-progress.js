// Pre-submit progress crumbs for a forge generation.
//
// The problem this solves: POST /api/forge is ONE long request. Before it can
// answer with a job id it has to run the art-director pass, synthesize the
// photoreal reference view, and (on the fusing lane) paint the turnaround
// views. On a standard text prompt that is one LLM call plus up to four image
// generations, and every second of it used to be invisible: /forge could only
// show "art-directing your prompt" until the whole thing resolved, so the
// reference image the user is really waiting to see landed at the very END of
// the silent window instead of the moment it existed.
//
// There is no second channel on a single HTTP request, so the generation writes
// a crumb into the shared cache as it passes each REAL milestone, keyed by a
// caller-supplied trace id, and /forge reads them with a cheap poll while its
// POST is still in flight (GET /api/forge?progress=<id>).
//
// Rules this module exists to keep:
//   • Every crumb is written AFTER the work it names actually finished. There is
//     no "probably done by now" crumb and no timer anywhere in this file.
//   • It is entirely fail-open. A write failure, an absent Redis, an instance
//     that never sees the read: all of them degrade to exactly the behaviour
//     before this existed (the stage list waits for the POST). Nothing in a
//     generation may ever fail because a progress crumb did.
//   • The trace id comes from the CLIENT and is not a job handle: it grants no
//     access to anything. The crumbs it addresses hold only what the response
//     would carry seconds later anyway (the directed prompt, the reference URL),
//     they expire in minutes, and a caller that does not send one costs nothing.

import { cacheGetFresh, cacheSet } from './cache.js';

// Long enough to cover the slowest cold pre-submit phase with room to spare,
// short enough that an abandoned trace evaporates on its own.
const TTL_SECONDS = 300;
// A trace only ever collects the handful of milestones below; the cap is a
// belt-and-braces bound on what one id can make us store.
const MAX_CRUMBS = 8;

const STAGES = new Set(['directed', 'reference', 'views', 'submitting']);

/**
 * Accept a client-supplied trace id only in a shape we generate: url-safe, and
 * long enough not to collide across concurrent generations. Anything else is
 * treated as "no trace", never as an error, so a malformed id can only cost the
 * caller its own progress, never its generation.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeTraceId(raw) {
	const id = typeof raw === 'string' ? raw.trim() : '';
	return /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
}

function key(traceId) {
	return `forge:progress:${traceId}`;
}

/**
 * Record one completed milestone. Fire-and-forget by design: callers do not
 * await this on the generation's critical path.
 * @param {string|null} traceId
 * @param {'directed'|'reference'|'views'|'submitting'} stage
 * @param {Record<string, unknown>} [data]
 */
export async function recordForgeProgress(traceId, stage, data = {}) {
	const id = normalizeTraceId(traceId);
	if (!id || !STAGES.has(stage)) return;
	try {
		const existing = await cacheGetFresh(key(id));
		const crumbs = Array.isArray(existing) ? existing : [];
		// One crumb per stage: a lane that revisits a milestone (a failover that
		// re-paints the reference view) updates it rather than growing the list.
		const next = crumbs.filter((c) => c?.stage !== stage);
		next.push({ stage, at: Date.now(), ...data });
		await cacheSet(key(id), next.slice(-MAX_CRUMBS), TTL_SECONDS);
	} catch {
		// Instrumentation, never a gate.
	}
}

/**
 * Read the crumbs recorded so far for a trace, oldest first. Returns an empty
 * array for an unknown or expired trace, which is what a caller polling ahead of
 * the first milestone sees and is indistinguishable from "not there yet".
 * @param {string|null} traceId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function readForgeProgress(traceId) {
	const id = normalizeTraceId(traceId);
	if (!id) return [];
	try {
		const crumbs = await cacheGetFresh(key(id));
		if (!Array.isArray(crumbs)) return [];
		return crumbs.filter((c) => c && STAGES.has(c.stage)).sort((a, b) => (a.at || 0) - (b.at || 0));
	} catch {
		return [];
	}
}
