// @ts-check
// GET /api/cron/forge-seed-cron — per-minute cron that grows the forge gallery
// with real AI-generated 3D avatars and accessories, each attributed to a fresh
// user account with an OG single-word username.
//
// Every invocation does two things in parallel and returns immediately — it
// never waits for a generation to finish, keeping execution well under 60 s:
//
//   1. Advance: move every open seed job one step along the pipeline. No step
//      ever blocks on the next, so a tick stays short no matter how slow a lane
//      is. The states, in order:
//
//        pending   → poll /api/forge; a finished mesh becomes `generated`
//        generated → run the catalog quality gate (api/_lib/seed-quality.js).
//                    A reject is quarantined under forge/rejected/ and never
//                    published; a keeper either goes to `rigging` or straight
//                    to publish. With SEED_VISION_PHASE=1 the gate here is the
//                    mesh stage only and a keeper is parked in `mesh_passed`.
//        mesh_passed → judged on appearance by api/cron/forge-seed-vision-cron.js,
//                    which publishes, rigs or quarantines it through the same
//                    path (api/_lib/seed-publish.js). This cron only sweeps rows
//                    that waited past the 30 minute bound: they publish on the
//                    mesh verdict, marked vision_unavailable.
//        rigging    → poll the auto-rig job; publish the rigged mesh when it
//                    lands, and publish the static keeper if the rig failed
//                    (a gated keeper is never thrown away over a rig fault).
//        done / rejected / failed / gate_error are terminal. A gate that could
//        not RUN is not a verdict: the row stays in `generated` and later ticks
//        retry it, reaching gate_error only after GATE_MAX_ATTEMPTS.
//
//   2. Start: pick the next unused prompt(s) from the library, claim an OG
//      username for a new user, submit a draft-tier forge job under that user's
//      client id, record the job so the next tick can poll it.
//
// Lane: the submit names no backend, so /api/forge's own free-first resolver
// picks it: which, with FORGE_SELFHOST_PRIMARY=1, is our own Cloud Run GPU
// fleet ahead of the hosted NVIDIA NIM allocation. Whichever lane runs, the
// backend is recorded on the job row and asserted free: a seed job must never
// silently spend on a paid third-party lane (see assertFreeBackend).
// maxPending() caps in-flight jobs so a slow lane never builds debt.
//
// ── Env knobs (every one defaults to the historical behaviour) ───────────────
//   SEED_CRON_BATCH        jobs to start per tick (default 1). Paced two at a
//                          time: submitting a whole batch at once is how the
//                          garment-forge runs used to silently drop jobs.
//   SEED_CRON_MAX_PENDING  in-flight ceiling (default 3 × batch).
//   SEED_VISION_PHASE      '1' moves the render + Vertex judge stage of the
//                          quality gate to forge-seed-vision-cron, which has a
//                          wall of its own. Off by default: unset, this cron
//                          publishes on its own verdict exactly as before, so a
//                          rollback is one env var.
//   SEED_CRON_VISION       '1' runs the judge stage inline in THIS cron instead
//                          (ignored while SEED_VISION_PHASE is on). Off: the
//                          function has a hard 70 s wall (vercel.json) and a
//                          history of 504s when a phase overruns, while a render
//                          plus two judge calls costs 10-20 s. The mesh stage of
//                          the gate always runs — it is deterministic, local, and
//                          costs only the GLB fetch. The bulk runner
//                          (scripts/gcp/seed-avatars.mjs) runs both.
//   SEED_CRON_VISION_MS    budget for the vision stage (default 20 000 ms).
//   SEED_CRON_GATE         jobs to gate per tick (default 2). Each costs one GLB
//                          fetch plus a mesh parse, so the ceiling keeps the
//                          tick inside its wall when a burst finishes at once.
//   SEED_CRON_RIG          routes accepted avatars through the auto-rigger before
//                          publishing, so catalog entries arrive animation-ready
//                          instead of driven by the retarget fallback. ON by
//                          default since 2026-09-09; set it to '0' to publish
//                          static meshes again. Only meshes a humanoid rig can
//                          drive are sent (riggableShape); a rig fault, or a rig
//                          that stops answering (RIG_STALL_MS), publishes the
//                          gated keeper static rather than losing it.

