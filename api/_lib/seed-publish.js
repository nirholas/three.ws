// @ts-check
// The publish, rig and quarantine path for gated seed assets.
//
// Shared by the two crons that can decide a seed generation's fate:
//
//   api/cron/forge-seed-cron.js         mesh gate (always), and with
//                                       SEED_VISION_PHASE unset, publish
//   api/cron/forge-seed-vision-cron.js  vision gate, then publish or quarantine
//
// It lives in one module so a keeper is published, rigged, or rejected in
// exactly one way whichever cron reached the verdict. Every state transition is
// a compare-and-set on the row's current status, because the two crons and an
// overlapping tick of either can all hand the same row here.

import { env } from './env.js';
import { sql } from './db.js';
import { getObjectBuffer, publicUrl } from './r2.js';
import { quarantineReject } from './seed-quality.js';
import { fetchUpstream } from './upstream-fetch.js';
import { randomUUID } from 'node:crypto';

// ── Env knobs ────────────────────────────────────────────────────────────────

// Read per call (never at module load) so a Cloud Run env update takes effect on
// the next tick without a redeploy, and so tests can set them.
export function intEnv(name, fallback, { min = 1, max = 50 } = {}) {
	const raw = process.env[name];
	const n = raw == null || raw === '' ? NaN : Number(raw);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(n)));
}
export function boolEnv(name, fallback = false) {
	const raw = String(process.env[name] ?? '').trim().toLowerCase();
	if (!raw) return fallback;
	return raw === '1' || raw === 'true' || raw === 'yes';
}

// Two-phase gating. On: the seed cron runs the mesh gate only and parks every
// keeper in 'mesh_passed' for forge-seed-vision-cron to judge on appearance.
// Off (the default): the seed cron publishes on its own verdict, as it always
// has, so rolling the vision phase back is one env var.
export const visionPhaseEnabled = () => boolEnv('SEED_VISION_PHASE');

// Wall-clock budget for one asset's render plus two judge calls.
export const visionGateBudgetMs = () => intEnv('SEED_CRON_VISION_MS', 20_000, { min: 5_000, max: 45_000 });

// The longest a keeper waits in 'mesh_passed'. Past it the asset is published on
// its mesh verdict and marked vision_unavailable: a vision phase that is down
// or backlogged must never hold finished, gated meshes out of the catalog.
export const MESH_PASSED_MAX_WAIT_MS = 30 * 60 * 1000;

// On by default since 2026-09-09. A catalog avatar that cannot be skeleton
// driven is half an asset, and the audit that turned the default around found
// ZERO of 17,349 published seed avatars had ever been rigged. The lane was
// verified live the same day (a seeded mesh came back with a 52-joint
// mixamorig skeleton, which is exactly what src/glb-canonicalize.js maps), and
// every failure path here publishes the static keeper instead of losing it, so
// the worst case of leaving it on is the asset the old default always shipped.
// Set SEED_CRON_RIG=0 to go back to publishing static meshes.
export const rigStageEnabled = () => boolEnv('SEED_CRON_RIG', true);

/**
 * Can a humanoid skeleton drive this mesh at all?
 *
 * The gate asks whether an asset is worth publishing. This asks a different
 * question: whether binding a humanoid rig to it makes it better or worse. It
 * can make it much worse. A text-to-3D lane routinely returns a figure standing
 * on a wide base slab, and the auto-rigger skins the slab along with the
 * figure, so the first clip that moves the legs tears the slab across the
 * scene. Measured on the real thing: a seeded "sky pirate" mesh (1.99 x 0.69 x
 * 1.99) rigged cleanly by every structural measure (52-joint mixamorig
 * skeleton, unit inverse binds) and then shredded on screen the moment the idle
 * clip played, while the same mesh published static rendered correctly.
 *
 * `thinAxis` is the signal, and the gate already stores it: glTF is Y-up, so a
 * mesh whose THINNEST extent is Y is lying down or sitting in a slab, while an
 * upright figure is always thinnest front-to-back or side-to-side. Over a
 * 12-mesh sample of what the cron actually published, the ten proper humanoids
 * ran 1.47 to 2.63 in height over width and none was thin in Y; the two that
 * were (the pirate, a rearing horse statuette) are exactly the two that must
 * not be rigged. `planar` catches the other end, a mesh with no depth at all.
 *
 * A mesh that fails this is published static, which is what every seed avatar
 * before 2026-09-09 was anyway.
 *
 * @param {{ thinAxis?: string | null, planar?: boolean } | null | undefined} metrics
 */
