#!/usr/bin/env node
/**
 * Bulk text-to-motion seeding for the animation library.
 *
 * Generates one clip per entry in data/motion-prompts.json through the
 * self-hosted GPU lane (workers/model-text2motion behind POST /api/forge-motion),
 * puts every result through the deterministic quality gate
 * (api/_lib/motion-quality.js), stages the keepers, and publishes them to the
 * generated half of the library manifest.
 *
 * The run is resumable and idempotent. A checkpoint records the verdict for
 * every prompt id, so re-running picks up where the last run stopped and never
 * re-spends GPU time on a prompt that already produced a keeper. Rejects are
 * kept too, with the full metric set, because tuning the gate off real failures
 * is the only way the thresholds stay honest.
 *
 *   node scripts/gcp/seed-motion.mjs                       # whole library, resume
 *   node scripts/gcp/seed-motion.mjs --limit=12            # smoke batch
 *   node scripts/gcp/seed-motion.mjs --categories=idle,emote
 *   node scripts/gcp/seed-motion.mjs --concurrency=4
 *   node scripts/gcp/seed-motion.mjs --samples=4           # up to four takes per prompt
 *   node scripts/gcp/seed-motion.mjs --keep-per-prompt=2   # stop a prompt at two keepers
 *   node scripts/gcp/seed-motion.mjs --retry-rejects       # re-roll past rejects
 *   node scripts/gcp/seed-motion.mjs --publish             # upload + manifest
 *   node scripts/gcp/seed-motion.mjs --report              # checkpoint stats only
 *   node scripts/gcp/seed-motion.mjs --repair --publish    # fix the live library
 *   node scripts/gcp/seed-motion.mjs --list                # list the keepers for sale
 *   node scripts/gcp/seed-motion.mjs --regate --publish    # re-derive every clip, no GPU
 *
 * REPAIRING THE PUBLISHED SET. --repair reads every generated clip already live
 * in the library, converts it out of the generator's identity rest basis into the
 * library's (rebaseToCanonicalRest), removes the lane's constant root drift, and
 * re-gates the result. Survivors are staged exactly as a fresh generation would
 * be, so a following --publish rewrites the clips and the manifest together and
 * a clip that no longer passes simply stops being served. It costs no GPU time:
 * the motion is already generated, it was only ever written down wrong.
 *
 * SPEND SAFETY. Every job goes to the text2motion mode, whose only backend is
 * our own model-text2motion Cloud Run GPU service. Before a clip is accepted the
 * run decodes the provider's job envelope and asserts the work actually ran on
 * that service (assertSelfHostedLane). If a job ever comes back from a paid
 * third-party lane the batch aborts immediately rather than quietly billing a
 * few hundred generations to someone else's API.
 *
 * LISTING. --list bakes every published keeper onto the platform rig
 * (public/avatars/default.glb) as a GLB, uploads it under
 * animations/library/generated/glb/, and upserts one animation_clips row per
 * clip under the platform account, so the collection sells through
 * GET /api/marketplace/animations and the x402 animation-download route. A clip
 * that is no longer published is delisted. Price and the rotating free subset
 * follow api/_lib/generated-clip-market.js; --price=<USDC> overrides the price.
 * Needs the storage credentials below plus DATABASE_URL.
 *
 * PUBLISHING. --publish needs the R2 credentials the production API uses
 * (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET,
 * S3_PUBLIC_DOMAIN). Clips go to animations/library/generated/clips/ and the
 * generated manifest is rebuilt from the staged keepers. That manifest is a
 * different object from the Mixamo one on purpose: each publisher rebuilds its
 * own and would otherwise delete the other's catalog (see api/animations/library.js).
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gateMotionClip, explainMotionGate, MOTION_GATE_VERSION } from '../../api/_lib/motion-quality.js';
import {
	assertSelfHostedLane,
	closeLoopSeam,
	despikeFootFlicks,
	flattenRootDrift,
	gateMotionClip as gateRestBasis,
	lockRootToContacts,
	needsRebase,
	rebaseToCanonicalRest,
	toLibraryClip,
} from '../../api/_lib/motion-seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const m = a.match(/^--([^=]+)(?:=(.*))?$/);
		return m ? [m[1], m[2] ?? true] : [a, true];
	}),
);

const ORIGIN = String(args.origin || process.env.SEED_ORIGIN || 'https://three.ws').replace(/\/+$/, '');
const OUT_DIR = resolve(ROOT, String(args.out || 'animation-sources/.motion-clips'));
const CLIPS_DIR = join(OUT_DIR, 'clips');
const REJECTS_DIR = join(OUT_DIR, 'rejected');
const CHECKPOINT = join(OUT_DIR, 'checkpoint.json');
const PROMPTS_PATH = join(ROOT, 'data/motion-prompts.json');

const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(args.concurrency) || 3, 8));
const CATEGORIES = typeof args.categories === 'string' ? args.categories.split(',').map((s) => s.trim()) : null;
const RETRY_REJECTS = !!args['retry-rejects'];
const PUBLISH = !!args.publish;
const REPORT_ONLY = !!args.report;
const REPAIR = !!args.repair;
const LIST = !!args.list;
const REGATE = !!args.regate;
// Independent samples to draw per prompt. The sampler is stochastic, so the
// same prompt yields a different take every time; several takes per prompt is
// how a 137-prompt library grows into several hundred clips while the gate
// keeps only the takes that hold up.
const SAMPLES = Math.max(1, Math.min(Number(args.samples) || 1, 12));
// Stop drawing takes of a prompt once it has this many keepers. Past that the
// library gains near-duplicates of one prompt instead of range across prompts.
const KEEP_PER_PROMPT = Math.max(1, Number(args['keep-per-prompt']) || 3);
// Direct transport: call the text2motion worker through the platform's own GCP
// provider, with no public endpoint and so no per-IP rate limit in the way.
// Needs GCP_TEXT2MOTION_URL and GCP_RECONSTRUCTION_KEY (both on the three-ws-api
// Cloud Run service). --origin forces the public HTTP route instead.
const DIRECT = !args.origin && !!process.env.GCP_TEXT2MOTION_URL && !!process.env.GCP_RECONSTRUCTION_KEY;

const R2_PREFIX = 'animations/library/generated';
const CLIP_NAME_PREFIX = 'gen-';

// Poll budget per job. The lane answers a 4 s clip in 15-40 s warm and pays a
// cold start on the first job of an idle hour (the keepwarm cron only holds it
// open during peak), so the ceiling is generous and the interval is short
// enough that a warm lane is not left waiting on a sleep.
const POLL_INTERVAL_MS = 4_000;
const POLL_BUDGET_MS = 5 * 60_000;
const SUBMIT_TIMEOUT_MS = 30_000;
// How long a bulk run will sit out the endpoint's per-IP hourly ceiling before
// giving up and leaving the rest for the next resume. Default is one full window.
const MAX_WAIT_SECONDS = Number(args['max-wait']) || 3900;

function log(...parts) {
	console.log(...parts);
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function ensureDirs() {
	for (const d of [OUT_DIR, CLIPS_DIR, REJECTS_DIR]) mkdirSync(d, { recursive: true });
}

function loadCheckpoint() {
	if (!existsSync(CHECKPOINT)) return { version: MOTION_GATE_VERSION, prompts: {} };
	try {
		const parsed = JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
		return { version: parsed.version || MOTION_GATE_VERSION, prompts: parsed.prompts || {} };
	} catch {
		// A truncated checkpoint (killed mid-write) must not strand the catalog.
		// Losing it costs re-generation, not correctness, since every accepted
		// clip is also on disk and re-derived below.
		log('  checkpoint unreadable, starting a fresh one');
		return { version: MOTION_GATE_VERSION, prompts: {} };
	}
}

function saveCheckpoint(state) {
	writeFileSync(CHECKPOINT, JSON.stringify(state, null, 2));
}

function loadPrompts() {
	const data = JSON.parse(readFileSync(PROMPTS_PATH, 'utf8'));
	const defaults = data.defaults || {};
	const all = Array.isArray(data.prompts) ? data.prompts : [];
	return all.map((p) => ({
		...p,
		duration_seconds: Number(p.duration_seconds) || Number(defaults.duration_seconds) || 4,
		fps: Number(p.fps) || Number(defaults.fps) || 30,
	}));
}

class PaidLaneError extends Error {}

/**
 * Submit one generation, waiting out the endpoint's per-IP hourly ceiling when
 * it is hit. A bulk run is exactly the caller that ceiling exists to pace, so
 * the honest response to a 429 is to wait the window out, not to hammer it or
 * to record hundreds of fake failures. `--max-wait` caps how long the run is
 * willing to sit still; past that the prompt is left undecided for the next
 * resume.
 */