import { json, method, wrapCron } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { sql } from '../_lib/db.js';
import { SEED_PROMPTS, OG_USERNAMES, composeSeedPrompt } from '../_lib/seed-prompts.js';
import { evaluateSeedAsset, inProcessTransport } from '../_lib/seed-quality.js';
import {
	GATE_MAX_ATTEMPTS,
	MESH_PASSED_MAX_WAIT_MS,
	boolEnv,
	fetchJson,
	gateFaultOutcome,
	intEnv,
	loadGlbBytes,
	markVisionUnavailable,
	publishSeedAvatar,
	rejectSeedJob,
	rigStageEnabled,
	riggableShape,
	routeSeedKeeper,
	visionGateBudgetMs,
	visionPhaseEnabled,
	withDeadline,
} from '../_lib/seed-publish.js';
import { isFreeBackend } from '../_lib/forge-tiers.js';
import { circuitState, circuitRecordFailure, circuitRecordSuccess } from '../_lib/forge-scale.js';
import { randomUUID } from 'node:crypto';
import { requireCron } from '../_lib/cron-auth.js';

const ORIGIN = () => env.APP_ORIGIN || 'https://three.ws';
const MIN_JOB_AGE_SECONDS = 20;

// Jobs started per tick. 1 is the historical behaviour, so an unset env is a
// no-op. Capped at 12: beyond that a single tick's DB tail stops fitting in the
// 70 s wall even with the submits paced.
export const seedBatchSize = () => intEnv('SEED_CRON_BATCH', 1, { min: 1, max: 12 });
// In-flight ceiling. Scales with the batch so a bigger batch isn't instantly
// throttled by a ceiling tuned for a batch of one.
export const maxPending = () => intEnv('SEED_CRON_MAX_PENDING', seedBatchSize() * 3, { min: 1, max: 200 });
// Two at a time: a whole batch fired at once is how bulk generation runs lose
// jobs (garment-forge incident) — the lane accepts the submits and drops work.
const SUBMIT_CONCURRENCY = 2;

// Inline stage 2, the pre-vision-phase knob. Ignored while SEED_VISION_PHASE is
// on: the vision cron owns stage 2 then, and this cron never judges inline.
const visionGateEnabled = () => boolEnv('SEED_CRON_VISION');

// A rig job that never answers must not hold a row forever. advanceRigs polls
// the ten oldest 'rigging' rows per tick, so a permanently stuck row would sit
// at the front of that queue and starve the ones behind it. Past this age the
// keeper is published static, which is what a reported rig failure already
// does. Measured against started_at (the whole job, generation included)
// because the rig submit has no timestamp column of its own.
const RIG_STALL_MS = 45 * 60 * 1000;
// The same guard for the generation itself. A job the lane lost keeps answering
// queued or running (or a poll keeps failing on transport), and every pending
// row counts against maxPending(), so one such row shrinks seeding capacity for
// good and, at SEED_CRON_MAX_PENDING=1, stops it outright: a hunyuan3d job sat
// 'pending' from 2026-09-17 to 2026-10-09 that way. The forge client gives a
// running job 12 minutes and does not count queue time, so an hour is generous.
const GENERATION_STALL_MS = 60 * 60 * 1000;
// Gates per tick. Each one fetches the finished GLB and parses its glTF chunk;
// two keeps the phase in the low seconds even when a burst lands together.
const gateBatchSize = () => intEnv('SEED_CRON_GATE', 2, { min: 1, max: 10 });

// Circuit breaker — state is shared across instances via Redis (forge-scale.js) so
// every cron lambda sees the same open/closed decision; without that, each instance
// would rediscover a provider outage on its own and keep submitting into a dead
// lane. When CIRCUIT_THRESHOLD consecutive forge submits fail the circuit opens for
// (failures × CIRCUIT_BASE_MS), capped by forge-scale's CIRCUIT_MAX_OPEN_MS, so the
// cron goes quiet during a provider outage but still re-probes the lane at least
// once an hour instead of backing off into silence for the rest of the day.
const CIRCUIT_NAME = 'forge-seed';
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_BASE_MS = 10 * 60_000; // 10 min × consecutive failures
const noteCircuitFailure = () =>
	circuitRecordFailure(CIRCUIT_NAME, { threshold: CIRCUIT_THRESHOLD, baseMs: CIRCUIT_BASE_MS });