export function riggableShape(metrics) {
	if (!metrics) return true; // no measurement is not evidence against rigging
	if (metrics.planar === true) return false;
	return metrics.thinAxis !== 'y';
}

// ── Gate retries ─────────────────────────────────────────────────────────────

// How many times a generation may fail a gate on infrastructure before it is
// given up on. A gate fault is a storage read, a renderer, or a judge transport
// blipping, and every one of those is transient far more often than not, so the
// first fault must not be fatal. Three keeps a genuinely ungateable mesh from
// occupying a gate slot indefinitely: it burns three ticks (three minutes) and
// then goes terminal.
export const GATE_MAX_ATTEMPTS = 3;

/**
 * What a gate fault means for the row, given how many gate attempts it has
 * already burned. Pure so the retry-vs-bury decision is testable without a
 * database: getting it wrong in either direction is expensive (never retrying
 * throws finished meshes away, never burying starves the gate batch).
 * @param {number | null | undefined} priorAttempts
 * @returns {{ attempt: number, terminal: boolean }}
 */
export function gateFaultOutcome(priorAttempts) {
	const attempt = Number(priorAttempts || 0) + 1;
	return { attempt, terminal: attempt >= GATE_MAX_ATTEMPTS };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

// Must be comfortably shorter than the function's maxDuration (70 s in vercel.json)
// so fetchJson's AbortSignal.timeout fires and is caught BEFORE the platform's hard
// kill fires its own DOMException[TimeoutError]. When the timeout fires, fetchJson
// returns { timedOut: true }; the seed cron's start phase treats that as a soft
// failure and rolls back the pending user so the next tick can retry cleanly.
//
// poll + submit run in parallel and each can hold a fetch for this long, with the
// per-job DB work (avatar insert, job upserts, user rollback) stacked on top inside
// the same 70 s window. At 48 s a worst-case fetch left too little headroom for that
// tail and the cron occasionally tipped past 70 s, a hard 504. The free NVIDIA
// draft lane returns inline in ~13-22 s, so 35 s still covers a healthy generation
// with wide margin while keeping the whole tick comfortably under the ceiling; a
// genuinely degraded lane simply rolls back and retries next minute.
const FETCH_TIMEOUT_MS = 35_000;

export async function fetchJson(url, options = {}) {
	let res;
	try {
		res = await fetch(url, {
			...options,
			headers: { 'user-agent': 'threews-forge-seed/1.0', ...options.headers },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (err) {
		// AbortSignal.timeout fires a DOMException[TimeoutError]; treat it as a soft
		// failure so the cron can clean up and return 200 instead of propagating a
		// 500. Other network errors (DNS, ECONNREFUSED) are real failures: rethrow.
		if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
			return { status: 0, body: null, timedOut: true };
		}
		throw err;
	}
	let body = null;
	try { body = await res.json(); } catch { /* non-JSON: status is enough */ }
	return { status: res.status, body };
}

// ── Reading the mesh ─────────────────────────────────────────────────────────

// Pull the finished mesh bytes. Prefer the bucket key (no egress, no redirect
// chain); fall back to the public URL for lanes that hand back an absolute URL.
export async function loadGlbBytes({ creationId, glbUrl }) {
	if (creationId) {
		const [row] = await sql`select glb_key from forge_creations where id = ${creationId} limit 1`;
		const key = row?.glb_key;
		if (key && !/^https?:\/\//i.test(key)) {
			return { buf: await getObjectBuffer(key), key };
		}
		// An absolute key is a lane's public URL, so it is read like one: bounded,
		// and rejected on a non-2xx. Unbounded and unchecked, a slow host stalled
		// the gate for the rest of the tick and an error page was handed to the GLB
		// parser as if it were mesh bytes.
		if (key) {
			const res = await fetchUpstream(key, {}, { name: 'lane:glb-read', timeoutMs: 30_000, attempts: 2 });
			return { buf: Buffer.from(await res.arrayBuffer()), key: null };
		}
	}
	if (!glbUrl) throw new Error('no glb key or url to gate');
	const res = await fetchUpstream(glbUrl, {}, { name: 'lane:glb-read', timeoutMs: 30_000, attempts: 2 });
	return { buf: Buffer.from(await res.arrayBuffer()), key: null };
}

// The renderer and the rigger fetch the mesh over HTTPS, so a bucket-relative
// glb_key has to be resolved to its CDN URL first. Lanes that already hand back
// an absolute URL pass straight through.
export async function publishableGlbUrl(job) {
	if (job.glb_url && /^https?:\/\//i.test(job.glb_url)) return job.glb_url;
	if (!job.creation_id) return null;
	const [row] = await sql`select glb_key from forge_creations where id = ${job.creation_id} limit 1`;
	const key = row?.glb_key;
	if (!key) return null;
	return /^https?:\/\//i.test(key) ? key : publicUrl(key);
}

// Wrap a transport so the whole vision stage shares one wall-clock budget. A
// cron's 70 s ceiling is hard; overrunning it costs a 504 and a lost tick, which
// is strictly worse than publishing on the mesh verdict alone.
export function withDeadline(transport, budgetMs) {
	const deadline = Date.now() + budgetMs;
	const guard = async (fn, args) => {
		const left = deadline - Date.now();
		if (left <= 0) throw new Error('vision gate budget exhausted');
		return Promise.race([
			fn(args),
			new Promise((_, reject) => setTimeout(() => reject(new Error('vision gate budget exhausted')), left).unref?.()),
		]);
	};
	return {
		name: `${transport.name}+deadline`,
		render: (a) => guard(transport.render.bind(transport), a),
		judgeRealism: (a) => guard(transport.judgeRealism.bind(transport), a),
		judgeRigReadiness: (a) => guard(transport.judgeRigReadiness.bind(transport), a),
	};
}

/**
 * The verdict a keeper is published on when its appearance could not be
 * judged: the mesh decision stands, and `vision.status` says why there is no
 * vision score. Never a quality reject, so the accept rate stays honest.
 * @param {any} verdict
 * @param {string} error
 */
export function markVisionUnavailable(verdict, error) {
	return {
		...(verdict || {}),
		accepted: true,
		reasons: verdict?.mesh?.reasons || [],
		vision: { status: 'unavailable', error: String(error).slice(0, 300) },
	};
}

// ── Publish ──────────────────────────────────────────────────────────────────

// Insert a public avatar row for a finished seed creation, attributed to the
// synthetic user. Reads the stored GLB straight from forge_creations and is
// idempotent (`on conflict do nothing`) so a re-poll never double-inserts.
// Bypasses plan quota: this is platform-seeded content, not a user upload.
//
// `creationId` is the row the mesh comes from. After the optional rig stage
// that is the rig creation, whose preview_key is null, so `previewCreationId`
// keeps pointing at the original generation's rendered preview.
//
// Returns the new avatars.id, or null when the creation row was not publishable
// (no glb_key / not done) and nothing was inserted.
async function insertSeedAvatar({
	userId,
	prompt,
	modelCategory,
	creationId,
	previewCreationId = null,
	gate = null,
	rigged = false,
}) {
	if (!creationId) return null;
	const previewId = previewCreationId || creationId;
	const meta = {
		forge_creation_id: creationId,
		prompt,
		seed: true,
		rigged,
		...(gate ? { quality_gate: gate } : {}),
	};
	const inserted = await sql`
		insert into avatars
			(owner_id, slug, name, description, storage_key, size_bytes,
			 content_type, source, source_meta, thumbnail_key, visibility, tags,
			 model_category, created_at, updated_at)
		select
			${userId},
			${toSlug(prompt)},
			${toTitle(prompt)},
			${'AI-generated ' + modelCategory + ', forged on three.ws'},
			fc.glb_key,
			coalesce(fc.size_bytes, 0),
			'model/gltf-binary',
			'forge',
			${JSON.stringify(meta)}::jsonb,
			-- The creation's preview image is already in the bucket with a correct
			-- Content-Type (it is what /forge's own gallery renders). Adopt it as the
			-- avatar's thumbnail for free, rather than leaving thumbnail_key NULL and
			-- making the backfill cron pay chromium to re-render the same model.
			-- Relative keys only: an absolute URL in thumbnail_key resolves against an
			-- origin where no object lives (see api/_lib/avatar-thumbs.js).
			(select case when p.preview_key !~ '^https?://' then p.preview_key end
			   from forge_creations p where p.id = ${previewId}),
			'public',
			array[${modelCategory}]::text[],
			${modelCategory},
			now(), now()
		from forge_creations fc
		where fc.id = ${creationId}
		  and fc.glb_key is not null
		  and fc.status = 'done'
		on conflict do nothing
		returning id
	`;
	return inserted[0]?.id || null;
}

/**
 * Publish a gated keeper and close the job out. Shared by the direct path, the
 * post-rig path and the vision phase, so the avatar row is written in exactly
 * one place.
 *
 * The close-out is a compare-and-set, and it runs BEFORE the avatar insert: the
 * phases select their rows by status with no lock held across statements, so
 * two ticks overlapping (a Cloud Scheduler retry, a manual run alongside the
 * schedule, the seed cron's stale sweep racing the vision cron) can both hand
 * the same row here. The avatar insert cannot dedupe on its own since every
 * call mints a fresh random slug, so the loser would publish a second public
 * avatar for one creation. Only the tick that wins the transition writes.
 *
 * `fromStatus` narrows the transition to rows still in that state, so a row a
 * concurrent tick already rejected is never flipped to published.
 *
 * Returns null when this tick lost, so the caller reports that instead of
 * claiming a publish it did not do.
 * @param {{ job: any, verdict: any, rigged: boolean, rigCreationId?: string | null, fromStatus?: string | null }} args
 */
export async function publishSeedAvatar({ job, verdict, rigged, rigCreationId = null, fromStatus = null }) {
	// The verdict is written on the keeper as well as on the reject. Only the
	// rejects used to carry one, which made the live accept rate unmeasurable
	// from this table (every accepted row looked like a row that was never
	// gated) and left nothing to tune a threshold against except the failures.
	const gateJson = verdict ? JSON.stringify(verdict) : null;
	const reasons = verdict?.reasons?.length ? verdict.reasons : null;
	const [won] = fromStatus
		? await sql`
			update forge_seed_jobs
			set status = 'done',
			    gate = ${gateJson}::jsonb,
			    gate_reasons = ${reasons}::text[],
			    vision_lease_until = null,
			    finished_at = now()
			where id = ${job.id}
			  and status = ${fromStatus}
			returning id
		`
		: await sql`
			update forge_seed_jobs
			set status = 'done',
			    gate = ${gateJson}::jsonb,
			    gate_reasons = ${reasons}::text[],
			    finished_at = now()
			where id = ${job.id}
			  and status <> 'done'
			returning id
		`;
	if (!won) return null;

	const avatarId = await insertSeedAvatar({
		userId: job.user_id,
		prompt: job.prompt,
		modelCategory: job.model_category,
		creationId: rigged && rigCreationId ? rigCreationId : job.creation_id,
		previewCreationId: job.creation_id,
		gate: gateSummary(verdict),
		rigged,
	});
	await sql`update forge_seed_jobs set avatar_id = ${avatarId} where id = ${job.id}`;
	return avatarId;
}

// The slice of the verdict worth carrying on the avatar row forever. The full
// object (every judge score, every render note) stays on forge_seed_jobs.gate,
// for the keepers as well as the rejects.
// source_meta is read on every avatar detail render, so it gets the summary.
function gateSummary(verdict) {
	if (!verdict) return null;
	return {
		version: verdict.gateVersion,
		accepted: verdict.accepted,
		mesh_flag: verdict.mesh?.flag ?? null,
		mesh_score: verdict.mesh?.score ?? null,
		vision: verdict.vision?.status ?? 'skipped',
		...(verdict.vision?.mean != null ? { vision_mean: verdict.vision.mean } : {}),
	};
}

// ── Rig ──────────────────────────────────────────────────────────────────────

// Submit the accepted mesh to the auto-rigger. Returns { jobId, creationId } on
// a successful submit, or { jobId: null } when no rig lane is live; the caller
// publishes the static keeper in that case rather than stalling it.
export async function startRigStage({ origin, job }) {
	const cronSecret = process.env.CRON_SECRET || env.CRON_SECRET || '';
	const glbUrl = await publishableGlbUrl(job);
	if (!glbUrl) return { jobId: null, reason: 'no public glb url' };

	const submit = await fetchJson(`${origin}/api/forge?action=rig`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-forge-client': job.raw_client_id,
			'x-forge-seed': cronSecret,
		},
		body: JSON.stringify({ glb_url: glbUrl }),
	});
	if (submit.status !== 200 || !submit.body?.job_id) {
		console.warn(`[forge-seed] rig submit ${submit.status}: ${submit.body?.error || 'no job id'}`);
		return { jobId: null, reason: `rig submit ${submit.status}` };
	}
	return { jobId: submit.body.job_id, creationId: submit.body.creation_id ?? null };
}

/**
 * Send an accepted keeper on: rig first when the stage is on, the mesh is not
 * already skinned, and its shape is one a humanoid rig can actually drive;
 * otherwise publish straight away. A rigger that will not take the submit
 * publishes the static keeper rather than stalling it.
 *
 * `fromStatus` is the state the caller found the row in, and every transition
 * is guarded on it.
 * @param {{ origin: string, job: any, verdict: any, fromStatus: string }} args
 */
export async function routeSeedKeeper({ origin, job, verdict, fromStatus }) {
	if (
		rigStageEnabled()
		&& !verdict?.mesh?.rigged
		&& job.model_category !== 'accessory'
		&& riggableShape(verdict?.mesh?.metrics)
	) {
		const rig = await startRigStage({ origin, job });
		if (rig.jobId) {
			const [moved] = await sql`
				update forge_seed_jobs
				set status = 'rigging',
				    gate = ${JSON.stringify(verdict)}::jsonb,
				    rig_job_id = ${rig.jobId},
				    rig_creation_id = ${rig.creationId},
				    vision_lease_until = null
				where id = ${job.id}
				  and status = ${fromStatus}
				returning id
			`;
			return { job_id: job.id, status: moved ? 'rigging' : 'already_advanced', prompt: job.prompt };
		}
	}

	const avatarId = await publishSeedAvatar({ job, verdict, rigged: false, fromStatus });
	return {
		job_id: job.id,
		status: avatarId ? 'published' : 'already_published',
		avatar_id: avatarId,
		prompt: job.prompt,
	};
}

/**
 * Quarantine a rejected asset under forge/rejected/ (the GLB plus a
 * `.reason.json` sidecar carrying the whole verdict) and close the row out as
 * rejected. The sidecar is written first: it is the tuning dataset, and a row
 * marked rejected with no sidecar is a reject nobody can learn from.
 * @param {{ job: any, verdict: any, glbKey: string | null, source: string, fromStatus: string }} args
 */
export async function rejectSeedJob({ job, verdict, glbKey, source, fromStatus }) {
	const quarantine = await quarantineReject({
		id: job.creation_id || job.id,
		glbKey,
		glbUrl: job.glb_url,
		prompt: job.prompt,
		category: job.model_category,
		verdict,
		extra: { source, backend: job.backend },
	});
	const [moved] = await sql`
		update forge_seed_jobs
		set status = 'rejected',
		    gate = ${JSON.stringify(verdict)}::jsonb,
		    gate_reasons = ${verdict.reasons}::text[],
		    error = ${verdict.reasons.join(',').slice(0, 500)},
		    vision_lease_until = null,
		    finished_at = now()
		where id = ${job.id}
		  and status = ${fromStatus}
		returning id
	`;
	return {
		job_id: job.id,
		status: moved ? 'rejected' : 'already_advanced',
		reasons: verdict.reasons,
		quarantined: quarantine.modelCopied,
		prompt: job.prompt,
	};
}

// ── Naming ───────────────────────────────────────────────────────────────────

function toSlug(prompt) {
	const base = prompt
		.toLowerCase()
		.replace(/^(a|an|the)\s+/i, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return `${base}-${randomUUID().slice(0, 6)}`;
}

function toTitle(prompt) {
	const trimmed = prompt.replace(/^(a|an|the)\s+/i, '');
	const firstComma = trimmed.indexOf(',');
	const base = firstComma > 0 ? trimmed.slice(0, firstComma) : trimmed;
	return base.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80);
}
