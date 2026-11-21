// 360 capture jobs: persistence, worker sync and finalisation for
// /api/pano-capture (contract C4 in prompts/finish/_context/insta360-00-CONTEXT.md).
//
// The job lives in pano_captures (migration 20261121215040). The worker is
// workers/model-pano2splat (contract C1), reached only over its HTTP API at
// GCP_PANO2SPLAT_URL with the shared GCP_RECONSTRUCTION_KEY bearer. There is no
// worker callback: a GET of an active job polls the worker at most once per
// POLL_MIN_MS, and /api/cron/pano-captures advances jobs nobody is polling.
//
// When the worker reports success its files (7-day signed GCS URLs) are
// streamed into our bucket under captures/pano/<user_id>/<job_id>/ so a
// capture outlives the worker's URLs. A lease keeps two finalisers off one job
// and a finished job is never finalised twice.

import { sql } from './db.js';
import { env } from './env.js';
import { fetchUpstream } from './upstream-fetch.js';
import { uploadStream } from './r2-stream.js';
import { cdnUrl, deleteObject, isStorageInfrastructureError, objectStorageConfigured } from './r2.js';
import { fallbackDelete } from './storage-fallback.js';

export const ACTIVE_STATUSES = ['queued', 'running'];
// What a splat capture can be built from. A single raw .insp photo has no
// parallax to reconstruct from: C1 refuses it for task "splat", and it becomes a
// depth scene through /api/pano-scene instead.
export const SOURCE_KINDS = ['equirect_video', 'equirect_images', 'insv'];
export const QUALITIES = ['preview', 'standard', 'high'];
export const MAX_ACTIVE_PER_USER = 2;
export const POLL_MIN_MS = 5_000;

// A worker task that nobody polled for this long is picked up by the cron.
const UNWATCHED_S = 60;
// Long enough to stream a multi-GB PLY; a finaliser that dies mid-copy hands
// the job back after this.
const FINALISE_LEASE_S = 15 * 60;
// The worker's signed result URLs are valid for 7 days (contract C1).
const RESULT_URL_TTL_MS = 7 * 24 * 3600 * 1000;
const COPY_TIMEOUT_MS = 20 * 60 * 1000;
const WORKER_TIMEOUT_MS = 15_000;
// A row with no worker task this long after creation lost its submit (the
// instance died between the insert and the worker's 202).
const SUBMIT_LOST_S = 120;

// Typical wall time per quality preset on one L4, used only for eta_seconds.
const ETA_SECONDS = { preview: 900, standard: 1800, high: 2700 };

// Files copied out of the worker bucket. ply and spz are the scene and are
// required; the flythrough and the poster are kept when the worker made them.
const RESULT_FILES = [
	{ field: 'ply_url', name: 'scene.ply', type: 'application/octet-stream', required: true },
	{ field: 'spz_url', name: 'scene.spz', type: 'application/octet-stream', required: true },
	{ field: 'preview_url', name: 'preview.mp4', type: 'video/mp4', required: false },
	{ field: 'poster_url', name: 'poster.jpg', type: 'image/jpeg', required: false },
];

/** Thrown for any non-success answer from the worker; code/message are the worker's own. */
export class WorkerError extends Error {
	constructor(status, code, message) {
		super(message);
		this.name = 'WorkerError';
		this.status = status;
		this.code = code;
	}
}

/** Worker base URL and bearer, or null when this deployment has no pano2splat worker. */
export function workerConfig() {
	const base = env.GCP_PANO2SPLAT_URL;
	const key = String(process.env.GCP_RECONSTRUCTION_KEY || '').trim();
	return base && key ? { base, key } : null;
}

/** True when both the worker and the bucket the finaliser writes to are configured. */
export function captureConfigured() {
	return Boolean(workerConfig()) && objectStorageConfigured();
}

export function storagePrefix(userId, jobId) {
	return `captures/pano/${userId}/${jobId}/`;
}

export function etaSeconds(quality) {
	return ETA_SECONDS[quality] || ETA_SECONDS.standard;
}

// ── Worker client (contract C1) ─────────────────────────────────────────────

// The worker reports a failure as `{ error: { code, message } }` on a task, or
// as `{ error, message }` / FastAPI's `{ detail }` on a rejected request. Keep
// its code and message exactly as sent; only fill in what is missing.
function workerErrorFrom(status, body) {
	const e = body && typeof body === 'object' ? body : {};
	const nested = e.error && typeof e.error === 'object' ? e.error : null;
	const detail = e.detail && typeof e.detail === 'object' ? e.detail : null;
	const code = nested?.code || (typeof e.error === 'string' ? e.error : null) || detail?.error || detail?.code || `worker_http_${status}`;
	const message =
		nested?.message ||
		e.message ||
		detail?.message ||
		(typeof e.detail === 'string' ? e.detail : null) ||
		'The capture worker could not process this request.';
	return new WorkerError(status, String(code), String(message));
}