// The publish, rig and quarantine path lives in api/_lib/seed-publish.js, shared
// with the vision cron. Re-exported so callers of this module keep one import.
export { publishSeedAvatar, rigStageEnabled, riggableShape, gateFaultOutcome };

// ── Quality gate ──────────────────────────────────────────────────────────────

// Run the catalog gate on a finished generation. Returns the verdict plus the
// storage key, so a reject can be quarantined without re-reading the row.
// Stage 2 runs inline only in the legacy mode (SEED_CRON_VISION=1 with the
// vision phase off); otherwise this is the mesh stage alone.
async function gateCreation({ creationId, glbUrl, prompt, category }) {
	const { buf, key } = await loadGlbBytes({ creationId, glbUrl });
	const inline = visionGateEnabled() && !visionPhaseEnabled();
	const transport = inline ? withDeadline(inProcessTransport(), visionGateBudgetMs()) : null;
	const verdict = await evaluateSeedAsset({
		glbBuffer: buf,
		glbUrl: glbUrl || null,
		prompt,
		category,
		transport,
	});
	return { verdict, glbKey: key };
}

// Seed generations must never leave the free lanes: this cron runs unattended
// every minute, so one silent fallthrough to a paid third-party engine bills the
// platform continuously with nobody watching. A paid lane is recorded on the row
// and reported, and the asset is still published (the spend already happened,
// throwing the mesh away would waste it twice), but the reason string makes the
// fallthrough visible in the tick's response and in the accept-rate report.
function assertFreeBackend(backend) {
	if (!backend) return null;
	return isFreeBackend(backend) ? null : `paid_lane:${backend}`;
}

// ── Phase 1a: poll in-flight generations ─────────────────────────────────────
//
// A finished generation becomes 'generated', not 'done': the mesh exists but has
// not faced the catalog gate yet. Publishing happens only after advanceGates().
export async function pollPending(origin) {
	const rows = await sql`
		select id, user_id, raw_client_id, job_id, prompt, model_category, started_at
		from forge_seed_jobs
		where status = 'pending'
		  and started_at < now() - (${MIN_JOB_AGE_SECONDS} || ' seconds')::interval
		order by started_at asc
		limit 10
	`;
	if (!rows.length) return [];

	const results = [];
	const stalled = (job) => Date.now() - new Date(job.started_at).getTime() > GENERATION_STALL_MS;
	const expire = async (job, lastStatus) => {
		const error = `generation stalled past ${Math.round(GENERATION_STALL_MS / 60000)}m (last poll: ${lastStatus})`;
		await sql`
			update forge_seed_jobs
			set status = 'failed', error = ${error}, finished_at = now()
			where id = ${job.id} and status = 'pending'
		`;
		results.push({ job_id: job.job_id, status: 'failed', error, prompt: job.prompt });
	};
	await Promise.all(rows.map(async (job) => {
		try {
			const cronSecret = process.env.CRON_SECRET || env.CRON_SECRET || '';
			const poll = await fetchJson(
				`${origin}/api/forge?job=${encodeURIComponent(job.job_id)}`,
				{ headers: { 'x-forge-client': job.raw_client_id, 'x-forge-seed': cronSecret } },
			);

			if (poll.body?.status === 'done' && poll.body.glb_url) {
				const creationId = poll.body.creation_id ?? null;
				const backend = poll.body.backend || null;
				await sql`
					update forge_seed_jobs
					set status = 'generated',
					    creation_id = ${creationId},
					    glb_url = ${poll.body.glb_url},
					    backend = ${backend}
					where id = ${job.id}
				`;
				results.push({
					job_id: job.job_id,
					status: 'generated',
					backend,
					prompt: job.prompt,
					...(assertFreeBackend(backend) ? { warning: assertFreeBackend(backend) } : {}),
				});

			} else if (poll.body?.status === 'failed') {
				await sql`
					update forge_seed_jobs
					set status = 'failed',
					    error = ${(poll.body.error || 'generation failed').slice(0, 500)},
					    finished_at = now()
					where id = ${job.id}
				`;
				results.push({ job_id: job.job_id, status: 'failed', prompt: job.prompt });
			} else if (stalled(job)) {
				await expire(job, poll.body?.status || `HTTP ${poll.status ?? 'unknown'}`);
			} else {
				results.push({ job_id: job.job_id, status: poll.body?.status || 'running' });
			}
		} catch (err) {
			if (stalled(job)) {
				await expire(job, `poll error: ${err?.message || 'unknown'}`).catch((e) =>
					results.push({ job_id: job.job_id, status: 'poll_error', error: e?.message }),
				);
				return;
			}
			results.push({ job_id: job.job_id, status: 'poll_error', error: err?.message });
		}
	}));

	return results;
}

