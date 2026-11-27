// GET /api/cron/forge-finalize: server-side completion for forge generations.
//
// Historically a forge_creations row only flipped from 'generating' to
// 'done'/'failed' when the creator's browser polled GET /api/forge?job=… to
// completion (materializeCreation runs inside that poll). Close the tab and the
// generation is orphaned at 'generating' forever, even though the GPU worker
// finished and the GLB is sitting in GCS. This cron makes completion
// server-authoritative so users can leave the page mid-generation:
//
//   1. Sweep 'generating' rows older than GRACE (the browser poll path gets
//      first shot: most generations still finish attended).
//   2. Rows whose replicate_job_id is a GCP worker envelope (the async
//      self-host lanes: trellis_selfhost, hunyuan3d, sketch/triposg: exactly
//      the minutes-long lanes that get orphaned) are polled directly on the
//      worker. done → materializeCreation (same durable-copy writer the
//      browser poll uses, so gallery/showcase/streaks all light up
//      identically). failed → markFailed.
//   3. Anything still not terminal after HARD_TTL is marked failed as timed
//      out, so no row is ever stuck at 'generating' forever. Envelope rows are
//      still polled once first: recovering a finished model always beats
//      declaring it dead.
//   4. A creation finalized here completed UNATTENDED: the user wasn't
//      watching: so this is the one place completion notifications fire
//      (bell + push + email via api/_lib/forge-notify). The attended path
//      never notifies: the result is already on screen.
//
// Bounded and swarm-safe: one tick at a time (a Redis lock), at most
// BATCH_LIMIT rows, shared fairly across lanes so one sick lane cannot hold the
// batch, and no new row is started past SOFT_DEADLINE_MS. A row is re-read
// right before it is completed, so a job the creator's open tab already
// finished is never materialized or announced a second time.
//
// Auth: the shared, fail-closed cron gate (api/_lib/cron-auth.js), same as every
// other cron in /api/cron/.