async function submitJob(prompt) {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${ORIGIN}/api/forge-motion`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				prompt: prompt.prompt,
				duration_seconds: prompt.duration_seconds,
				fps: prompt.fps,
			}),
			signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
		});
		const data = await res.json().catch(() => ({}));
		if (res.status === 429) {
			const retryAfter = Number(data.retry_after) || Number(res.headers.get('retry-after')) || 60;
			if (attempt > 0 || retryAfter > MAX_WAIT_SECONDS) {
				throw new Error(
					`rate limited for another ${retryAfter}s (--max-wait is ${MAX_WAIT_SECONDS}s); resume this run later`,
				);
			}
			log(`  wait   ${prompt.id.padEnd(28)} rate limited, sleeping ${retryAfter}s`);
			await sleep((retryAfter + 5) * 1000);
			continue;
		}
		if (res.status === 503) throw new Error(`text-to-motion is unconfigured on ${ORIGIN}: ${data.message || ''}`);
		if (!res.ok || !data.job_id) throw new Error(`submit ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
		return finishSubmit(data);
	}
}

let directProvider = null;
async function provider() {
	if (!directProvider) {
		const { createRegenProvider } = await import('../../api/_providers/gcp.js');
		directProvider = createRegenProvider();
	}
	return directProvider;
}