// ── Phase 1b: gate finished generations, then publish or quarantine ──────────

export async function advanceGates(origin) {
	const rows = await sql`
		select id, user_id, raw_client_id, prompt, model_category, creation_id, glb_url, backend,
		       gate_attempts
		from forge_seed_jobs
		where status = 'generated'
		order by started_at asc
		limit ${gateBatchSize()}
	`;
	if (!rows.length) return [];

	const twoPhase = visionPhaseEnabled();
	const results = [];
	for (const job of rows) {
		try {
			const { verdict, glbKey } = await gateCreation({
				creationId: job.creation_id,
				glbUrl: job.glb_url,
				prompt: job.prompt,
				category: job.model_category,
			});

			if (!verdict.accepted) {
				results.push(await rejectSeedJob({
					job,
					verdict,
					glbKey,
					source: 'forge-seed-cron',
					fromStatus: 'generated',
				}));
				continue;
			}

			// A mesh keeper. Under the vision phase it waits in 'mesh_passed' for
			// forge-seed-vision-cron to judge its appearance; gate_attempts restarts
			// there because the vision phase counts its own faults.
			if (twoPhase) {
				const [parked] = await sql`
					update forge_seed_jobs
					set status = 'mesh_passed',
					    gate = ${JSON.stringify(verdict)}::jsonb,
					    mesh_passed_at = now(),
					    gate_attempts = 0,
					    vision_lease_until = null
					where id = ${job.id}
					  and status = 'generated'
					returning id
				`;
				results.push({ job_id: job.id, status: parked ? 'mesh_passed' : 'already_advanced', prompt: job.prompt });
				continue;
			}

			results.push(await routeSeedKeeper({ origin, job, verdict, fromStatus: 'generated' }));

		} catch (err) {
			// The gate itself broke (storage read, renderer, judge transport). That is
			// infrastructure, not a quality verdict, so it is never counted against the
			// accept rate. Because it is infrastructure, it is also usually transient.
			// Leave the row in 'generated' so the next tick re-gates it, and only park
			// it in the terminal state once it has burned its attempts.
			const { attempt, terminal } = gateFaultOutcome(job.gate_attempts);
			const detail = String(err?.message || err);
			if (!terminal) {
				await sql`
					update forge_seed_jobs
					set gate_attempts = ${attempt},
					    error = ${`gate attempt ${attempt}/${GATE_MAX_ATTEMPTS}: ${detail}`.slice(0, 500)}
					where id = ${job.id}
				`;
				results.push({
					job_id: job.id,
					status: 'gate_retry',
					attempt,
					error: detail.slice(0, 200),
				});
				continue;
			}
			await sql`
				update forge_seed_jobs
				set status = 'gate_error',
				    gate_attempts = ${attempt},
				    error = ${detail.slice(0, 500)},
				    finished_at = now()
				where id = ${job.id}
			`;
			results.push({ job_id: job.id, status: 'gate_error', attempt, error: detail.slice(0, 200) });
		}
	}
	return results;
}

