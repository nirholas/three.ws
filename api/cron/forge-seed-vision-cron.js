// @ts-check
// GET /api/cron/forge-seed-vision-cron: per-minute cron that runs stage 2 of the
// catalog quality gate (render + Vertex judge) on seed assets that already
// passed the mesh gate, then publishes or quarantines them.
//
// Why a cron of its own. The seed cron (forge-seed-cron.js) has a hard 70 s
// wall and a history of 504s when a phase overruns, while one render plus two
// judge calls costs 10 to 20 s, so stage 2 never ran there in production and
// the catalog was gated on structure but not on appearance. With
// SEED_VISION_PHASE=1 the seed cron stops after the mesh gate and parks each
// keeper in `mesh_passed`; this cron gives the judge a wall of its own.
//
// Per tick:
//   1. Claim up to SEED_VISION_BATCH `mesh_passed` rows, oldest first. The claim
//      is one UPDATE over a FOR UPDATE SKIP LOCKED subselect that writes a lease
//      (vision_lease_until). The lease, not the row lock, is what keeps an
//      overlapping tick off a row: the serverless driver commits every statement
//      on its own, so the lock is gone the moment the claim returns.
//   2. Judge each claimed row in turn, each inside min(SEED_VISION_ASSET_MS, what
//      is left of the tick). A row the tick has no time left for gets its lease
//      back and waits for the next minute.
//   3. Route the verdict through api/_lib/seed-publish.js, the same publish/rig/
//      quarantine path the seed cron uses:
//        judged, accepted   → rig or publish (routeSeedKeeper)
//        judged, rejected   → forge/rejected/ + .reason.json sidecar, 'rejected'
//        judge unreachable  → retry next tick, counted in gate_attempts. Once
//                             GATE_MAX_ATTEMPTS are spent, or the row has waited
//                             past MESH_PASSED_MAX_WAIT_MS (30 min), it publishes
//                             on its mesh verdict marked vision_unavailable.
//        no renderable URL  → publish on the mesh verdict, vision_unavailable
//
// The judge being down never buries a mesh and is never counted as a quality
// reject: fail closed on mesh, fail soft on vision (docs/seed-quality.md).
//
// This cron drains `mesh_passed` whether or not SEED_VISION_PHASE is on, so
// switching the flag off mid-flight never strands rows that were already parked.
//
// ── Env knobs ────────────────────────────────────────────────────────────────
//   SEED_VISION_BATCH    rows claimed per tick (default 2). A row that the tick
//                        has no time left for is handed back, not started.
//   SEED_VISION_TICK_MS  wall-clock budget for the whole tick (default 50 000,
//                        under the 70 s function wall with room for the tail).
//   SEED_VISION_ASSET_MS ceiling for one asset's render + judge (default 40 000).
//                        Sized to the measured chain, not to the seed cron's
//                        inline SEED_CRON_VISION_MS (20 s): on 2026-11-04 the
//                        production render alone took 7 to 19 s and a full
//                        render + judge 14 to 39 s (scripts/gcp/seed-vision-
//                        measure.mjs), so 20 s would have turned most assets
//                        into retries. A slow first row leaves the second one
//                        deferred to the next minute, which the queue absorbs:
//                        the seed cron publishes single digits per hour.

import { json, method, wrapCron } from '../_lib/http.js';
import { sql } from '../_lib/db.js';
import { requireCron } from '../_lib/cron-auth.js';
import { env } from '../_lib/env.js';
import { evaluateSeedAsset, inProcessTransport } from '../_lib/seed-quality.js';
import {
	GATE_MAX_ATTEMPTS,
	MESH_PASSED_MAX_WAIT_MS,
	gateFaultOutcome,
	intEnv,
	loadGlbBytes,
	markVisionUnavailable,
	publishableGlbUrl,
	rejectSeedJob,
	routeSeedKeeper,
	withDeadline,
} from '../_lib/seed-publish.js';

const ORIGIN = () => env.APP_ORIGIN || 'https://three.ws';
const SOURCE = 'forge-seed-vision-cron';

export const visionBatchSize = () => intEnv('SEED_VISION_BATCH', 2, { min: 1, max: 6 });
const tickBudgetMs = () => intEnv('SEED_VISION_TICK_MS', 50_000, { min: 10_000, max: 60_000 });
export const visionAssetBudgetMs = () => intEnv('SEED_VISION_ASSET_MS', 40_000, { min: 10_000, max: 55_000 });
// A claim outlives the tick it belongs to, so a tick that dies mid-judge (an
// instance recycled, a hard kill at the wall) frees its rows a minute later
// instead of never.
const LEASE_SECONDS = 120;
// Below this much tick left, a row is handed back rather than started: the GLB
// read and the publish tail need room after the judge's own budget.
const MIN_ROW_MS = 8_000;
const ROW_TAIL_MS = 4_000;

/**
 * Lease up to `limit` mesh_passed rows nobody else holds, oldest first.
 * @param {number} limit
 */
async function claimRows(limit) {
	return sql`
		update forge_seed_jobs j
		set vision_lease_until = now() + make_interval(secs => ${LEASE_SECONDS})
		from (
			select id
			from forge_seed_jobs
			where status = 'mesh_passed'
			  and (vision_lease_until is null or vision_lease_until < now())
			order by mesh_passed_at asc nulls first
			for update skip locked
			limit ${limit}
		) c
		where j.id = c.id
		returning j.id, j.user_id, j.raw_client_id, j.prompt, j.model_category, j.creation_id,
		          j.glb_url, j.backend, j.gate, j.gate_attempts, j.mesh_passed_at, j.started_at
	`;
}