async function submitDirect(prompt) {
	const job = await (await provider()).submit({
		mode: 'text2motion',
		sourceUrl: null,
		params: { prompt: prompt.prompt, duration_seconds: prompt.duration_seconds, fps: prompt.fps },
	});
	return finishSubmit({ job_id: job.extJobId });
}

// The worker keeps task records in instance memory and the service scales past
// one instance with no session affinity, so a poll can land on the instance that
// never saw the task. That reads as a 404 and is transient: keep polling inside
// the budget rather than recording a failure the next poll would have cleared.
async function awaitClipDirect(jobId) {
	const deadline = Date.now() + POLL_BUDGET_MS;
	let lastError = '';
	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);
		const result = await (await provider()).status(jobId);
		if (result.status === 'done' && result.resultClipUrl) return result.resultClipUrl;
		if (result.status === 'failed') {
			if (result.code === 'gcp_task_missing') {
				lastError = result.error;
				continue;
			}
			throw new Error(`worker: ${result.error || 'failed with no error text'}`);
		}
	}
	throw new Error(`no clip after ${Math.round(POLL_BUDGET_MS / 1000)}s${lastError ? ` (${lastError})` : ''}`);
}

function finishSubmit(data) {
	// The strict assertion names the worker, not just the platform: a job must
	// have run on our own model-text2motion Cloud Run service.
	try {
		return { jobId: data.job_id, lane: assertSelfHostedLane(data.job_id).host };
	} catch (err) {
		throw new PaidLaneError(err.message);
	}
}