// ── Phase 1b': the vision phase's failsafe ───────────────────────────────────
//
// A keeper waits in 'mesh_passed' for forge-seed-vision-cron. If that cron is
// not running at all (unscheduled, crashing on import, its route missing from a
// deploy), nothing it does can enforce the wait bound, so this cron does: a row
// parked past MESH_PASSED_MAX_WAIT_MS that no vision tick holds a lease on is
// published on its mesh verdict, marked vision_unavailable. Runs whatever the
// flag says, so turning SEED_VISION_PHASE off never strands parked rows either.
export async function sweepStaleMeshPassed(origin) {
	const cutoff = new Date(Date.now() - MESH_PASSED_MAX_WAIT_MS).toISOString();
	const rows = await sql`
		select id, user_id, raw_client_id, prompt, model_category, creation_id, glb_url, backend, gate
		from forge_seed_jobs
		where status = 'mesh_passed'
		  and mesh_passed_at < ${cutoff}
		  and (vision_lease_until is null or vision_lease_until < now())
		order by mesh_passed_at asc
		limit 5
	`;
	if (!rows.length) return [];

	const waited = `vision phase did not run within ${Math.round(MESH_PASSED_MAX_WAIT_MS / 60000)}m`;
	const results = [];
	for (const job of rows) {
		try {
			const verdict = markVisionUnavailable(job.gate, waited);
			const routed = await routeSeedKeeper({ origin, job, verdict, fromStatus: 'mesh_passed' });
			results.push({ ...routed, vision: 'unavailable' });
		} catch (err) {
			results.push({ job_id: job.id, status: 'sweep_error', error: String(err?.message || err).slice(0, 200) });
		}
	}
	return results;
}

// ── Phase 1c: rig stage ──────────────────────────────────────────────────────

async function advanceRigs(origin) {
	const rows = await sql`
		select id, user_id, raw_client_id, prompt, model_category, creation_id, glb_url,
		       rig_job_id, rig_creation_id, gate, started_at
		from forge_seed_jobs
		where status = 'rigging'
		order by started_at asc
		limit 10
	`;
	if (!rows.length) return [];

	const cronSecret = process.env.CRON_SECRET || env.CRON_SECRET || '';
	const results = [];
	await Promise.all(rows.map(async (job) => {
		try {
			const poll = await fetchJson(
				`${origin}/api/forge?job=${encodeURIComponent(job.rig_job_id)}`,
				{ headers: { 'x-forge-client': job.raw_client_id, 'x-forge-seed': cronSecret } },
			);

			if (poll.body?.status === 'done' && poll.body.glb_url) {
				const rigCreationId = poll.body.creation_id ?? job.rig_creation_id;
				const avatarId = await publishSeedAvatar({
					job,
					verdict: job.gate,
					rigged: true,
					rigCreationId,
				});
				results.push({
					job_id: job.id,
					status: avatarId ? 'published' : 'already_published',
					rigged: true,
					avatar_id: avatarId,
				});

			} else if (poll.body?.status === 'failed' || poll.status >= 400) {
				// The mesh already passed the gate. A rig fault must not cost the
				// catalog the asset: publish it static and say so on the row.
				const avatarId = await publishSeedAvatar({ job, verdict: job.gate, rigged: false });
				if (avatarId) {
					await sql`
						update forge_seed_jobs
						set error = ${('rig failed: ' + (poll.body?.error || poll.status)).slice(0, 500)}
						where id = ${job.id}
					`;
				}
				results.push({
					job_id: job.id,
					status: avatarId ? 'published' : 'already_published',
					rigged: false,
					avatar_id: avatarId,
				});
			} else if (Date.now() - new Date(job.started_at).getTime() > RIG_STALL_MS) {
				// Still working, far too long. Treated exactly like a reported rig
				// failure: the mesh already passed the gate, so it is published
				// static rather than held back for a rigger that is not answering.
				const avatarId = await publishSeedAvatar({ job, verdict: job.gate, rigged: false });
				if (avatarId) {
					await sql`
						update forge_seed_jobs
						set error = ${`rig stalled past ${Math.round(RIG_STALL_MS / 60000)}m, published static`}
						where id = ${job.id}
					`;
				}
				results.push({
					job_id: job.id,
					status: avatarId ? 'published' : 'already_published',
					rigged: false,
					stalled: true,
				});
			} else {
				results.push({ job_id: job.id, status: 'rigging' });
			}
		} catch (err) {
			results.push({ job_id: job.id, status: 'rig_poll_error', error: String(err?.message || err).slice(0, 200) });
		}
	}));
	return results;
}

// ── Phase 2: start new generations ───────────────────────────────────────────