import { sql } from '../_lib/db.js';
import { cors, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import {
	materializeCreation,
	markFailed,
	markSupersededBy,
	forgeStoreEnabled,
	createCreation,
} from '../_lib/forge-store.js';
import { notifyForgeComplete, notifyForgeFailed } from '../_lib/forge-notify.js';
import { createRegenProvider as createGcpProvider } from '../_providers/gcp.js';
import { createNvidiaProvider } from '../_providers/nvidia.js';
import { decodeJobToken, encodeJobToken } from '../_lib/forge-job-token.js';
import {
	pickRedispatchLane,
	submitFailoverJob,
	bindJobSuccessor,
	MAX_FAILOVER_HOPS,
} from '../_lib/forge-failover.js';
import { markLaneUnhealthy } from '../_lib/forge-lane-health.js';
import { markProviderCooldown } from '../_lib/provider-health.js';
import { resolveTier, BACKENDS } from '../_lib/forge-tiers.js';
import { acquireLock, releaseLock, cacheGet, cacheSet } from '../_lib/cache.js';
import { optionsForJob } from '../_lib/forge-job-options.js';
import { cacheKeyForJob, putCachedForgeResult } from '../_lib/forge-cache.js';
import { resolveStoredProviderKey } from '../_lib/forge-provider-key.js';
import { createRegenProvider as createReplicateProvider } from '../_providers/replicate.js';
import { BYOK_PROVIDER_FACTORIES } from '../_providers/byok-registry.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import { getRedis } from '../_lib/redis.js';
import { NIM_TRELLIS_COOLDOWN_KEY, nimCooldownSeconds } from '../forge.js';
import { mapPoolSettled } from '../_lib/pool.js';

export const maxDuration = 60;

const BATCH_LIMIT = Number(process.env.FORGE_FINALIZE_BATCH) || 25;
// Each row's status poll is an independent network round trip
// (api/_providers/gcp.js status() allows up to 15s x 2 attempts on its own), so
// sweeping BATCH_LIMIT rows one at a time can take minutes once a lane like
// trellis_selfhost is unhealthy and every poll on it runs its full timeout.
// That is exactly what blew the 60s cron budget on 2026-10-24 (see
// docs/ops/production-log-triage.md "HTTP timeout with no cron context"): rows
// are independent (keyed by their own replicate_job_id, no shared mutable
// state besides the stateless provider clients), so sweeping them concurrently
// bounds the tick's wall-clock time to the slowest row instead of the sum.
export const ROW_CONCURRENCY = Number(process.env.FORGE_FINALIZE_CONCURRENCY) || 8;
// Leave fresh rows to the attended browser poll path.
const GRACE_MINUTES = 2;
// The ceiling for a lane with no measured limit of its own (below).
const HARD_TTL_MINUTES = 45;
// Browser clients poll attended for up to 12 minutes (src/forge.js MAX_POLL_MS)
// and run their own poll-time lane failover. The cron defers acting on a failed
// self-host poll until that window has passed, so it can never race a live
// browser into a duplicate redispatch of the same generation.
const ATTENDED_POLL_BUDGET_MINUTES = 13;
// One tick at a time. Rows are independent, but two overlapping ticks would
// poll and complete the same rows twice. The lock outlives the 60 s budget so a
// tick that wrapCron cut off (Cloud Run withdraws CPU, the release never runs)
// still blocks the next minute's tick only until it expires.
const TICK_LOCK_KEY = 'forge-finalize:tick';
const TICK_LOCK_TTL_S = maxDuration + 5;
// No new row starts past this point of the tick. A row in flight keeps going;
// the rows not reached stay 'generating' and lead the next tick's batch.
const SOFT_DEADLINE_MS = 40_000;

// How long each lane may stay 'generating' before the reap declares it dead.
// Measured 2026-11-27 over 30 days of finished jobs (the table is in
// docs/forge-background-generation.md): each limit is the lane's slowest real
// finish plus room for a cold start, raised where a recovery step must still
// get its turn first.
//
// The GCP workers declare a lost task "orphaned" at 30 minutes, and that
// verdict is what lets this cron redispatch the job to another lane, so their
// limit sits 5 minutes past it (slowest finished pixal3d job: 16.4 min,
// triposg: 10.3, rerig: 17.0, a scale-from-zero L4 start included).
const WORKER_ORPHAN_MINUTES = 30;
// three-ws-api's Cloud Run request timeout is 900 s. A synchronous lane's row
// belongs to one request, so once that request is over the row can never finish.
const REQUEST_CEILING_MINUTES = 15;

function timeLimit(minutes, reason) {
	return Object.freeze({ minutes, reason });
}

const WORKER_LIMIT = timeLimit(
	WORKER_ORPHAN_MINUTES + 5,
	'the GPU worker sent no result inside the 35-minute limit',
);
const SYNC_LIMIT = timeLimit(
	REQUEST_CEILING_MINUTES + 5,
	'the request generating it ended before the model was saved',
);
// No finished job on these lanes in the last 30 days, so nothing to measure:
// they keep the ceiling they always had.
const KEYED_LIMIT = timeLimit(HARD_TTL_MINUTES, 'the provider sent no result inside the 45-minute limit');

export const DEFAULT_TIME_LIMIT = timeLimit(HARD_TTL_MINUTES, 'no result arrived inside the 45-minute limit');

export const LANE_TIME_LIMITS = Object.freeze({
	// Protected lane (docs/ops/forge-protected-lanes.md): its 45-minute ceiling
	// and its exact timed-out message are part of how its job is finalized, so
	// both stay as they were (an empty reason adds nothing to the message).
	trellis_selfhost: timeLimit(HARD_TTL_MINUTES, ''),
	...Object.fromEntries(
		Object.entries(BACKENDS)
			.filter(([id, b]) => b.provider === 'gcp' && id !== 'trellis_selfhost')
			.map(([id]) => [id, WORKER_LIMIT]),
	),
	// Reconstruct rows, and rerig rows, which carry no backend at all, only a
	// worker envelope (see laneKeyFor).
	gcp: WORKER_LIMIT,
	rig: WORKER_LIMIT,
	// The unattended resubmit fires at the 13-minute attended window and the
	// slowest finished NIM job took 14.7 minutes, so 13 + 15 + 7 of margin.
	nvidia: timeLimit(35, 'NVIDIA NIM sent no model inside the 35-minute limit, one automatic retry included'),
	huggingface: SYNC_LIMIT,
	stability: SYNC_LIMIT,
	trellis: KEYED_LIMIT,
	replicate_byok: KEYED_LIMIT,
	meshy: KEYED_LIMIT,
	tripo: KEYED_LIMIT,
	// Rodin's status call needs the per-job subscription key, which only the
	// submitting page holds, so nothing server-side can ever finish one.
	rodin: timeLimit(HARD_TTL_MINUTES, 'Rodin jobs can only finish while /forge stays open'),
});

// The lane a row belongs to for the limits above. Mirrored in SQL by the reap.
export function laneKeyFor(row) {
	if (row?.backend) return row.backend;
	return decodeWorkerEnvelope(row?.replicate_job_id) ? 'rig' : '';
}

export function laneTimeLimit(row) {
	return LANE_TIME_LIMITS[laneKeyFor(row)] || DEFAULT_TIME_LIMIT;
}
// Hop/attempted memory for cron-built failover chains, keyed by the successor's
// worker envelope. Same lifetime as the poll path's successor bindings.
const CRON_HOP_PREFIX = 'fr:cron-hop:';
const CRON_HOP_TTL_S = 2 * 3600;
// Mirrors the poll path's NVCF alias/resub keys (api/forge.js pollNvidiaStatus)
// so attended and unattended recovery share one once-per-job budget.
const NVCF_ALIAS_TTL_S = 3600;

// The async GCP worker lanes wrap their upstream task in a base64url JSON
// envelope ({ mode, taskId, baseUrl, resultKey }): see api/_providers/gcp.js.
// That shape is the reliable discriminator between "a worker we can poll" and
// an opaque third-party id (Replicate prediction, HF job) we cannot.
export function decodeWorkerEnvelope(replicateJobId) {
	try {
		const obj = JSON.parse(Buffer.from(String(replicateJobId), 'base64url').toString('utf8'));
		return obj?.taskId && obj?.baseUrl ? obj : null;
	} catch {
		return null;
	}
}

async function readCronHop(replicateJobId) {
	const r = getRedis();
	if (!r) return null;
	try {
		const raw = await r.get(`${CRON_HOP_PREFIX}${replicateJobId}`);
		const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
		return value && Number.isFinite(value.hop) ? value : null;
	} catch {
		return null;
	}
}

async function writeCronHop(replicateJobId, value) {
	const r = getRedis();
	if (!r) return;
	try {
		await r.set(`${CRON_HOP_PREFIX}${replicateJobId}`, JSON.stringify(value), { ex: CRON_HOP_TTL_S });
	} catch {
		// Best-effort: a lost hop record loosens the chain cap by one, nothing more.
	}
}

/**
 * Decide what this sweep may do with a self-host poll that came back FAILED.
 * Pure: no clock, no I/O, no Redis - the caller supplies the resolved facts.
 * Factored out (like decideSelfhostMissing in _lib/forge-selfhost-recovery.js)
 * because the swarm-safety rule here is subtle enough to deserve its own tests:
 * acting too early races a live browser into duplicate GPU work, and acting
 * never is what made the orphan class permanent.
 *
 * @returns {'defer'|'redispatch'|'terminal'}
 *   - defer: an attended client may still handle it; leave the row alone.
 *   - redispatch: resubmit to the next healthy lane.
 *   - terminal: nothing left to try; mark it failed and notify.
 */
export function decideFailedSweep({
	ageMinutes,
	hop = 0,
	hasReferenceImage = false,
	path = null,
	attendedBudgetMinutes = ATTENDED_POLL_BUDGET_MINUTES,
	maxHops = MAX_FAILOVER_HOPS,
} = {}) {
	// Inside the attended window a live browser runs its own poll-time failover.
	// Acting here would duplicate that GPU work on the same generation.
	if (Number.isFinite(ageMinutes) && ageMinutes < attendedBudgetMinutes) return 'defer';
	// A redispatch reconstructs from the stored reference view, so a job without
	// one has nothing to resubmit. Sketch keeps its single purpose-built lane
	// (reconstruct models do badly on drawings).
	if (!hasReferenceImage || path === 'sketch') return 'terminal';
	// Bounded chain, same cap as the attended path.
	if (hop >= maxHops) return 'terminal';
	return 'redispatch';
}

const NVCF_RESUB_INFLIGHT_TTL_S = 5 * 60;

// Written BEFORE the paid NVCF submission. A tick cut off mid-flight (Cloud Run
// withdraws CPU once wrapCron answers) leaves this marker as proof an attempt
// began, and a slow-but-alive attempt is never re-fired by a later tick.
async function markResubmitInflight(jobId) {
	await cacheSet(`nvcf:resub-inflight:${jobId}`, String(Date.now()), NVCF_RESUB_INFLIGHT_TTL_S);
}

// console.warn from this handler has never reached Cloud Logging, so a failed
// resubmit goes to the durable ops_alerts sink as well.
async function alertResubmitFailed(row, err) {
	await sendOpsAlert(
		'forge-finalize: NVCF resubmit failed',
		`creation ${row.id}: ${err?.message || err}`,
		{ signature: 'forge-finalize:nvcf-resubmit-failed', severity: 'warn' },
	).catch(() => {});
}

/**
 * NVIDIA NIM is the only text-to-3D lane (forge-failover.js excludes it from
 * redispatch: text-only, and a poll-time redispatch always reconstructs from a
 * stored reference image nvidia rows never have), so a stalled poll has no
 * alternate lane to fail over to. The only two defenses are: defer to the
 * attended browser poll while one may still be running, then give the job one
 * real resubmit before the hard TTL reaps it as dead.
 *
 * @returns {'defer'|'resubmit'|'terminal'}
 *   - defer: an attended client may still be polling, or this job already got
 *     its one resubmit; leave the row alone.
 *   - resubmit: past the attended window, before the hard TTL, not yet retried.
 *   - terminal: past the hard TTL; nothing left to try.
 */
export function decideNvidiaStall({
	ageMinutes,
	alreadyResubmitted = false,
	attendedBudgetMinutes = ATTENDED_POLL_BUDGET_MINUTES,
	hardTtlMinutes = HARD_TTL_MINUTES,
} = {}) {
	if (!Number.isFinite(ageMinutes) || ageMinutes < attendedBudgetMinutes) return 'defer';
	if (ageMinutes >= hardTtlMinutes) return 'terminal';
	if (alreadyResubmitted) return 'defer';
	return 'resubmit';
}

// Unattended twin of the poll handler's automatic lane failover (api/forge.js
// pollJob). The 30-minute worker orphan class lands here by construction: the
// worker only declares an orphan long after every browser has stopped polling,
// so the cron is the ONLY consumer of that failure, and before this it
// dead-ended the job permanently. The original inputs are still on the row;
// resubmit to the next healthy lane instead. The successor gets its own
// creation row (same client/user), so this same cron sweeps it to completion
// and the completion notification still fires for a model, not a failure.
//
// Returns `{ successorId }` when the request now continues on another lane (the
// caller links the two rows so the ledger shows a recovery, not a loss), or
// null when nothing was redispatched.
async function tryCronRedispatch(row, ageMinutes) {
	const prior = await readCronHop(row.replicate_job_id);
	const hop = prior ? prior.hop : 0;
	const decision = decideFailedSweep({
		ageMinutes,
		hop,
		hasReferenceImage: Boolean(row.preview_image_url),
		path: row.path,
	});
	if (decision !== 'redispatch') return null;
	const attempted = [...new Set([...(prior?.attempted || []), row.backend].filter(Boolean))];
	const nextLane = await pickRedispatchLane({ attempted });
	if (!nextLane) {
		// The one recoverable failure that stays lost, and it used to leave no
		// trace: every other outcome here logs, so a silent return read as "we
		// never tried". Measured on 2026-08-14: of the 14 self-host orphans in the
		// prior week, 13 failed over and the single loss came through this branch,
		// with nothing in the logs to say whether a lane was picked at all. A
		// declined failover is a capacity signal (every alternative lane already
		// attempted or cooled by markLaneUnhealthy), so say so.
		console.warn(
			`[forge-finalize] job failed on ${row.backend}; no redispatch lane available (attempted: ${attempted.join(', ') || 'none'}), leaving it terminal`,
		);
		return null;
	}
	try {
		const submitted = await submitFailoverJob({
			backend: nextLane,
			imageUrl: row.preview_image_url,
			prompt: row.prompt,
			tierId: row.tier,
			path: row.path,
		});
		// The redispatch reconstructs from the primary stored view, so a
		// multi-view original degrades visibly (views_used: 1), never silently:
		// the same provenance contract as the attended failover.
		const successorId = await createCreation({
			clientKey: row.client_key,
			userId: row.user_id ?? null,
			prompt: row.prompt,
			previewImageUrl: row.preview_image_url,
			replicateJobId: submitted.extJobId,
			viewsRequested: 1,
			viewsUsed: 1,
			multiview: false,
			backend: nextLane,
			tier: row.tier,
			path: row.path,
			destination: row.destination,
			internal: row.internal === true,
			visibility: row.visibility ?? null,
		});
		await writeCronHop(submitted.extJobId, { hop: hop + 1, attempted });
		// A late attended poller still holds the original f1 handle. Job tokens
		// are deterministic (HMAC over the same payload), so re-encoding the
		// envelope reconstructs the exact string that client polls, so bind the
		// successor chain on it so resolveLiveJob chases to the live job.
		await bindJobSuccessor(
			encodeJobToken({ provider: 'gcp', kind: null, taskId: row.replicate_job_id }),
			{ handle: submitted.handle, backend: nextLane, hop: hop + 1, attempted },
		);
		console.warn(
			`[forge-finalize] job failed on ${row.backend}; unattended auto-failover #${hop + 1} → ${nextLane}`,
		);
		return { successorId: successorId ?? null };
	} catch (err) {
		console.warn(`[forge-finalize] redispatch failed: ${err?.message || err}`);
		return null;
	}
}

// Poll-free, BATCH_LIMIT-free hard-TTL reap: a single bulk UPDATE that flips
// every row already past HARD_TTL_MINUTES to 'failed', no matter how old or
// which backend/path it belongs to. This runs ahead of (and independently of)
// the oldest-created_at-first, BATCH_LIMIT-bounded live-poll query below, so a
// batch monopolized by one unhealthy backend (trellis_selfhost owning every
// slot because its rows are the oldest) can never block a different, never-
// selected lane's rows from ever being reaped: exactly the bug measured
// 2026-10-25 in prompts/finish/436: 192 `rerig` rows sat 'generating' forever
// because they never won a batch slot against older trellis_selfhost rows.
// Message/column shape matches forge-store.js's markFailed exactly (error,
// completed_at, updated_at) so no downstream matcher (forge-error-report.mjs's
// `error ilike '%timed out%'`) sees a different error string.
//
// Each row is held to its own lane's limit (LANE_TIME_LIMITS), passed in as
// parallel arrays so the table above stays the single source; the SQL lane key
// mirrors laneKeyFor. The message keeps its 'generation timed out after N
// minutes' prefix for those matchers and appends the lane's reason.
export async function reapExpiredRows() {
	const lanes = Object.keys(LANE_TIME_LIMITS);
	const minutes = lanes.map((lane) => LANE_TIME_LIMITS[lane].minutes);
	const reasons = lanes.map((lane) => LANE_TIME_LIMITS[lane].reason);
	const floor = Math.min(DEFAULT_TIME_LIMIT.minutes, ...minutes);
	const rows = await sql`
		with lanes as (
			select * from unnest(${lanes}::text[], ${minutes}::int[], ${reasons}::text[]) as l(lane, minutes, reason)
		), due as (
			select fc.id,
				coalesce(l.minutes, ${DEFAULT_TIME_LIMIT.minutes}) as minutes,
				coalesce(l.reason, ${DEFAULT_TIME_LIMIT.reason}) as reason
			from forge_creations fc
			left join lanes l on l.lane = case
				when fc.backend is not null then fc.backend
				when fc.replicate_job_id like 'eyJ%' then 'rig'
				else '' end
			where fc.status = 'generating'
				and fc.replicate_job_id is not null
				and fc.created_at < now() - (${floor} * interval '1 minute')
		)
		update forge_creations fc
		set status = 'failed',
			error = 'generation timed out after ' || round(extract(epoch from (now() - fc.created_at)) / 60) || ' minutes'
				|| case when due.reason = '' then '' else ': ' || due.reason end,
			completed_at = coalesce(fc.completed_at, now()),
			updated_at = now()
		from due
		where fc.id = due.id
			and fc.status = 'generating'
			and fc.created_at < now() - (due.minutes * interval '1 minute')
		returning fc.id, fc.user_id, fc.prompt, fc.backend, fc.tier, fc.path, fc.error
	`;
	for (const row of rows) {
		if (row.backend === 'nvidia') {
			// Reaping the bare TTL on nvidia is itself a cron-observed failure of
			// the lane: cool the submit-time breaker so new free-text requests
			// skip straight to the paid/image-intermediate path instead of landing
			// on the same dead end for another HARD_TTL_MINUTES.
			await markProviderCooldown(NIM_TRELLIS_COOLDOWN_KEY, nimCooldownSeconds()).catch(() => {});
		}
		if (row.user_id) {
			notifyForgeFailed({
				userId: row.user_id,
				creationId: row.id,
				prompt: row.prompt,
				error: row.error || 'generation timed out',
				backend: row.backend,
				tier: row.tier,
			});
		}
	}
	return rows.length;
}

// The handle the creator's browser polled for this row. Submit-time choices
// (compression, PBR, LODs, bbox) and the result-cache binding are keyed by it
// (_lib/forge-job-options.js, _lib/forge-cache.js), and tokens are an HMAC over
// the same payload, so re-encoding reproduces the exact string. null when the
// lane bound nothing to a handle (synchronous rows finish inside their request).
export function jobHandleFor(row) {
	const id = row?.replicate_job_id;
	if (!id) return null;
	if (decodeWorkerEnvelope(id)) return encodeJobToken({ provider: 'gcp', kind: null, taskId: id });
	if (decodeJobToken(id)) return id;
	if (row.backend === 'nvidia' && UUID_RE.test(id)) {
		return encodeJobToken({ provider: 'nvidia', kind: 'text-to-3d', taskId: id });
	}
	if (row.backend === 'trellis') return id;
	return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readRowStatus(id) {
	try {
		const [row] = await sql`select status from forge_creations where id = ${id}`;
		return row?.status ?? null;
	} catch {
		return null;
	}
}

/**
 * Complete a finished job exactly as the creator's own poll would have
 * (api/forge.js pollJob): the same writer, the options they chose at submit,
 * quality scoring, the worker's own timings for the lane stats, the result
 * cache, and then the one unattended notification.
 *
 * The row is re-read first. An open tab may have finished it while this tick's
 * poll was in flight, and completing it again would repeat every side effect
 * and announce a model the creator is already looking at.
 *
 * @returns {Promise<{ outcome: 'done'|'settled'|'retry', durable?: object }>}
 *   settled: someone else already finished or failed it; retry: the durable
 *   copy did not land (storage blip), so the next tick tries again.
 */
export async function completeRow(row, { glbUrl, workerStats = null, handle = jobHandleFor(row) } = {}) {
	const current = await readRowStatus(row.id);
	if (current && current !== 'generating') return { outcome: 'settled' };
	const bound = handle ? await optionsForJob(handle).catch(() => null) : null;
	const durable = await materializeCreation({
		replicateJobId: row.replicate_job_id,
		clientKey: row.client_key,
		glbUrl,
		quality: true,
		compress: bound?.compression || null,
		derivePbr: bound?.derivePbr !== false,
		bbox: bound?.bbox ?? null,
		lods: bound?.lods === true,
		workerStats: workerStats ?? null,
	});
	if (!durable) return { outcome: 'retry' };
	const cacheKey = handle ? await cacheKeyForJob(handle).catch(() => null) : null;
	if (cacheKey && durable.glbUrl) {
		await putCachedForgeResult(cacheKey, {
			glb_url: durable.glbUrl,
			backend: row.backend || null,
			tier: row.tier || null,
			path: row.path || null,
			quality: durable.quality || null,
		}).catch(() => {});
	}
	if (row.user_id) {
		notifyForgeComplete({
			userId: row.user_id,
			creationId: durable.id,
			prompt: row.prompt,
			previewImageUrl: durable.previewImageUrl ?? row.preview_image_url ?? null,
		});
	}
	return { outcome: 'done', durable };
}

// Fold a completeRow outcome into a row's counters.
function countCompletion(out, result) {
	if (result.outcome === 'done') out.done++;
	else if (result.outcome === 'settled') out.already_final++;
	else out.still_running++;
	return out;
}

// Meshy's poll endpoint differs by task kind and the row does not keep the
// kind, so both are tried, the likelier first (only an image job stores the
// photo it reconstructs from, api/forge.js). Tripo polls one endpoint. Rodin's
// poll key is a per-job subscription key that only the submitting page held,
// and Stability answers synchronously, so neither has anything to poll.
export function byokKindsFor(provider, row) {
	if (provider === 'meshy') return row.preview_image_url ? ['image-to-3d', 'text-to-3d'] : ['text-to-3d', 'image-to-3d'];
	if (provider === 'tripo') return ['task'];
	return [];
}

/**
 * How to poll a third-party or key-bound lane unattended: the Replicate-hosted
 * TRELLIS lane on the platform token, and Replicate, Meshy and Tripo jobs on
 * the creator's saved key (or Tripo's house key). A key typed into the page for
 * one request is never stored, so such a job can only finish while the page is
 * open, and this returns null for it, as it does for an unconfigured lane.
 *
 * @returns {Promise<null | { poll: () => Promise<object>, handle: string }>}
 */
export async function thirdPartyPoller(row, { replicate = null, makeReplicate, byokFactories = {}, keyFor } = {}) {
	const taskId = row.replicate_job_id;
	if (row.backend === 'trellis') {
		return replicate ? { poll: () => replicate.status(taskId), handle: taskId } : null;
	}
	const provider = BACKENDS[row.backend]?.byok;
	if (!provider || !keyFor) return null;
	const kinds = byokKindsFor(provider, row);
	if (provider !== 'replicate' && (!kinds.length || !byokFactories[provider])) return null;
	const key = await keyFor({ userId: row.user_id ?? null, provider }).catch(() => null);
	if (!key) return null;
	if (provider === 'replicate') {
		const rep = makeReplicate(key);
		return {
			poll: () => rep.status(taskId),
			handle: encodeJobToken({ provider: 'replicate_byok', kind: null, taskId }),
		};
	}
	const adapter = byokFactories[provider](key);
	const poller = {
		handle: encodeJobToken({ provider, kind: kinds[0], taskId }),
		// The first kind that knows the task wins, and its token becomes the
		// handle (submit-time options were bound to exactly that token). A kind
		// that throws is a wrong endpoint or a blip; only when every kind fails
		// is the job reported failed.
		async poll() {
			let failed = null;
			for (const kind of kinds) {
				const status = await adapter.status({ kind, taskId }).catch(() => null);
				if (status && status.status !== 'failed') {
					poller.handle = encodeJobToken({ provider, kind, taskId });
					return status;
				}
				if (status) failed ??= status;
			}
			return failed;
		},
	};
	return poller;
}

// The live-poll batch. Oldest first within each lane, but lanes take turns
// (every lane's oldest row before any lane's second), so a sick lane with a
// deep backlog cannot hold every slot while another lane's finished jobs wait.
async function selectBatch() {
	return sql`
		select id, replicate_job_id, client_key, user_id, prompt, preview_image_url,
			backend, tier, path, created_at, destination, internal, visibility
		from (
			select id, replicate_job_id, client_key, user_id, prompt, preview_image_url,
				backend, tier, path, created_at, destination, internal, visibility,
				row_number() over (partition by coalesce(backend, '') order by created_at) as lane_rank
			from forge_creations
			where status = 'generating'
				and replicate_job_id is not null
				and created_at < now() - (${GRACE_MINUTES} * interval '1 minute')
		) q
		order by lane_rank, created_at
		limit ${BATCH_LIMIT}
	`;
}

function emptyCounters() {
	return {
		done: 0,
		failed: 0,
		failed_over: 0,
		resubmitted: 0,
		timed_out: 0,
		still_running: 0,
		unpollable: 0,
		already_final: 0,
		deferred: 0,
	};
}

/**
 * One finalizer tick: reap, select, sweep. Bounded three ways so a bad minute
 * never becomes a bad hour: one tick at a time (TICK_LOCK_KEY), at most
 * BATCH_LIMIT rows shared fairly across lanes, and no new row started past
 * SOFT_DEADLINE_MS. A row that throws is counted and the rest carry on.
 */
export async function runFinalizeTick({ gcp = null, nvidia = null, thirdParty = null, now = Date.now } = {}) {
	const t0 = now();
	if (!(await acquireLock(TICK_LOCK_KEY, TICK_LOCK_TTL_S))) {
		return { enabled: true, skipped: 'overlap', elapsed_ms: now() - t0 };
	}
	try {
		const reaped = await reapExpiredRows();
		const rows = await selectBatch();
		const results = await mapPoolSettled(rows, ROW_CONCURRENCY, (row) =>
			now() - t0 > SOFT_DEADLINE_MS ? { deferred: 1 } : sweepRow(row, { gcp, nvidia, thirdParty }),
		);
		const out = { ...emptyCounters(), timed_out: reaped };
		for (const result of results) {
			if (result.ok) {
				for (const key of Object.keys(out)) out[key] += result.value[key] || 0;
			} else {
				console.warn(`[forge-finalize] row sweep threw: ${result.error?.message || result.error}`);
				out.unpollable++;
			}
		}
		return { enabled: true, reaped, swept: rows.length, ...out, elapsed_ms: now() - t0 };
	} finally {
		await releaseLock(TICK_LOCK_KEY).catch(() => {});
	}
}

export default wrapCron(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	if (!forgeStoreEnabled()) {
		return json(res, 200, { enabled: false, swept: 0 });
	}

	let gcp = null;
	try {
		gcp = createGcpProvider();
	} catch {
		// No GCP_RECONSTRUCTION_KEY on this deployment: envelope rows can't be
		// polled here; the lane time limit still reaps them.
	}
	let nvidia = null;
	try {
		nvidia = createNvidiaProvider();
	} catch {
		// NIM unconfigured: forge-token rows can't be polled here; the reap still ends them.
	}
	let replicate = null;
	try {
		replicate = createReplicateProvider();
	} catch {
		// No platform Replicate token: Replicate-hosted TRELLIS rows wait for the reap.
	}
	const thirdParty = {
		replicate,
		makeReplicate: (apiToken) => createReplicateProvider({ apiToken }),
		byokFactories: BYOK_PROVIDER_FACTORIES,
		keyFor: resolveStoredProviderKey,
	};

	return json(res, 200, await runFinalizeTick({ gcp, nvidia, thirdParty }));
}, { maxDurationMs: maxDuration * 1000 });

// One row's worth of the sweep above, factored out so it can run concurrently
// across the batch (mapPoolSettled in the caller) instead of blocking the next
// row on this row's network round trips. Returns the per-row delta to merge
// into the tick's aggregate counters; never throws (mapPoolSettled would catch
// it anyway, but a thrown row loses its counters, so every awaited call here
// already carries its own `.catch`).
export async function sweepRow(row, { gcp, nvidia, thirdParty = null }) {
	const out = emptyCounters();
	const ageMinutes = (Date.now() - Date.parse(row.created_at)) / 60_000;
	const envelope = decodeWorkerEnvelope(row.replicate_job_id);

	if (envelope && gcp) {
		const status = await gcp.status(row.replicate_job_id).catch(() => null);

		if (status?.status === 'done' && status.resultGlbUrl) {
			// A failed copy-to-durable (transient storage/network) leaves the row
			// for the next tick rather than failing a finished model.
			return countCompletion(
				out,
				await completeRow(row, { glbUrl: status.resultGlbUrl, workerStats: status.workerStats }),
			);
		}

		if (status?.status === 'failed') {
			// Inside the attended window a live browser may poll this failure
			// seconds from now and run its own failover; acting here would race
			// it into duplicate GPU work. Leave the row: an attended client
			// resolves it, and an abandoned one ages into the branch below.
			if (decideFailedSweep({ ageMinutes, hasReferenceImage: true }) === 'defer') {
				out.still_running++;
				return out;
			}
			if (row.backend) await markLaneUnhealthy(row.backend).catch(() => {});
			const redispatched = await tryCronRedispatch(row, ageMinutes);
			if (redispatched) {
				await markFailed({
					replicateJobId: row.replicate_job_id,
					clientKey: row.client_key,
					error: status.error || 'generation failed',
				});
				// Link the attempt to its successor so the ledger reads as a
				// recovery: without it the health sensor and the error report both
				// count this row as a user-visible loss, when the request is in
				// fact still running on another lane.
				if (redispatched.successorId) {
					await markSupersededBy({
						replicateJobId: row.replicate_job_id,
						clientKey: row.client_key,
						successorId: redispatched.successorId,
					});
				}
				out.failed_over++;
				// No failure notification: the successor row carries the job on,
				// and its completion (or terminal failure) notifies instead.
				return out;
			}
			await markFailed({
				replicateJobId: row.replicate_job_id,
				clientKey: row.client_key,
				error: status.error || 'generation failed',
			});
			out.failed++;
			if (row.user_id) {
				notifyForgeFailed({ userId: row.user_id, creationId: row.id, prompt: row.prompt, error: status.error, backend: row.backend, tier: row.tier });
			}
			return out;
		}

		// queued / running / poll blip: fall through to the TTL check.
	} else if (!envelope) {
		// The paid x402 lane stores the FULL signed forge token (provider +
		// upstream task id) so unattended agent purchases can be completed
		// server-side here, so an agent that got its poll_url answer and moved on
		// still ends with a finished gallery row, not a TTL orphan.
		const forgeToken = decodeJobToken(row.replicate_job_id);
		if (forgeToken?.provider === 'nvidia' && forgeToken.taskId && nvidia) {
			const status = await nvidia
				.status({ kind: forgeToken.kind, taskId: forgeToken.taskId })
				.catch(() => null);
			if (status?.status === 'done' && status.resultGlbUrl) {
				return countCompletion(
					out,
					await completeRow(row, { glbUrl: status.resultGlbUrl, workerStats: status.workerStats }),
				);
			}
			if (status?.status === 'failed') {
				await markFailed({
					replicateJobId: row.replicate_job_id,
					clientKey: row.client_key,
					error: status.error || 'generation failed',
				});
				out.failed++;
				return out;
			}
			// queued / running / poll blip: fall through to the TTL check.
		} else if (row.backend === 'nvidia' && nvidia) {
			// Browser/free-lane NIM rows store the BARE NVCF request id (only the
			// x402 lane stores the signed token), so they used to be unpollable
			// here and died at the hard TTL as "generation timed out" even when
			// the GPU had finished. Poll the bare id directly, chasing the alias
			// an attended expiry recovery may have written first.
			const alias = await cacheGet(`nvcf:alias:${row.replicate_job_id}`).catch(() => null);
			const taskId = typeof alias === 'string' && alias ? alias : row.replicate_job_id;
			const status = await nvidia.status({ taskId }).catch(() => null);
			if (status?.status === 'done' && status.resultGlbUrl) {
				return countCompletion(
					out,
					await completeRow(row, { glbUrl: status.resultGlbUrl, workerStats: status.workerStats }),
				);
			}
			if ((!status || status.status === 'running' || status.status === 'queued') && row.prompt) {
				// Still running/queued, or the poll itself errored (status null): no
				// alternate lane exists for text-only nvidia, so give the job one real
				// resubmit before the hard TTL reaps it as dead. A distinct lock from
				// nvcf:resub: below means this can never double-fire with the
				// nvcf_expired recovery.
				const stallDecision = decideNvidiaStall({
					ageMinutes,
					hardTtlMinutes: LANE_TIME_LIMITS.nvidia.minutes,
					alreadyResubmitted: Boolean(
						await cacheGet(`nvcf:stall-resub:${row.replicate_job_id}`).catch(() => null),
					),
				});
				if (
					stallDecision === 'resubmit' &&
					!(await cacheGet(`nvcf:resub-inflight:${row.replicate_job_id}`).catch(() => null)) &&
					(await acquireLock(`nvcf:stall-lock:${row.replicate_job_id}`, NVCF_ALIAS_TTL_S))
				) {
					try {
						await markResubmitInflight(row.replicate_job_id);
						const resub = await nvidia.textTo3d({ prompt: row.prompt, tier: resolveTier(row.tier) });
						await cacheSet(`nvcf:stall-resub:${row.replicate_job_id}`, '1', NVCF_ALIAS_TTL_S);
						if (resub.taskId) {
							await cacheSet(`nvcf:alias:${row.replicate_job_id}`, resub.taskId, NVCF_ALIAS_TTL_S);
							console.warn(
								`[forge-finalize] NVCF request stalled; resubmitted unattended job (creation ${row.id})`,
							);
							out.resubmitted++;
							return out;
						}
						if (resub.resultGlbUrl) {
							const completed = await completeRow(row, { glbUrl: resub.resultGlbUrl });
							if (completed.outcome !== 'retry') return countCompletion(out, completed);
						}
					} catch (err) {
						console.warn(`[forge-finalize] NVCF stall resubmit failed: ${err?.message || err}`);
						await alertResubmitFailed(row, err);
					}
				}
			}
			if (status?.code === 'nvcf_expired' && row.prompt) {
				// The request id is dead but the inputs live on the row: the same
				// never-dead-end recovery the attended poll runs, sharing its
				// once-per-job resub lock so the two paths can't double-submit.
				// The alias keeps the row's handle stable; the next tick polls the
				// resubmitted task and materializes onto this same row.
				if (
					!(await cacheGet(`nvcf:resub-inflight:${row.replicate_job_id}`).catch(() => null)) &&
					(await acquireLock(`nvcf:resub:${row.replicate_job_id}`, NVCF_ALIAS_TTL_S))
				) {
					try {
						await markResubmitInflight(row.replicate_job_id);
						const resub = await nvidia.textTo3d({ prompt: row.prompt, tier: resolveTier(row.tier) });
						if (resub.taskId) {
							await cacheSet(`nvcf:alias:${row.replicate_job_id}`, resub.taskId, NVCF_ALIAS_TTL_S);
							console.warn(
								`[forge-finalize] NVCF request expired; resubmitted unattended job (creation ${row.id})`,
							);
							out.resubmitted++;
							return out;
						}
						if (resub.resultGlbUrl) {
							const completed = await completeRow(row, { glbUrl: resub.resultGlbUrl });
							if (completed.outcome !== 'retry') return countCompletion(out, completed);
						}
					} catch (err) {
						console.warn(`[forge-finalize] NVCF resubmit failed: ${err?.message || err}`);
						await alertResubmitFailed(row, err);
					}
				}
				// Lock held by a prior recovery or the resubmit failed: the lane is
				// cron-observed broken with no alternate text-to-3D lane to send new
				// submissions to, so cool the same breaker forge.js's submit path
				// reads before every new free-text request. Fall through to the TTL
				// check so a second expiry fails honestly, not instantly.
				await markProviderCooldown(NIM_TRELLIS_COOLDOWN_KEY, nimCooldownSeconds()).catch(() => {});
			} else if (status?.status === 'failed') {
				await markFailed({
					replicateJobId: row.replicate_job_id,
					clientKey: row.client_key,
					error: status.error || 'generation failed',
				});
				out.failed++;
				if (row.user_id) {
					notifyForgeFailed({ userId: row.user_id, creationId: row.id, prompt: row.prompt, error: status.error, backend: row.backend, tier: row.tier });
				}
				return out;
			}
			// queued / running / poll blip: fall through to the TTL check.
		} else {
			const poller = thirdParty ? await thirdPartyPoller(row, thirdParty).catch(() => null) : null;
			if (!poller) {
				out.unpollable++;
				return out;
			}
			return sweepThirdParty(row, poller, ageMinutes, out);
		}
	}

	// reapExpiredRows runs a poll-free, BATCH_LIMIT-free sweep ahead of the
	// live-poll batch (runFinalizeTick), so any row that reaches this point is,
	// by construction, still inside its lane's time limit: there is no second
	// TTL branch to duplicate here. Whatever lane it is, it is still running.
	out.still_running++;
	return out;
}

// A third-party or key-bound lane's row (thirdPartyPoller). Done completes it
// like any other lane; a failure inside the attended window is left to the
// open page, as for the worker lanes; after it the row is failed and the
// creator told why.
async function sweepThirdParty(row, poller, ageMinutes, out) {
	const status = await poller.poll().catch(() => null);
	if (status?.status === 'done' && status.resultGlbUrl) {
		return countCompletion(
			out,
			await completeRow(row, {
				glbUrl: status.resultGlbUrl,
				workerStats: status.workerStats,
				handle: poller.handle,
			}),
		);
	}
	if (status?.status === 'failed' && !(ageMinutes < ATTENDED_POLL_BUDGET_MINUTES)) {
		await markFailed({
			replicateJobId: row.replicate_job_id,
			clientKey: row.client_key,
			error: status.error || 'generation failed',
		});
		out.failed++;
		if (row.user_id) {
			notifyForgeFailed({ userId: row.user_id, creationId: row.id, prompt: row.prompt, error: status.error, backend: row.backend, tier: row.tier });
		}
		return out;
	}
	out.still_running++;
	return out;
}