async function workerCall(cfg, path, { method = 'GET', body } = {}) {
	const res = await fetchUpstream(
		`${cfg.base}${path}`,
		{
			method,
			headers: {
				authorization: `Bearer ${cfg.key}`,
				accept: 'application/json',
				...(body ? { 'content-type': 'application/json' } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		},
		// Every status is handled below so a worker 4xx keeps its own error.
		{ name: 'worker:pano2splat', timeoutMs: WORKER_TIMEOUT_MS, attempts: 2, okWhen: () => true },
	);
	const text = await res.text().catch(() => '');
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = null;
	}
	if (!res.ok) throw workerErrorFrom(res.status, data);
	return data || {};
}

export function submitTask(cfg, job) {
	return workerCall(cfg, '/infer', {
		method: 'POST',
		body: {
			task: 'splat',
			source_url: job.source_url,
			...(job.source_urls ? { source_urls: job.source_urls } : {}),
			source_kind: job.source_kind,
			...(job.trim ? { trim: job.trim } : {}),
			quality: job.quality,
			job_id: job.id,
		},
	});
}

export const getTask = (cfg, taskId) => workerCall(cfg, `/tasks/${encodeURIComponent(taskId)}`);
export const cancelTask = (cfg, taskId) => workerCall(cfg, `/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });

// ── Rows ────────────────────────────────────────────────────────────────────

const json = (v) => (v == null ? null : JSON.stringify(v));

function isUniqueViolation(err) {
	return err?.code === '23505' || /duplicate key value|unique constraint/i.test(String(err?.message || ''));
}

/**
 * Insert a queued job in a free active slot. Returns null when the owner
 * already has MAX_ACTIVE_PER_USER jobs queued or running: the partial unique
 * index on (user_id, active_slot) makes that check race-free.
 */
export async function insertJob(userId, src) {
	for (let slot = 1; slot <= MAX_ACTIVE_PER_USER; slot++) {
		try {
			const [row] = await sql`
				INSERT INTO pano_captures (user_id, source_kind, source_url, source_urls, "trim", quality, active_slot, stage)
				VALUES (${userId}, ${src.source_kind}, ${src.source_url}, ${json(src.source_urls)}::jsonb,
				        ${json(src.trim)}::jsonb, ${src.quality}, ${slot}, 'queued')
				RETURNING *`;
			return row;
		} catch (err) {
			if (isUniqueViolation(err)) continue;
			throw err;
		}
	}
	return null;
}

export async function getOwnedJob(userId, jobId) {
	const [row] = await sql`SELECT * FROM pano_captures WHERE id = ${jobId} AND user_id = ${userId}`;
	return row || null;
}

export async function listOwnedJobs(userId, limit = 50) {
	return sql`
		SELECT * FROM pano_captures WHERE user_id = ${userId}
		ORDER BY created_at DESC LIMIT ${limit}`;
}

async function markFailed(id, error, extra = {}) {
	const [row] = await sql`
		UPDATE pano_captures
		SET status = 'failed', error = ${json(error)}::jsonb, stage = ${extra.stage ?? null},
		    lease_until = NULL, finished_at = now(), updated_at = now()
		WHERE id = ${id} AND status IN ('queued', 'running')
		RETURNING *`;
	return row || null;
}

async function reload(id) {
	const [row] = await sql`SELECT * FROM pano_captures WHERE id = ${id}`;
	return row || null;
}

/**
 * Create a job and hand it to the worker. Returns `{ row }`, `{ limited: true }`
 * when the owner is at the active cap, or `{ row, error }` when the worker
 * refused it (the row is stored as failed with the worker's own code/message).
 */
export async function createCapture(cfg, userId, src) {
	const row = await insertJob(userId, src);
	if (!row) return { limited: true };
	try {
		const out = await submitTask(cfg, row);
		const taskId = out?.task_id ? String(out.task_id) : '';
		if (!taskId) throw new WorkerError(502, 'worker_bad_response', 'The capture worker did not return a task id.');
		const [updated] = await sql`
			UPDATE pano_captures SET worker_task_id = ${taskId}, polled_at = now(), updated_at = now()
			WHERE id = ${row.id} RETURNING *`;
		return { row: updated };
	} catch (err) {
		const error =
			err instanceof WorkerError
				? { code: err.code, message: err.message }
				: { code: 'worker_unreachable', message: 'The capture worker could not be reached. Try again in a minute.' };
		const status = err instanceof WorkerError ? err.status : 503;
		// A full worker queue (C1 429 "busy") refused nothing about the footage:
		// drop the row so the account has no failed capture it never really started.
		if (status === 429) {
			await sql`DELETE FROM pano_captures WHERE id = ${row.id}`;
			return { error, status, retryable: true };
		}
		const failed = await markFailed(row.id, error);
		return { row: failed || row, error, status };
	}
}

// ── Sync and finalise ───────────────────────────────────────────────────────

/**
 * Take the poll slot for a job: true for at most one caller per POLL_MIN_MS.
 * The timestamp is written in the same statement that checks it.
 */
async function claimPoll(id) {
	const ms = POLL_MIN_MS;
	const [row] = await sql`
		UPDATE pano_captures SET polled_at = now()
		WHERE id = ${id} AND status IN ('queued', 'running')
		  AND (polled_at IS NULL OR polled_at <= now() - make_interval(secs => ${ms / 1000}))
		RETURNING *`;
	return row || null;
}

/**
 * Bring an active job up to date with the worker, finalising it when the
 * worker is done. Returns the current row. Never throws for a worker or
 * storage fault: the job keeps its state and the next poll or cron tick retries.
 */
export async function syncJob(cfg, row) {
	if (!row || !ACTIVE_STATUSES.includes(row.status)) return row;
	// The worker already finished; only the copy into our bucket is left.
	if (row.worker_result) return finalise(row);

	if (!row.worker_task_id) {
		const age = (Date.now() - new Date(row.created_at).getTime()) / 1000;
		if (age < SUBMIT_LOST_S) return row;
		return (
			(await markFailed(row.id, {
				code: 'submit_lost',
				message: 'This capture never reached the worker. Start it again.',
			})) || reload(row.id)
		);
	}

	const claimed = await claimPoll(row.id);
	if (!claimed) return (await reload(row.id)) || row;

	let task;
	try {
		task = await getTask(cfg, claimed.worker_task_id);
	} catch (err) {
		// The worker forgot the task (a restart wipes its in-memory queue): the
		// job cannot finish, so say so instead of polling a ghost forever.
		// C1 answers 404 { error: "not_found" } for any task id it does not hold.
		if (err instanceof WorkerError && err.status === 404) {
			return (
				(await markFailed(claimed.id, {
					code: 'task_lost',
					message: 'The capture worker restarted and lost this job. Start it again.',
				})) || reload(claimed.id)
			);
		}
		return claimed;
	}
	return applyTask(claimed, task);
}

function clamp01(v, dflt) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : dflt;
}

async function applyTask(row, task) {
	const status = String(task?.status || '');
	const stage = typeof task?.stage === 'string' ? task.stage.slice(0, 32) : row.stage;
	const progress = clamp01(task?.progress, row.progress);

	if (status === 'queued' || status === 'running') {
		const [updated] = await sql`
			UPDATE pano_captures SET status = ${status}, stage = ${stage}, progress = ${progress}, updated_at = now()
			WHERE id = ${row.id} AND status IN ('queued', 'running') RETURNING *`;
		return updated || reload(row.id);
	}
	if (status === 'failed') {
		const e = task?.error && typeof task.error === 'object' ? task.error : {};
		return (
			(await markFailed(
				row.id,
				{
					code: String(e.code || 'worker_failed'),
					message: String(e.message || 'The capture worker could not reconstruct this footage.'),
				},
				{ stage },
			)) || reload(row.id)
		);
	}
	if (status === 'cancelled') {
		const [updated] = await sql`
			UPDATE pano_captures SET status = 'cancelled', stage = ${stage}, lease_until = NULL,
			       finished_at = now(), updated_at = now()
			WHERE id = ${row.id} AND status IN ('queued', 'running') RETURNING *`;
		return updated || reload(row.id);
	}
	if (status === 'succeeded') {
		const result = task?.result && typeof task.result === 'object' ? task.result : {};
		const [updated] = await sql`
			UPDATE pano_captures
			SET status = 'running', stage = 'save', progress = 0.99,
			    worker_result = ${json(result)}::jsonb, stats = ${json(result.stats || null)}::jsonb, updated_at = now()
			WHERE id = ${row.id} AND status IN ('queued', 'running') AND worker_result IS NULL
			RETURNING *`;
		return finalise(updated || (await reload(row.id)));
	}
	return row;
}

/** Take the finaliser lease, or null when another finaliser holds it or the job is not ready. */
async function claimFinalise(id) {
	const s = FINALISE_LEASE_S;
	const [row] = await sql`
		UPDATE pano_captures SET lease_until = now() + make_interval(secs => ${s}), updated_at = now()
		WHERE id = ${id} AND status = 'running' AND worker_result IS NOT NULL
		  AND (lease_until IS NULL OR lease_until < now())
		RETURNING *`;
	return row || null;
}

class SourceGoneError extends Error {}

// Signed URLs come from our own worker; still refuse anything weaker than the
// worker's own scheme so a misbehaving worker cannot point the copy at plain http.
function assertArtifactUrl(cfg, url) {
	const u = new URL(url);
	const workerScheme = cfg ? new URL(cfg.base).protocol : 'https:';
	if (u.protocol !== 'https:' && !(workerScheme === 'http:' && u.protocol === 'http:')) {
		throw new SourceGoneError(`artifact URL scheme not allowed: ${u.protocol}`);
	}
}

/**
 * Stream one worker artifact into the bucket.
 * @returns {Promise<{ key: string, bytes: number, sha256: string }>}
 */
export async function copyArtifact(cfg, sourceUrl, key, contentType) {
	assertArtifactUrl(cfg, sourceUrl);
	const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(COPY_TIMEOUT_MS) });
	if (!res.ok) {
		await res.body?.cancel().catch(() => {});
		// A signed URL past its 7 days answers 400/403; a removed object 404.
		if (res.status >= 400 && res.status < 500) throw new SourceGoneError(`artifact http ${res.status}`);
		throw new Error(`artifact http ${res.status}`);
	}
	if (!res.body) throw new Error('artifact response had no body');
	return uploadStream({ key, stream: res.body, contentType, metadata: { source: 'pano-capture' } });
}

/**
 * Copy the worker's files into the bucket and mark the job succeeded.
 * Idempotent: a job that already succeeded, or whose lease another finaliser
 * holds, is returned untouched.
 */
export async function finalise(row, cfg = workerConfig()) {
	if (!row || row.status !== 'running' || !row.worker_result) return row;
	const claimed = await claimFinalise(row.id);
	if (!claimed) return (await reload(row.id)) || row;

	const wr = claimed.worker_result || {};
	const prefix = storagePrefix(claimed.user_id, claimed.id);
	const files = {};
	const result = {};
	try {
		for (const f of RESULT_FILES) {
			const src = typeof wr[f.field] === 'string' ? wr[f.field] : '';
			if (!src) {
				if (f.required) throw new SourceGoneError(`worker result has no ${f.field}`);
				continue;
			}
			const copied = await copyArtifact(cfg, src, `${prefix}${f.name}`, f.type);
			files[f.field.replace(/_url$/, '')] = copied;
			result[f.field] = cdnUrl(copied.key);
		}
	} catch (err) {
		// The worker finished after the job was created, so its URLs are surely
		// dead once the job is older than their lifetime.
		const expired = Date.now() - new Date(claimed.created_at).getTime() > RESULT_URL_TTL_MS;
		if (err instanceof SourceGoneError || expired) {
			return (
				(await markFailed(claimed.id, {
					code: 'result_unavailable',
					message: 'The finished scene could not be saved because the worker no longer has its files. Start the capture again.',
				}, { stage: 'save' })) || reload(claimed.id)
			);
		}
		// Storage or network fault: hand the lease back so the next poll or cron retries.
		console.warn(`[pano-capture] finalise ${claimed.id} failed: ${err?.message || err}`);
		const [released] = await sql`
			UPDATE pano_captures SET lease_until = NULL, updated_at = now()
			WHERE id = ${claimed.id} RETURNING *`;
		return released || claimed;
	}

	result.viewer_url = `/splat?src=${encodeURIComponent(result.spz_url)}`;
	result.files = files;
	const [done] = await sql`
		UPDATE pano_captures
		SET status = 'succeeded', stage = 'done', progress = 1, result = ${json(result)}::jsonb,
		    lease_until = NULL, finished_at = now(), updated_at = now()
		WHERE id = ${claimed.id} AND status = 'running'
		RETURNING *`;
	return done || reload(claimed.id);
}

// ── Cancel and delete ───────────────────────────────────────────────────────

// Every file a capture can store has a fixed name under its prefix, so the
// purge deletes those keys rather than listing the bucket, which R2 cannot
// answer while it refuses the credential. A finished job records which store
// holds each file; a job cancelled mid-save does not, so each key is tried in
// both, and a key R2 cannot confirm is logged instead of blocking the cancel.
async function purgeStoredFiles(row, { bestEffort = false } = {}) {
	const prefix = storagePrefix(row.user_id, row.id);
	const files = row.result?.files || null;
	for (const f of RESULT_FILES) {
		const key = `${prefix}${f.name}`;
		const saved = files?.[f.field.replace(/_url$/, '')];
		if (files && !saved) continue;
		try {
			if (saved?.store === 'gcs') await fallbackDelete(key);
			else await deleteObject(key);
		} catch (err) {
			if (!bestEffort || !isStorageInfrastructureError(err)) throw err;
			console.warn(`[pano-capture] purge ${key} left for later: ${err?.message || err}`);
		}
	}
}

/**
 * DELETE semantics from contract C4: an active job is cancelled on the worker
 * and kept as `cancelled`; a finished job loses its stored files and its row.
 * @returns {Promise<{ status: 'cancelled' } | { deleted: true }>}
 */
export async function removeJob(cfg, row) {
	if (ACTIVE_STATUSES.includes(row.status)) {
		if (cfg && row.worker_task_id && !row.worker_result) {
			try {
				await cancelTask(cfg, row.worker_task_id);
			} catch (err) {
				// A task the worker no longer knows is already stopped.
				if (!(err instanceof WorkerError && err.status === 404)) throw err;
			}
		}
		await sql`
			UPDATE pano_captures SET status = 'cancelled', lease_until = NULL, finished_at = now(), updated_at = now()
			WHERE id = ${row.id} AND status IN ('queued', 'running')`;
		// A job cancelled mid-save may have copied some files already.
		if (row.worker_result && objectStorageConfigured()) await purgeStoredFiles(row, { bestEffort: true });
		return { status: 'cancelled' };
	}
	if (objectStorageConfigured()) await purgeStoredFiles(row);
	await sql`DELETE FROM pano_captures WHERE id = ${row.id} AND user_id = ${row.user_id}`;
	return { deleted: true };
}

// ── Cron ────────────────────────────────────────────────────────────────────

/**
 * Advance active jobs nobody is polling, so a capture finishes and its files
 * are saved even after its owner closed the tab.
 */
export async function advanceUnwatched({ limit = 10, budgetMs = 200_000 } = {}) {
	const cfg = workerConfig();
	if (!cfg) return { skipped: 'unconfigured', advanced: [] };
	const s = UNWATCHED_S;
	const rows = await sql`
		SELECT * FROM pano_captures
		WHERE status IN ('queued', 'running')
		  AND (polled_at IS NULL OR polled_at < now() - make_interval(secs => ${s}))
		  AND (lease_until IS NULL OR lease_until < now())
		ORDER BY polled_at ASC NULLS FIRST
		LIMIT ${limit}`;
	const started = Date.now();
	const advanced = [];
	for (const row of rows) {
		if (Date.now() - started > budgetMs) break;
		try {
			const next = await syncJob(cfg, row);
			advanced.push({ job_id: row.id, from: row.status, to: next?.status || row.status, stage: next?.stage || null });
		} catch (err) {
			advanced.push({ job_id: row.id, from: row.status, error: err?.message || String(err) });
		}
	}
	return { advanced };
}

// ── Public shapes ───────────────────────────────────────────────────────────

const iso = (v) => (v == null ? null : new Date(v).toISOString());

export function publicJob(row) {
	const out = {
		job_id: row.id,
		status: row.status,
		stage: row.stage || null,
		progress: Number(row.progress) || 0,
		source_kind: row.source_kind,
		quality: row.quality,
		created_at: iso(row.created_at),
		updated_at: iso(row.updated_at),
		finished_at: iso(row.finished_at),
	};
	if (row.status === 'succeeded' && row.result) {
		const r = row.result;
		out.result = {
			ply_url: r.ply_url || null,
			spz_url: r.spz_url || null,
			preview_url: r.preview_url || null,
			poster_url: r.poster_url || null,
			viewer_url: r.viewer_url || null,
		};
	}
	if (row.stats) out.stats = row.stats;
	if (row.error) out.error = { code: row.error.code, message: row.error.message };
	return out;
}

export function publicListItem(row) {
	const r = row.status === 'succeeded' && row.result ? row.result : {};
	return {
		job_id: row.id,
		status: row.status,
		stage: row.stage || null,
		progress: Number(row.progress) || 0,
		created_at: iso(row.created_at),
		poster_url: r.poster_url || null,
		viewer_url: r.viewer_url || null,
		source_kind: row.source_kind,
		error: row.error ? { code: row.error.code, message: row.error.message } : null,
	};
}