// Start up to seedBatchSize() generations this tick, paced SUBMIT_CONCURRENCY at
// a time. A whole batch fired at once is how bulk generation runs lose work (the
// garment-forge incident): the lane accepts every submit and quietly drops the
// overflow. `claimed` carries the prompts already taken this tick so two lanes in
// the same batch never race onto the same prompt.
async function startBatch(origin) {
	const size = seedBatchSize();
	const claimed = new Set();
	const results = [];
	let stop = false;

	const worker = async () => {
		while (!stop && results.length < size) {
			const outcome = await startNextJob(origin, claimed);
			results.push(outcome);
			// A ceiling or an open circuit applies to the whole tick, not just this
			// submit: keep going and every sibling submit hits the same wall.
			if (outcome?.skipped) stop = true;
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(SUBMIT_CONCURRENCY, size) }, worker),
	);
	return results.slice(0, size);
}

async function startNextJob(origin, claimed = new Set()) {
	const [{ count }] = await sql`
		select count(*)::int as count from forge_seed_jobs where status = 'pending'
	`;
	if (count >= maxPending()) {
		return { skipped: true, reason: `${count} job${count === 1 ? '' : 's'} already pending` };
	}

	const circuit = await circuitState(CIRCUIT_NAME);
	if (circuit.open) {
		const minsLeft = Math.ceil((circuit.openUntil - Date.now()) / 60_000);
		return {
			skipped: true,
			reason: `circuit open for ${minsLeft}m more (${circuit.failures} consecutive failures)`,
		};
	}

	// Pick next prompt — avoid recently used ones so the full library cycles
	// before any prompt repeats.
	const recent = await sql`
		select prompt from forge_seed_jobs order by started_at desc limit ${SEED_PROMPTS.length}
	`;
	const usedSet = new Set(recent.map(r => r.prompt));
	const available = SEED_PROMPTS.filter(p => !usedSet.has(p.prompt) && !claimed.has(p.prompt));
	const fallback = SEED_PROMPTS.filter(p => !claimed.has(p.prompt));
	const pool = available.length > 0 ? available : (fallback.length > 0 ? fallback : SEED_PROMPTS);
	const chosen = pool[Math.floor(Math.random() * pool.length)];
	claimed.add(chosen.prompt);

	// Claim an OG username and mint the account that owns it.
	const baseWord = OG_USERNAMES[Math.floor(Math.random() * OG_USERNAMES.length)];
	const claim = await claimSeedUser(baseWord);
	if (!claim) {
		return { skipped: true, reason: `could not mint a seed account for "${baseWord}"; will retry next tick` };
	}
	const { user, username } = claim;

	const rawClientId = randomUUID();

	const cronSecret = process.env.CRON_SECRET || env.CRON_SECRET || '';
	const submit = await fetchJson(`${origin}/api/forge`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-forge-client': rawClientId,
			'x-forge-seed': cronSecret,
		},
		// composeSeedPrompt appends the rig-readiness framing (full body, arms clear
		// of the torso, neutral stance, plain background) the auto-rigger needs. The
		// library string is what gets STORED, so the "recently used" de-duplication
		// and the batch runner's checkpoint keys stay keyed on the bare prompt.
		//
		// A fresh seed per submit is load-bearing, not a nicety: /api/forge caches a
		// finished result under (path, tier, backend, prompt, seed), so once the
		// library wraps around, a repeated prompt with no seed would serve the cached
		// mesh and mint a SECOND catalog avatar pointing at the very same GLB. The
		// seed makes every wrap-around generation a genuinely new asset.
		body: JSON.stringify({
			prompt: composeSeedPrompt(chosen),
			tier: 'draft',
			path: 'image',
			seed: freshSeed(),
		}),
	});

	if (submit.timedOut) {
		await noteCircuitFailure();
		await sql`delete from users where id = ${user.id}`.catch(() => {});
		return { ok: false, reason: 'forge submit timed out, will retry next tick' };
	}

	if (submit.status !== 200) {
		await noteCircuitFailure();
		await sql`delete from users where id = ${user.id}`.catch(() => {});
		return {
			ok: false,
			reason: `forge submit ${submit.status}: ${submit.body?.error_description || submit.body?.error || 'no body'}`,
		};
	}

	const creationId = submit.body?.creation_id ?? null;

	const backend = submit.body?.backend || null;

	// Some lanes finish inline (the self-host TRELLIS worker when warm, the free
	// NVIDIA draft lane) and return the finished model in the submit response with
	// job_id:null, so there is nothing to poll. The mesh still has to face the
	// catalog gate before it is published, so the row lands as 'generated' and
	// next tick's gate phase decides: it is never published straight off a submit.
	if (submit.body?.status === 'done' && submit.body?.glb_url) {
		await circuitRecordSuccess(CIRCUIT_NAME);
		await sql`
			insert into forge_seed_jobs
				(user_id, raw_client_id, job_id, prompt, model_category,
				 status, creation_id, glb_url, backend)
			values (${user.id}, ${rawClientId}, ${submit.body.job_id || 'sync-' + (creationId || randomUUID())},
			        ${chosen.prompt}, ${chosen.category}, 'generated', ${creationId}, ${submit.body.glb_url}, ${backend})
		`;
		return {
			ok: true,
			sync: true,
			creation_id: creationId,
			glb_url: submit.body.glb_url,
			prompt: chosen.prompt,
			category: chosen.category,
			backend,
			username,
			user_id: user.id,
			...(assertFreeBackend(backend) ? { warning: assertFreeBackend(backend) } : {}),
		};
	}

	// Otherwise the lane is asynchronous — record the job so the next tick polls it.
	if (submit.body?.job_id) {
		await circuitRecordSuccess(CIRCUIT_NAME);
		await sql`
			insert into forge_seed_jobs (user_id, raw_client_id, job_id, prompt, model_category, backend)
			values (${user.id}, ${rawClientId}, ${submit.body.job_id}, ${chosen.prompt}, ${chosen.category}, ${backend})
		`;
		return {
			ok: true,
			job_id: submit.body.job_id,
			prompt: chosen.prompt,
			category: chosen.category,
			backend,
			username,
			user_id: user.id,
			...(assertFreeBackend(backend) ? { warning: assertFreeBackend(backend) } : {}),
		};
	}

	// Neither a finished model nor a poll token — a genuine failure.
	await noteCircuitFailure();
	await sql`delete from users where id = ${user.id}`.catch(() => {});
	return {
		ok: false,
		reason: `forge submit returned no job_id and status=${submit.body?.status || 'unknown'}`,
	};
}