/**
 * Judge one claimed row and act on the verdict.
 * @param {{ origin: string, job: any, transport: any, budgetMs: number }} args
 */
async function judgeRow({ origin, job, transport, budgetMs }) {
	const startedAt = Date.now();
	const parkedAt = job.mesh_passed_at ? new Date(job.mesh_passed_at).getTime() : startedAt;
	const pastBound = startedAt - parkedAt > MESH_PASSED_MAX_WAIT_MS;
	const done = (result) => ({ ...result, ms: Date.now() - startedAt });

	let verdict = null;
	let glbKey = null;
	let fault = null;
	try {
		const glbUrl = await publishableGlbUrl(job);
		if (!glbUrl) {
			// Nothing to render, and nothing a retry would change: the mesh
			// verdict is all this asset will ever get.
			const meshOnly = markVisionUnavailable(job.gate, 'no public glb url to render');
			return done({ ...(await routeSeedKeeper({ origin, job, verdict: meshOnly, fromStatus: 'mesh_passed' })), vision: 'unavailable' });
		}
		const loaded = await loadGlbBytes({ creationId: job.creation_id, glbUrl: job.glb_url });
		glbKey = loaded.key;
		verdict = await evaluateSeedAsset({
			glbBuffer: loaded.buf,
			glbUrl,
			prompt: job.prompt,
			category: job.model_category,
			transport: withDeadline(transport, budgetMs),
		});
	} catch (err) {
		fault = String(err?.message || err);
	}

	// A verdict: either the judge answered, or the mesh failed on re-read (the
	// mesh gate is deterministic, so that only happens if the stored object
	// changed under the row, and a mesh that fails is never published).
	if (verdict && (verdict.vision?.status === 'judged' || !verdict.mesh?.pass)) {
		if (verdict.accepted) {
			return done({ ...(await routeSeedKeeper({ origin, job, verdict, fromStatus: 'mesh_passed' })), vision: 'judged' });
		}
		return done(await rejectSeedJob({ job, verdict, glbKey, source: SOURCE, fromStatus: 'mesh_passed' }));
	}

	// No verdict: the renderer, the judge, or the mesh read broke. That is
	// infrastructure, so it is retried, and only after the attempts are spent
	// (or the row has waited too long) does the keeper go out on its mesh verdict.
	const detail = (verdict?.vision?.error || fault || 'vision gate did not run').slice(0, 300);
	const { attempt, terminal } = gateFaultOutcome(job.gate_attempts);
	if (terminal || pastBound) {
		const meshOnly = markVisionUnavailable(verdict || job.gate, detail);
		const routed = await routeSeedKeeper({ origin, job, verdict: meshOnly, fromStatus: 'mesh_passed' });
		return done({ ...routed, vision: 'unavailable', attempt, error: detail.slice(0, 200) });
	}
	await sql`
		update forge_seed_jobs
		set gate_attempts = ${attempt},
		    error = ${`vision attempt ${attempt}/${GATE_MAX_ATTEMPTS}: ${detail}`.slice(0, 500)},
		    vision_lease_until = null
		where id = ${job.id}
		  and status = 'mesh_passed'
	`;
	return done({ job_id: job.id, status: 'vision_retry', attempt, error: detail.slice(0, 200) });
}

/**
 * One tick of the vision phase. Exported for tests; the transport defaults to
 * the in-process renderer plus Vertex.
 * @param {{ origin?: string, transport?: any, budgetMs?: number }} [opts]
 */
export async function advanceVision({ origin = ORIGIN(), transport = null, budgetMs = tickBudgetMs() } = {}) {
	const deadline = Date.now() + budgetMs;
	const rows = await claimRows(visionBatchSize());
	if (!rows.length) return [];

	const judge = transport || inProcessTransport();
	const results = [];
	const deferred = [];
	for (const job of rows) {
		const left = deadline - Date.now();
		if (left < MIN_ROW_MS) {
			deferred.push(job);
			continue;
		}
		try {
			results.push(await judgeRow({
				origin,
				job,
				transport: judge,
				budgetMs: Math.max(1_000, Math.min(visionAssetBudgetMs(), left - ROW_TAIL_MS)),
			}));
		} catch (err) {
			// A publish or quarantine write failed after the verdict. The lease
			// expires on its own, so the row is judged again on a later tick.
			results.push({ job_id: job.id, status: 'vision_error', error: String(err?.message || err).slice(0, 200) });
		}
	}

	if (deferred.length) {
		const ids = deferred.map((j) => j.id);
		await sql`
			update forge_seed_jobs
			set vision_lease_until = null
			where id = any(${ids}::uuid[])
			  and status = 'mesh_passed'
		`;
		for (const job of deferred) results.push({ job_id: job.id, status: 'deferred' });
	}
	return results;
}

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	const startedAt = Date.now();
	const results = await advanceVision();
	const count = (status) => results.filter((r) => r.status === status).length;

	return json(res, 200, {
		ok: true,
		claimed: results.length,
		published: count('published'),
		rigging: count('rigging'),
		rejected: count('rejected'),
		retries: count('vision_retry'),
		deferred: count('deferred'),
		vision_unavailable: results.filter((r) => r.vision === 'unavailable').length,
		duration_ms: Date.now() - startedAt,
		results,
	});
});