async function awaitClip(jobId) {
	const deadline = Date.now() + POLL_BUDGET_MS;
	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);
		const res = await fetch(`${ORIGIN}/api/forge-motion?job=${encodeURIComponent(jobId)}`, {
			signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(`poll ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
		if (data.error) throw new Error(`worker: ${data.error}`);
		if (data.clip_url) return data.clip_url;
		if (data.status === 'failed') throw new Error('worker reported failed with no error text');
	}
	throw new Error(`no clip after ${Math.round(POLL_BUDGET_MS / 1000)}s`);
}

async function fetchClip(url) {
	const res = await fetch(url, { signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`clip fetch ${res.status}`);
	return res.json();
}

function clipName(prompt, body) {
	const hash = createHash('sha1').update(body).digest('hex').slice(0, 12);
	return `${CLIP_NAME_PREFIX}${prompt.id}-${hash}`;
}

/**
 * Run one prompt end to end. Returns the checkpoint record; never throws for a
 * quality reject (that is a result), only for infrastructure faults and for the
 * paid-lane abort, which the caller re-raises.
 */
async function runPrompt(prompt) {
	const started = Date.now();
	const { jobId, lane } = DIRECT ? await submitDirect(prompt) : await submitJob(prompt);
	const clipUrl = DIRECT ? await awaitClipDirect(jobId) : await awaitClip(jobId);
	const worker = await fetchClip(clipUrl);
	const elapsedSeconds = Math.round((Date.now() - started) / 1000);
	const derived = deriveClip(worker, prompt);
	// The clip is named from its body once, at generation, and keeps that name
	// through every later re-derivation, so the published object never moves.
	const name = clipName(prompt, JSON.stringify({ ...derived.raw, name: 'pending' }));
	return stageRecord(derived, prompt, {
		name,
		taskId: assertSelfHostedLane(jobId).taskId,
		lane,
		clipSourceUrl: clipUrl,
		elapsedSeconds,
	});
}

/**
 * Turn a clip as the worker wrote it into the clip the library serves, and gate
 * it. Pure: no GPU, no network, so a published set can be re-derived from its
 * sources whenever this pipeline improves (--regate).
 */
function deriveClip(worker, prompt) {
	// The lane writes rotations against the HumanML3D skeleton's raw rest
	// directions, not the library's canonical rest (see rebaseToCanonicalRest).
	// Converted first, because every later step, and every viewer, reads the clip
	// in the library's basis. A clip stamped with the legacy v1 basis is carried
	// back to the source basis and forward again inside the same call.
	const rebased = needsRebase(worker) ? rebaseToCanonicalRest(worker).clip : worker;

	// The lane's foot rotation flips to its other Kabsch solution for a frame or
	// two at a time, flicking the toe 8 cm and back (see FOOT_FLICK). Repaired
	// before anything measures contact, because every flick reads as a planted
	// toe skating across the floor.
	const flicks = despikeFootFlicks(rebased);

	// The lane's root channel is a constant forward ramp carrying no prompt
	// signal (see ROOT_DRIFT in api/_lib/motion-seed.js), so it is removed before
	// anything else reads the clip. Order matters twice over: the gate's
	// foot-slide rule divides planted-foot slide by the stride the clip covers,
	// and a fake one-metre stride makes that rule vacuous, and the seam search
	// below is hunting for the frame whose pose repeats frame 0, which a ramp
	// guarantees no frame ever does.
	const flattened = flattenRootDrift(flicks.clip);

	// Then give the body back the travel its own feet imply. A flattened walk is a
	// treadmill whose planted foot is dragged under a stationary body; the authored
	// library's walks carry their root motion, and so must ours. A clip with too
	// little foot contact to trust (floor work, a jump) keeps the flattened root.
	const locked = lockRootToContacts(flattened.clip);

	// A loop prompt needs a clip that actually loops, and the sampler never
	// returns one: it samples a window, so the last frame has no reason to meet
	// the first. Close the seam before the gate sees it, or 41% of the prompt
	// library is rejected for a defect we know how to repair. The repair
	// self-verifies and returns the original clip untouched if closing the seam
	// would cost more than it buys.
	const seam = prompt.loop === true ? closeLoopSeam(locked.clip) : null;
	const raw = seam ? seam.clip : locked.clip;

	return { raw, verdict: gateWithBasis(raw, prompt), flicks, flattened, locked, seam };
}

/** Write a derived clip to staging (keepers) or the reject pile, and return its checkpoint record. */
function stageRecord(derived, prompt, { name, taskId, lane, clipSourceUrl = null, elapsedSeconds = 0 }) {
	const { raw, verdict, flicks, flattened, locked, seam } = derived;
	// toLibraryClip stamps the basis, so no later pass ever rebases it twice.
	const clip = toLibraryClip(raw, {
		name,
		promptId: prompt.id,
		prompt: prompt.prompt ?? '',
		category: prompt.category,
		loop: prompt.loop === true,
		taskId,
	});
	const serialized = JSON.stringify(clip);

	const record = {
		prompt_id: prompt.id,
		sample: prompt.sample ?? 0,
		label: prompt.label,
		category: prompt.category,
		icon: prompt.icon || '🎬',
		loop: prompt.loop === true,
		name,
		lane,
		clip_source_url: clipSourceUrl,
		elapsed_seconds: elapsedSeconds,
		gate_version: verdict.gateVersion,
		basis: clip.userData.basis,
		loop_seam: seam
			? { before: seam.seamBefore, after: seam.seamAfter, trimmed_frames: seam.trimmedFrames, kept_original: seam.rejected || null }
			: null,
		root_drift: {
			speed_m_s: Number(flattened.speed.toFixed(4)),
			removed_m: Number(flattened.removed.toFixed(4)),
			residual_m: Number(flattened.residual.toFixed(4)),
		},
		foot_flicks_repaired: flicks.repaired,
		root_lock: {
			applied: locked.applied,
			contact_share: Number(locked.contactShare.toFixed(3)),
			speed_m_s: Number(locked.speed.toFixed(4)),
		},
		status: verdict.pass ? 'accepted' : 'rejected',
		reasons: verdict.reasons,
		detail: verdict.detail || '',
		metrics: verdict.metrics,
		decided_at: new Date().toISOString(),
	};

	const keeper = join(CLIPS_DIR, `${name}.json`);
	const reject = join(REJECTS_DIR, `${name}.json`);
	if (verdict.pass) {
		writeFileSync(keeper, serialized);
		if (existsSync(reject)) unlinkSync(reject);
		record.bytes = Buffer.byteLength(serialized);
	} else {
		writeFileSync(reject, JSON.stringify({ record, explanations: explainMotionGate(verdict.reasons), clip }, null, 1));
		if (existsSync(keeper)) unlinkSync(keeper);
	}
	return record;
}

/**
 * The quality gate plus the rest-basis net. motion-quality.js measures a clip
 * against itself, which a clip in the wrong rest basis passes perfectly, so the
 * basis check from motion-seed.js rides alongside it. It should never fire once
 * rebaseToCanonicalRest has run; if it does, the conversion regressed and the
 * clip must not ship.
 */
function gateWithBasis(clip, prompt) {
	const verdict = gateMotionClip(clip, {
		loop: prompt.loop === true,
		requestedDuration: prompt.duration_seconds,
	});
	const basis = gateRestBasis(clip, { loop: prompt.loop === true });
	if (basis.reasons.includes('wrong_rest_basis')) {
		verdict.pass = false;
		verdict.reasons = [...verdict.reasons, 'wrong_rest_basis'];
	}
	if (verdict.metrics) {
		verdict.metrics.uprightGap = basis.metrics.uprightGap;
		verdict.metrics.legBasisDegrees = basis.metrics.legBasisDegrees;
	}
	return verdict;
}

/** Accepted takes recorded for a prompt so far. */
function keepersOf(state, promptId) {
	let n = 0;
	for (const record of Object.values(state.prompts)) {
		if (record.status === 'accepted' && record.prompt_id === promptId) n++;
	}
	return n;
}

/** Checkpoint key for one take of one prompt. Take 0 keeps the bare id, so
 * checkpoints written before --samples existed resume unchanged. */
function sampleKey(prompt) {
	return prompt.sample ? `${prompt.id}~${prompt.sample}` : prompt.id;
}

function shouldRun(record) {
	if (!record) return true;
	if (record.status === 'accepted') return false;
	if (record.status === 'rejected') return RETRY_REJECTS;
	return true; // a prior infrastructure error is always worth retrying
}

// ── Reporting ────────────────────────────────────────────────────────────────

function report(state) {
	const records = Object.values(state.prompts);
	const accepted = records.filter((r) => r.status === 'accepted');
	const rejected = records.filter((r) => r.status === 'rejected');
	const errored = records.filter((r) => r.status === 'error');
	const decided = accepted.length + rejected.length;

	log('');
	log('── Batch result ───────────────────────────────────────────');
	log(`  prompts attempted : ${records.length}`);
	log(`  accepted          : ${accepted.length}`);
	log(`  rejected          : ${rejected.length}`);
	log(`  infra errors      : ${errored.length}`);
	log(`  accept rate       : ${decided ? ((accepted.length / decided) * 100).toFixed(1) : '0.0'}%  (of gated clips)`);

	const gpuSeconds = records.reduce((s, r) => s + (Number(r.elapsed_seconds) || 0), 0);
	log(`  lane seconds      : ${gpuSeconds} (${(gpuSeconds / 60).toFixed(1)} min of GPU wall time)`);
	if (accepted.length) {
		log(`  seconds/accepted  : ${(gpuSeconds / accepted.length).toFixed(1)}`);
	}

	if (rejected.length) {
		/** @type {Record<string, number>} */
		const tally = {};
		for (const r of rejected) for (const reason of r.reasons || []) tally[reason] = (tally[reason] || 0) + 1;
		log('  reject reasons    :');
		for (const [reason, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
			log(`      ${String(n).padStart(4)}  ${reason}  (${explainMotionGate([reason])[0]})`);
		}
	}
	if (errored.length) {
		log('  infra errors      :');
		for (const r of errored.slice(0, 8)) log(`      ${r.prompt_id}: ${r.detail}`);
	}
	log('');
	return { accepted: accepted.length, rejected: rejected.length, errored: errored.length, gpuSeconds };
}

// ── Publish ──────────────────────────────────────────────────────────────────

function stagedManifestEntries(state, publicDomain) {
	const entries = [];
	const perPrompt = {};
	// Lowest take first, so the cap keeps the same clips on every publish.
	const accepted = Object.values(state.prompts)
		.filter((r) => r.status === 'accepted')
		.sort((a, b) => (a.sample ?? 0) - (b.sample ?? 0) || a.name.localeCompare(b.name));
	for (const record of accepted) {
		perPrompt[record.prompt_id] = (perPrompt[record.prompt_id] || 0) + 1;
		if (perPrompt[record.prompt_id] > KEEP_PER_PROMPT) continue;
		const file = join(CLIPS_DIR, `${record.name}.json`);
		if (!existsSync(file)) continue;
		entries.push({
			name: record.name,
			label: record.label,
			icon: record.icon || '🎬',
			loop: record.loop === true,
			duration: record.metrics?.duration ?? 0,
			bytes: record.bytes ?? Buffer.byteLength(readFileSync(file)),
			url: `${publicDomain}/${R2_PREFIX}/clips/${record.name}.json`,
			category: record.category,
			source: 'generated',
			license: 'three.ws (self-hosted text-to-motion, no third-party clip data)',
		});
	}
	return entries.sort((a, b) => a.name.localeCompare(b.name));
}

async function storage(step) {
	const endpoint =
		process.env.S3_ENDPOINT ||
		(process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
	const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
	const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
	const publicDomain = (process.env.S3_PUBLIC_DOMAIN || '').replace(/\/+$/, '');

	if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicDomain) {
		log(`  ${step} skipped: storage credentials are not set in this environment.`);
		log('  Needs S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_PUBLIC_DOMAIN');
		log('  (they live on the three-ws-api Cloud Run service, not in the repo).');
		return null;
	}
	const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
	const client = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });
	return { client, PutObjectCommand, bucket, publicDomain };
}

async function publish(state) {
	const store = await storage('publish');
	if (!store) return { published: 0 };
	const { client, PutObjectCommand, bucket, publicDomain } = store;
	const entries = stagedManifestEntries(state, publicDomain);

	let uploaded = 0;
	for (const entry of entries) {
		const body = readFileSync(join(CLIPS_DIR, `${entry.name}.json`));
		await client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: `${R2_PREFIX}/clips/${entry.name}.json`,
				Body: body,
				ContentType: 'application/json',
				CacheControl: 'public, max-age=31536000, immutable',
			}),
		);
		uploaded++;
		if (uploaded % 20 === 0) log(`  uploaded ${uploaded}/${entries.length}`);
	}

	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `${R2_PREFIX}/manifest.json`,
			Body: JSON.stringify({ generated_at: new Date().toISOString(), clips: entries }),
			ContentType: 'application/json',
			CacheControl: 'public, max-age=60',
		}),
	);
	log(`  ${R2_PREFIX}/manifest.json → ${entries.length} generated clips live via /api/animations/library`);
	return { published: entries.length };
}

// ── List for sale ────────────────────────────────────────────────────────────

/**
 * Bake every published keeper onto the platform rig and list it in the
 * marketplace under the platform account. Idempotent: a re-run re-bakes and
 * updates rows in place (purchase and play counts survive), and a clip that is
 * no longer in the published set is delisted rather than deleted, so a buyer's
 * SIWX re-download grant still resolves to a row.
 */
async function listForSale(state) {
	const store = await storage('listing');
	if (!store) return { listed: 0 };
	if (!process.env.DATABASE_URL) {
		log('  listing skipped: DATABASE_URL is not set (it lives in .env.local).');
		return { listed: 0 };
	}
	const { client, PutObjectCommand, bucket, publicDomain } = store;
	const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
	const { sql } = await import('../../api/_lib/db.js');
	const { bakeMotionGlb } = await import('../../api/_lib/motion-glb.js');
	const market = await import('../../api/_lib/generated-clip-market.js');

	const [owner] = await sql`select id from users where lower(email::text) = ${market.PLATFORM_CREATOR_EMAIL} limit 1`;
	if (!owner) throw new Error(`platform account ${market.PLATFORM_CREATOR_EMAIL} does not exist; nothing can be listed under it`);

	const price = args.price !== undefined ? Number(args.price) : market.generatedListingPrice();
	if (!Number.isFinite(price) || price < 0) throw new Error(`--price must be a non-negative USDC amount, got ${args.price}`);
	const rig = readFileSync(join(ROOT, 'public/avatars/default.glb'));
	const entries = stagedManifestEntries(state, publicDomain);
	const prompts = new Map(loadPrompts().map((p) => [p.id, p]));
	log(`Listing ${entries.length} generated clips at ${price} USDC under ${market.PLATFORM_CREATOR_EMAIL}`);

	// The object store serves its whole bucket on a public domain, and every
	// clip name is published in the free manifest, so a GLB keyed by clip name
	// could be fetched without paying. Each listing's GLB lives under a random
	// key instead, kept in its row and reused on every later run.
	const existing = new Map(
		(
			await sql`select slug, artifact_key from animation_clips where owner_id = ${owner.id} and ${market.GENERATED_TAG} = any(tags)`
		).map((r) => [r.slug, r.artifact_key]),
	);
	const unguessable = (key, name) =>
		typeof key === 'string' && key.startsWith(`${market.GENERATED_GLB_PREFIX}/`) && !key.includes(name);

	// Several takes of one prompt share a label; number them so a buyer can tell
	// them apart. Lowest take first, matching the publish order.
	const takeOf = new Map();
	const perPrompt = {};
	for (const entry of entries) {
		// gen-<prompt id>-<12 hex>: the id is everything between prefix and hash.
		const promptId = entry.name.slice(CLIP_NAME_PREFIX.length, entry.name.lastIndexOf('-'));
		perPrompt[promptId] = (perPrompt[promptId] || 0) + 1;
		takeOf.set(entry.name, perPrompt[promptId]);
	}

	let listed = 0;
	for (const entry of entries) {
		const clip = JSON.parse(readFileSync(join(CLIPS_DIR, `${entry.name}.json`), 'utf8'));
		// Staged clips are in the library basis, so the bake leaves their root
		// alone (see bakeMotionGlb): a walk keeps the travel its feet imply.
		const { glb } = bakeMotionGlb({ rig, clip, name: entry.label || entry.name });
		const previous = existing.get(entry.name);
		const artifactKey = unguessable(previous, entry.name)
			? previous
			: `${market.GENERATED_GLB_PREFIX}/${randomUUID()}.glb`;
		await client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: artifactKey,
				Body: glb,
				ContentType: 'model/gltf-binary',
				CacheControl: 'private, max-age=31536000, immutable',
			}),
		);
		const promptId = clip.userData?.prompt_id;
		const row = market.generatedListingRow(entry, clip, {
			ownerId: owner.id,
			price,
			artifactKey,
			artifactBytes: glb.length,
			tags: prompts.get(promptId)?.tags ?? [],
			take: takeOf.get(entry.name),
		});
		const storageKey = `${R2_PREFIX}/clips/${entry.name}.json`;
		await sql`
			insert into animation_clips
				(owner_id, slug, name, description, kind, format, duration_ms, frame_count, fps, loop,
				 storage_key, tags, visibility, price_amount, price_currency,
				 artifact_key, artifact_bytes, artifact_mime, listed)
			values
				(${row.owner_id}, ${row.slug}, ${row.name}, ${row.description}, ${row.kind}, ${row.format},
				 ${row.duration_ms}, ${row.frame_count}, ${row.fps}, ${row.loop},
				 ${storageKey}, ${row.tags}, ${row.visibility}, ${row.price_amount}, ${row.price_currency},
				 ${row.artifact_key}, ${row.artifact_bytes}, ${row.artifact_mime}, ${row.listed})
			on conflict (owner_id, slug) do update set
				name = excluded.name, description = excluded.description, kind = excluded.kind,
				format = excluded.format, duration_ms = excluded.duration_ms,
				frame_count = excluded.frame_count, fps = excluded.fps, loop = excluded.loop,
				storage_key = excluded.storage_key, tags = excluded.tags,
				visibility = excluded.visibility, price_amount = excluded.price_amount,
				price_currency = excluded.price_currency, artifact_key = excluded.artifact_key,
				artifact_bytes = excluded.artifact_bytes, artifact_mime = excluded.artifact_mime,
				listed = true, deleted_at = null
		`;
		// A GLB an earlier run stored under its guessable name is removed once
		// the row points at the random key.
		if (previous && previous !== artifactKey && !unguessable(previous, entry.name)) {
			await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: previous }));
		}
		listed++;
		if (listed % 25 === 0) log(`  listed ${listed}/${entries.length}`);
	}

	const names = entries.map((e) => e.name);
	const delisted = await sql`
		update animation_clips set listed = false
		where owner_id = ${owner.id} and ${market.GENERATED_TAG} = any(tags) and listed = true
		      and not (slug = any(${names}::text[]))
		returning slug
	`;
	log(`  ${listed} listed, ${delisted.length} delisted (no longer published)`);
	return { listed, delisted: delisted.length };
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Re-derive the published generated library from what is live, correcting the
 * two defects every clip in it carries. Fills the checkpoint and the staging
 * directory in the same shape a generation run leaves behind, so `--publish`
 * needs no special case.
 */
async function repair(state) {
	log('Repairing the published generated library');
	log(`  origin      ${ORIGIN}`);

	const manifest = await (await fetch(`${ORIGIN}/api/animations/library`)).json();
	const live = (manifest.clips || []).filter((c) => String(c.name || '').startsWith(CLIP_NAME_PREFIX));
	log(`  live clips  ${live.length}`);
	log('');

	const prompts = new Map(loadPrompts().map((p) => [p.id, p]));
	const outcome = { kept: 0, dropped: 0, tally: {} };
	for (const entry of live) {
		const source = await (await fetch(entry.url)).json();
		// promptIdOf: gen-<prompt id>-<12 hex>. The hash is fixed width, so the id
		// is everything between the prefix and the last dash.
		const stem = entry.name.slice(CLIP_NAME_PREFIX.length);
		const promptId = stem.slice(0, stem.lastIndexOf('-'));
		const prompt = promptFor(prompts, promptId, entry);
		const record = stageRecord(deriveClip(source, prompt), prompt, {
			name: entry.name,
			taskId: source.userData?.task_id ?? entry.name,
			lane: 'repair',
		});
		state.prompts[promptId] = record;
		tallyOutcome(outcome, record);
		saveCheckpoint(state);
	}
	return summarize(outcome);
}

/**
 * Re-derive every clip in the checkpoint from its source and re-gate it, with
 * no GPU time. A fresh take is re-read from the worker output it was built from
 * (clip_source_url); a clip that entered through --repair has no worker output
 * on record, so its staged copy is carried back to the source basis instead,
 * which is exact (see rebaseToCanonicalRest). Names never change, so a
 * re-derived keeper replaces its published object in place on the next
 * --publish, and one that no longer passes stops being served.
 */
async function regate(state) {
	const prompts = new Map(loadPrompts().map((p) => [p.id, p]));
	const keys = Object.keys(state.prompts).filter((k) => ['accepted', 'rejected'].includes(state.prompts[k].status));
	log(`Re-deriving ${keys.length} clips from their sources`);
	const outcome = { kept: 0, dropped: 0, tally: {} };
	let index = 0;
	const worker = async () => {
		while (index < keys.length) {
			const key = keys[index++];
			const previous = state.prompts[key];
			const source = previous.clip_source_url ? await fetchClip(previous.clip_source_url) : stagedSource(previous);
			if (!source) {
				log(`  skip   ${key}: no source on record and no staged copy`);
				continue;
			}
			const prompt = { ...promptFor(prompts, previous.prompt_id, previous), sample: previous.sample ?? 0 };
			const record = stageRecord(deriveClip(source, prompt), prompt, {
				name: previous.name,
				taskId: source.userData?.task_id ?? previous.name,
				lane: previous.lane,
				clipSourceUrl: previous.clip_source_url ?? null,
				elapsedSeconds: previous.elapsed_seconds ?? 0,
			});
			if (record.status !== previous.status) {
				log(`  ${record.status === 'accepted' ? 'now keep' : 'now drop'} ${key}  ${record.reasons.join(',')}`);
			}
			state.prompts[key] = record;
			tallyOutcome(outcome, record);
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY * 2, keys.length) }, worker));
	saveCheckpoint(state);
	return summarize(outcome);
}

/** The staged copy of a clip with no worker output on record (a --repair clip). */
function stagedSource(record) {
	const keeper = join(CLIPS_DIR, `${record.name}.json`);
	if (existsSync(keeper)) return JSON.parse(readFileSync(keeper, 'utf8'));
	const reject = join(REJECTS_DIR, `${record.name}.json`);
	if (!existsSync(reject)) return null;
	const parsed = JSON.parse(readFileSync(reject, 'utf8'));
	return parsed.clip ?? null;
}

/** The library prompt for an id, or a stand-in built from what the record knows. */
function promptFor(prompts, promptId, fallback) {
	const prompt = prompts.get(promptId);
	if (prompt) return prompt;
	return {
		id: promptId,
		label: fallback.label ?? promptId,
		category: fallback.category ?? 'emote',
		icon: fallback.icon,
		loop: fallback.loop === true,
		prompt: '',
		duration_seconds: undefined,
	};
}

function tallyOutcome(outcome, record) {
	if (record.status === 'accepted') {
		outcome.kept++;
		return;
	}
	outcome.dropped++;
	for (const reason of record.reasons) outcome.tally[reason] = (outcome.tally[reason] || 0) + 1;
}

function summarize({ kept, dropped, tally }) {
	log('');
	log(`  kept    ${kept}`);
	log(`  dropped ${dropped}`);
	for (const [reason, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
		log(`    ${reason.padEnd(26)} ${count}`);
	}
	return { kept, dropped };
}

async function main() {
	ensureDirs();
	const state = loadCheckpoint();

	if (REPORT_ONLY) {
		report(state);
		return;
	}

	if (LIST && !PUBLISH && !REPAIR && !args.limit && !args.categories && !args.samples) {
		await listForSale(state);
		return;
	}

	if (REGATE) {
		const outcome = await regate(state);
		report(state);
		if (PUBLISH) await publish(state);
		if (LIST) await listForSale(state);
		if (outcome.kept === 0) process.exitCode = 4;
		return;
	}

	if (REPAIR) {
		const outcome = await repair(state);
		if (PUBLISH) await publish(state);
		if (outcome.kept === 0) process.exitCode = 4;
		return;
	}

	if (PUBLISH && Object.values(state.prompts).every((r) => r.status !== 'accepted')) {
		log('Nothing staged to publish. Run a generation batch first.');
		return;
	}

	if (!PUBLISH || args.limit || args.categories) {
		let prompts = loadPrompts();
		if (CATEGORIES) prompts = prompts.filter((p) => CATEGORIES.includes(p.category));
		// Interleave takes (every prompt's take 0, then every take 1, ...) so a
		// partial run covers the whole library before it deepens any one prompt.
		const takes = [];
		for (let sample = 0; sample < SAMPLES; sample++) for (const p of prompts) takes.push({ ...p, sample });
		const queue = takes
			.filter((p) => keepersOf(state, p.id) < KEEP_PER_PROMPT && shouldRun(state.prompts[sampleKey(p)]))
			.slice(0, LIMIT);

		log(`Seeding motion from ${PROMPTS_PATH.replace(`${ROOT}/`, '')}`);
		log(`  transport   ${DIRECT ? 'direct (GCP provider, no public rate limit)' : ORIGIN}`);
		log(`  samples     ${SAMPLES} per prompt`);
		log(`  queue       ${queue.length} take(s) of ${takes.length} (${Object.keys(state.prompts).length} already decided)`);
		log(`  concurrency ${CONCURRENCY}`);
		log(`  staging     ${OUT_DIR.replace(`${ROOT}/`, '')}`);
		log('');

		let index = 0;
		let aborted = null;
		const worker = async () => {
			while (index < queue.length && !aborted) {
				const prompt = queue[index++];
				// Re-checked at dispatch, not only when the queue was built: an
				// earlier take of this prompt may have landed its last keeper since.
				if (keepersOf(state, prompt.id) >= KEEP_PER_PROMPT) continue;
				try {
					const record = await runPrompt(prompt);
					state.prompts[sampleKey(prompt)] = record;
					const mark = record.status === 'accepted' ? 'keep  ' : 'reject';
					const why = record.status === 'accepted' ? '' : `  ${record.reasons.join(',')}`;
					log(`  ${mark} ${sampleKey(prompt).padEnd(30)} ${String(record.elapsed_seconds).padStart(3)}s${why}`);
				} catch (err) {
					if (err instanceof PaidLaneError) {
						aborted = err;
						break;
					}
					state.prompts[sampleKey(prompt)] = {
						prompt_id: prompt.id,
						sample: prompt.sample,
						status: 'error',
						detail: err?.message || String(err),
						decided_at: new Date().toISOString(),
					};
					log(`  error  ${sampleKey(prompt).padEnd(30)} ${err?.message || err}`);
				}
				saveCheckpoint(state);
			}
		};
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
		saveCheckpoint(state);

		if (aborted) {
			report(state);
			console.error(`\nABORTED: ${aborted.message}`);
			console.error('No bulk generation may run on a paid third-party lane. Fix the lane resolution and re-run.');
			process.exitCode = 3;
			return;
		}
	}

	const stats = report(state);
	if (PUBLISH) await publish(state);
	if (LIST) await listForSale(state);

	// A batch that gated nothing at all is an infrastructure failure dressed up
	// as a clean run, so it exits non-zero rather than reporting "0 accepted".
	if (stats.accepted === 0 && stats.rejected === 0) process.exitCode = 4;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