// Mint the seed account for an OG word, letting the users unique index arbitrate
// the username. Returns { user: { id }, username } or null when every candidate
// collided.
//
// This used to read a bounded slice of the existing names (`limit 100`) and trust
// it as the complete picture. Once a word's numbered slots filled up, the slice
// hid the exhaustion and handed back a name that already existed; the insert's
// `on conflict do nothing` then returned no row and the tick skipped with "user
// insert conflict". By 2026-07-25 all 171 OG words were saturated (word plus
// word2..word99), so every tick skipped and seeding stopped dead for weeks while
// the cron kept answering 200 OK. The index is the only honest arbiter: propose
// candidates, INSERT, and move to the next one on a conflict.
const CLAIM_ATTEMPTS = 6;

/**
 * The usernames to try for `word`, best first, given the ones already taken.
 * Always returns CLAIM_ATTEMPTS names: a word whose numbered slots are all gone
 * falls through to random hex slots, which are unbounded, so a saturated word
 * can never come back empty and stall the tick.
 * @param {string} word
 * @param {Set<string>} taken
 * @returns {string[]}
 */
export function seedUsernameCandidates(word, taken) {
	const candidates = [];
	if (!taken.has(word)) candidates.push(word);
	for (let n = 2; n <= 99 && candidates.length < CLAIM_ATTEMPTS; n++) {
		if (!taken.has(`${word}${n}`)) candidates.push(`${word}${n}`);
	}
	while (candidates.length < CLAIM_ATTEMPTS) {
		candidates.push(`${word}_${randomUUID().slice(0, 4)}`);
	}
	return candidates;
}

async function claimSeedUser(word) {
	// Exactly the numbered candidate space (word, word2..word99), so the row set
	// is complete by construction and can never be truncated into a wrong answer.
	const existing = await sql`
		select username from users
		where username = ${word}
		   or username ~ ${`^${word}[0-9]{1,2}$`}
	`;
	const taken = new Set(existing.map((r) => r.username));

	for (const username of seedUsernameCandidates(word, taken)) {
		// Display name is the word, capitalised, so it reads like a real account.
		// Drop the collision suffixes (`_xxxx` hex fallback, numbered slot) first;
		// stripping digits alone turned "fog_1a2b" into "Fog_".
		const displayName = username
			.replace(/_[0-9a-f]{4}$/, '')
			.replace(/\d+$/, '')
			.replace(/\b\w/g, (c) => c.toUpperCase());
		const [user] = await sql`
			insert into users (email, display_name, username, plan, email_verified, service_account, created_at, updated_at)
			values (${`${username}@forge.three.ws`}, ${displayName}, ${username}, 'free', false, true, now(), now())
			on conflict do nothing
			returning id
		`;
		if (user?.id) return { user, username };
	}
	return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// A uniformly random uint32, the range every provider RNG accepts
// (api/_lib/forge-options.js SEED_MAX).
function freshSeed() {
	return Math.floor(Math.random() * 4_294_967_296);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	const origin = ORIGIN();
	// Every phase advances a different set of rows, so they are safe to run
	// together and the tick costs one phase's wall-clock, not five in series.
	//
	// Isolated per phase, not a bare Promise.all: each phase opens with its own
	// row query, and a fault there (a schema change mid-rollout, a pooler blip)
	// is outside the per-job try/catch, so under Promise.all one broken phase
	// rejected the whole tick. That took down the three healthy phases with it
	// and cost the minute entirely, including the start phase, which is the one
	// that keeps the gallery growing. A broken phase now reports itself and the
	// rest of the tick still runs.
	const [polled, gated, swept, rigged, started] = await Promise.all(
		[
			['poll', () => pollPending(origin)],
			['gate', () => advanceGates(origin)],
			['vision_sweep', () => sweepStaleMeshPassed(origin)],
			['rig', () => advanceRigs(origin)],
			['start', () => startBatch(origin)],
		].map(([name, run]) =>
			run().catch((err) => {
				const detail = String(err?.message || err);
				console.warn(`[forge-seed] ${name} phase failed: ${detail}`);
				return [{ phase: name, status: 'phase_error', error: detail.slice(0, 200) }];
			}),
		),
	);
	const phaseErrors = [...polled, ...gated, ...swept, ...rigged, ...started].filter((r) => r?.status === 'phase_error');

	const advanced = [...gated, ...swept, ...rigged];
	const published = advanced.filter(j => j.status === 'published').length;
	const rejected = advanced.filter(j => j.status === 'rejected').length;
	const failed = polled.filter(j => j.status === 'failed').length;
	// Surfaced as its own count so a lane that keeps blipping is visible in the
	// tick response, not just buried in gate_results.
	const gateRetries = gated.filter(j => j.status === 'gate_retry').length;

	return json(res, 200, {
		ok: phaseErrors.length === 0,
		polled: polled.length,
		published,
		rejected,
		failed,
		gate_retries: gateRetries,
		mesh_passed: gated.filter(j => j.status === 'mesh_passed').length,
		phase_errors: phaseErrors,
		accept_rate: await recentAcceptRate(),
		poll_results: polled,
		gate_results: gated,
		vision_sweep_results: swept,
		rig_results: rigged,
		new_jobs: started,
	});
});

// Rolling accept rate over the last 24 h of gated seed jobs. Published vs
// rejected only: a generation that never reached the gate (failed upstream) and
// a gate that could not run (gate_error) are infrastructure, not curation, and
// counting them would understate how good the prompts actually are.
async function recentAcceptRate() {
	try {
		const [row] = await sql`
			select
				count(*) filter (where status = 'done')::int      as accepted,
				count(*) filter (where status = 'rejected')::int  as rejected
			from forge_seed_jobs
			where started_at > now() - interval '24 hours'
			  and status in ('done', 'rejected')
		`;
		const total = (row?.accepted || 0) + (row?.rejected || 0);
		return {
			window: '24h',
			accepted: row?.accepted || 0,
			rejected: row?.rejected || 0,
			rate: total > 0 ? Number(((row.accepted / total) * 100).toFixed(1)) : null,
		};
	} catch {
		return null;
	}
}
