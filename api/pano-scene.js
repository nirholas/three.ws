/**
 * /api/pano-scene: step inside a 360 photo.
 *
 *   POST /api/pano-scene
 *     { image_url: string,                        // public https URL to the upload
 *       source_kind?: "equirect_image" | "insp" } // inferred from a .insp path when omitted
 *                              -> 202 { job_id, status, stage, progress }
 *
 *   GET  /api/pano-scene?job=<id>
 *                              -> { job_id, status, stage, progress,
 *                                   result?: { glb_url, ply_url, viewer_url, stats },
 *                                   error?: { code, message } }
 *
 *   GET  /api/pano-scene       -> { lanes: { equirect_image: bool, insp: bool } }
 *                                 so a page can say the lane is off before an upload.
 *
 * A stitched equirectangular photo goes straight to the depth worker
 * (workers/model-panodepth, contract C2 in prompts/finish/_context/insta360-00-CONTEXT.md).
 * A raw Insta360 .insp goes first to model-pano2splat with task "stitch" (C1),
 * and the equirect it returns goes to the depth worker. The poll reports one
 * combined status: the stitch is the first 20 percent, depth and meshing the
 * next 75, and copying the results to R2 the last 5. Results are copied from
 * the workers' 7-day signed URLs to R2 under captures/pano-scene/<owner>/<job>/
 * before the job reports success, so the links stay valid.
 *
 * The job id is a signed token (api/_lib/pano-scene-job.js) carrying the owner
 * and worker task ids, so any instance can answer a poll, and every poll checks
 * that the caller owns the job. Needs an account; rate-limited on the same
 * mcp3dGenerate bucket as the rest of the forge surface. A missing worker URL
 * answers a clean 503 `unconfigured`, exactly like /api/scene-capture.
 */

import { randomUUID } from 'node:crypto';

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp, refundOnServerFailure } from './_lib/rate-limit.js';
import { requireCreator } from './_lib/creator-account.js';
import { assertPublicHttpsUrl, SsrfError } from './_lib/ssrf.js';
import { fetchUpstream } from './_lib/upstream-fetch.js';
import { cdnUrl, objectStorageConfigured, putObject, workerReadableUrl } from './_lib/r2.js';
import {
	SOURCE_KINDS,
	claim,
	decodeJobToken,
	encodeJobToken,
	jobPrefix,
	readJsonObject,
	writeJsonObject,
} from './_lib/pano-scene-job.js';

// Workers fetch these URLs with our bearer key in hand, so plain http is
// refused even on a dev server (where assertPublicHttpsUrl would allow it).
const HTTPS_ONLY = Object.freeze({ allowHttp: false });

// Share of the combined progress bar each stage owns.
const STITCH_SHARE = 0.2;
const SAVE_START = 0.95;

// The depth worker's defaults for a shell a phone can still render smoothly.
const DEPTH_MAX_POINTS = 2_000_000;

// A claim older than this belonged to an instance that died mid-step.
const DEPTH_CLAIM_STALE_MS = 120_000;
const FINALIZE_CLAIM_STALE_MS = 180_000;

// A worker 404 shortly after submit is the window before the task record is
// visible to every worker instance, not a loss.
const TASK_MISSING_GRACE_MS = 3 * 60_000;

// Largest single result file copied to R2. A 2M-point textured shell is a few
// hundred MB at most; anything bigger is a worker fault, not a scene.
const MAX_RESULT_BYTES = 768 * 1024 * 1024;

function readEnv(name) {
	const v = process.env[name];
	return typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : null;
}

function workerConfig() {
	return {
		key: readEnv('GCP_RECONSTRUCTION_KEY'),
		depthUrl: readEnv('GCP_PANODEPTH_URL'),
		stitchUrl: readEnv('GCP_PANO2SPLAT_URL'),
	};
}

function laneConfigured(cfg, kind) {
	if (!cfg.key || !cfg.depthUrl) return false;
	return kind === 'insp' ? Boolean(cfg.stitchUrl) : true;
}

// `message` is rendered to visitors; operator instructions live in `hint`,
// which the page never shows.
function unconfigured(res, kind) {
	const vars =
		kind === 'insp'
			? 'GCP_PANODEPTH_URL, GCP_PANO2SPLAT_URL and GCP_RECONSTRUCTION_KEY'
			: 'GCP_PANODEPTH_URL and GCP_RECONSTRUCTION_KEY';
	return json(res, 503, {
		error: 'unconfigured',
		message: 'Photo-to-3D is not switched on yet on this server.',
		hint:
			`Set ${vars} to the deployed workers/model-panodepth` +
			(kind === 'insp' ? ' and workers/model-pano2splat services' : ' service') +
			' and the shared reconstruction bearer secret.',
	});
}

function storageUnconfigured(res) {
	return json(res, 503, {
		error: 'unconfigured',
		message: 'Photo-to-3D is not switched on yet on this server.',
		hint: 'Object storage (S3_ENDPOINT, S3_BUCKET, S3_PUBLIC_DOMAIN and keys) must be set: results are kept in R2.',
	});
}

// ── worker client (contracts C1 and C2) ───────────────────────────────────────

// The workers answer { error, message } or { error: { code, message } };
// model-panodepth refuses through FastAPI's HTTPException, which nests that
// body under `detail`, and its pydantic validation answers 422 with a list of
// field errors under `detail` instead.
function validationMessage(issues) {
	const parts = issues
		.filter((i) => i && typeof i.msg === 'string')
		.map((i) => {
			const field = Array.isArray(i.loc) ? i.loc.filter((p) => p !== 'body').join('.') : '';
			return field ? `${field}: ${i.msg}` : i.msg;
		});
	return parts.length ? `The 3D server refused the request: ${parts.join('; ')}.` : null;
}

function workerError(status, raw) {
	if (Array.isArray(raw?.detail)) {
		const message = validationMessage(raw.detail) || `The 3D server answered ${status}.`;
		return Object.assign(new Error(message), { status, code: 'invalid_request' });
	}
	const data = raw?.detail && typeof raw.detail === 'object' ? raw.detail : raw;
	const err = data?.error;
	const code = (typeof err === 'object' ? err?.code : err) || 'worker_error';
	const message =
		(typeof err === 'object' ? err?.message : null) || data?.message || `The 3D server answered ${status}.`;
	return Object.assign(new Error(message), { status, code: String(code) });
}

async function submitTask(baseUrl, key, body, name) {
	const res = await fetchUpstream(
		`${baseUrl}/infer`,
		{
			method: 'POST',
			headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
			body: JSON.stringify(body),
		},
		// One attempt: a retried POST could start a second GPU task.
		{ name: `pano-scene:submit:${name}`, timeoutMs: 30_000, attempts: 1, okWhen: () => true },
	);
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw workerError(res.status, data);
	if (typeof data?.task_id !== 'string' || !data.task_id) {
		throw Object.assign(new Error('The 3D server did not return a task id.'), { status: 502, code: 'worker_error' });
	}
	return data.task_id;
}

function normalizeStatus(s) {
	if (s === 'done' || s === 'succeeded') return 'succeeded';
	if (s === 'failed' || s === 'cancelled' || s === 'running' || s === 'queued') return s;
	return 'queued';
}

function clamp01(n) {
	const v = Number(n);
	return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** @returns {Promise<{ kind: 'task', status, progress, stage, result, error } | { kind: 'missing' } | { kind: 'unreachable' }>} */
async function pollTask(baseUrl, key, taskId, name) {
	let res;
	try {
		res = await fetchUpstream(
			`${baseUrl}/tasks/${encodeURIComponent(taskId)}`,
			{ headers: { authorization: `Bearer ${key}` } },
			{ name: `pano-scene:poll:${name}`, timeoutMs: 15_000, attempts: 2, okWhen: () => true },
		);
	} catch {
		return { kind: 'unreachable' };
	}
	if (res.status === 404) return { kind: 'missing' };
	const data = await res.json().catch(() => null);
	if (!res.ok || !data) return { kind: 'unreachable' };
	return {
		kind: 'task',
		status: normalizeStatus(data.status),
		progress: clamp01(data.progress),
		stage: typeof data.stage === 'string' ? data.stage : null,
		result: data.result && typeof data.result === 'object' ? data.result : null,
		error: data.error ?? null,
	};
}

function taskError(error, fallbackCode, fallbackMessage) {
	if (error && typeof error === 'object' && error.message) {
		return { code: String(error.code || fallbackCode), message: String(error.message) };
	}
	if (typeof error === 'string' && error) return { code: fallbackCode, message: error };
	return { code: fallbackCode, message: fallbackMessage };
}

// ── submit ────────────────────────────────────────────────────────────────────

function inferKind(url) {
	try {
		return /\.insp$/i.test(new URL(url).pathname) ? 'insp' : 'equirect_image';
	} catch {
		return 'equirect_image';
	}
}

async function startJob(req, res) {
	const who = await requireCreator(req, res, { action: 'turn a 360 photo into a 3D scene' });
	if (!who) return;
	const rateKey = who.user ? `user:${who.user.id}` : clientIp(req);
	const rl = await limits.mcp3dGenerate(rateKey);
	refundOnServerFailure(res, () => limits.mcp3dGenerateRefund(rateKey));
	if (!rl.success) return rateLimited(res, rl, 'Photo-to-3D limit reached. Try again shortly.');

	const body = await readJson(req, 8_000).catch(() => null);
	const rawUrl = typeof body?.image_url === 'string' ? body.image_url.trim() : '';
	if (!rawUrl) {
		return json(res, 400, {
			error: 'missing_image_url',
			message: 'Pass a public https URL to a 360 photo (JPEG, PNG or .insp) as image_url.',
		});
	}

	let kind = body?.source_kind;
	if (kind == null || kind === '') kind = inferKind(rawUrl);
	if (!SOURCE_KINDS.includes(kind)) {
		return json(res, 400, {
			error: 'invalid_source_kind',
			message: 'source_kind must be "equirect_image" or "insp".',
		});
	}

	let imageUrl;
	try {
		imageUrl = await assertPublicHttpsUrl(rawUrl, HTTPS_ONLY);
	} catch (err) {
		return json(res, 400, {
			error: 'invalid_image_url',
			message: err instanceof SsrfError ? `image_url rejected: ${err.message}` : 'image_url must be a public https URL.',
		});
	}

	const cfg = workerConfig();
	if (!laneConfigured(cfg, kind)) return unconfigured(res, kind);
	if (!objectStorageConfigured()) return storageUnconfigured(res);

	const owner = who.user?.id ?? null;
	const jobId = randomUUID().replace(/-/g, '');
	const createdAt = Date.now();
	const sourceUrl = workerReadableUrl(imageUrl);

	let taskId;
	try {
		taskId =
			kind === 'insp'
				? await submitTask(cfg.stitchUrl, cfg.key, { task: 'stitch', source_url: sourceUrl, source_kind: 'insp', job_id: jobId }, 'stitch')
				: await submitTask(cfg.depthUrl, cfg.key, { image_url: sourceUrl, job_id: jobId, max_points: DEPTH_MAX_POINTS, mesh: true }, 'depth');
	} catch (err) {
		const status = Number(err?.status) || 0;
		if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
			return json(res, 422, { error: err.code || 'rejected', message: err.message });
		}
		return json(res, 502, {
			error: 'pano_scene_failed',
			message: 'The 3D server could not start this job. Try again in a minute.',
		});
	}

	const token = encodeJobToken({
		owner,
		jobId,
		kind,
		createdAt,
		stitchTaskId: kind === 'insp' ? taskId : null,
		depthTaskId: kind === 'insp' ? null : taskId,
	});
	return json(res, 202, { job_id: token, status: 'queued', stage: kind === 'insp' ? 'stitch' : 'depth', progress: 0 });
}

// ── poll ──────────────────────────────────────────────────────────────────────

function report(res, jobId, { status, stage, progress, result = null, error = null }) {
	const body = { job_id: jobId, status, stage, progress: Math.round(clamp01(progress) * 1000) / 1000 };
	if (result) body.result = result;
	if (error) body.error = error;
	return json(res, 200, body);
}

function viewerUrl(glbUrl) {
	return `/viewer?src=${encodeURIComponent(glbUrl)}&title=${encodeURIComponent('360 scene')}`;
}

function finishedReport(res, token, data) {
	if (data.error) return report(res, token, { status: 'failed', stage: 'done', progress: 1, error: data.error });
	return report(res, token, {
		status: 'succeeded',
		stage: 'done',
		progress: 1,
		result: { glb_url: data.glb_url, ply_url: data.ply_url, viewer_url: viewerUrl(data.glb_url), stats: data.stats ?? null },
	});
}

function missingTask(res, token, stage, since, progress) {
	if (Date.now() - since < TASK_MISSING_GRACE_MS) return report(res, token, { status: 'queued', stage, progress });
	return report(res, token, {
		status: 'failed',
		stage,
		progress,
		error: { code: 'task_lost', message: 'The 3D server lost track of this job, usually after a restart. Start it again.' },
	});
}

async function copyToR2(url, key, contentType) {
	let res;
	try {
		res = await fetchUpstream(url, {}, { name: 'pano-scene:copy', timeoutMs: 180_000, attempts: 2, okWhen: () => true });
	} catch (err) {
		throw Object.assign(new Error(err?.message || 'result download failed'), { transient: true });
	}
	if (!res.ok) {
		const transient = res.status === 408 || res.status === 429 || res.status >= 500;
		throw Object.assign(new Error(`result download answered ${res.status}`), {
			transient,
			code: 'result_unavailable',
			publicMessage: 'The finished scene expired on the 3D server before it could be saved. Start it again.',
		});
	}
	const declared = Number(res.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_RESULT_BYTES) throw tooLarge();
	const body = Buffer.from(await res.arrayBuffer());
	if (body.length > MAX_RESULT_BYTES) throw tooLarge();
	if (body.length === 0) {
		throw Object.assign(new Error('empty result file'), {
			code: 'empty_result',
			publicMessage: 'The 3D server returned an empty scene. Try again with a different photo.',
		});
	}
	await putObject({ key, body, contentType });
	return body.length;
}

function tooLarge() {
	return Object.assign(new Error('result too large'), {
		code: 'result_too_large',
		publicMessage: 'This scene came out too large to save. Try a smaller photo.',
	});
}

async function finalize(res, token, prefix, result) {
	if (typeof result?.glb_url !== 'string' || typeof result?.ply_url !== 'string') {
		return report(res, token, {
			status: 'failed',
			stage: 'mesh',
			progress: SAVE_START,
			error: { code: 'no_output', message: 'The 3D server finished without a scene. Try again.' },
		});
	}
	const c = await claim(`${prefix}finalize.json`, { staleMs: FINALIZE_CLAIM_STALE_MS });
	if (!c.won) return report(res, token, { status: 'running', stage: 'save', progress: 0.97 });

	const glbKey = `${prefix}scene.glb`;
	const plyKey = `${prefix}scene.ply`;
	try {
		const glbBytes = await copyToR2(result.glb_url, glbKey, 'model/gltf-binary');
		const plyBytes = await copyToR2(result.ply_url, plyKey, 'application/octet-stream');
		const workerStats = result.stats && typeof result.stats === 'object' ? result.stats : {};
		const stats = { ...workerStats, glb_bytes: glbBytes, ply_bytes: plyBytes };
		const data = { glb_url: cdnUrl(glbKey), ply_url: cdnUrl(plyKey), stats, completed_at: new Date().toISOString() };
		await writeJsonObject(`${prefix}result.json`, data);
		return finishedReport(res, token, data);
	} catch (err) {
		// A permanent fault (expired, empty or oversized result) ends the job.
		if (err?.publicMessage && !err?.transient) {
			const data = { error: { code: err.code, message: err.publicMessage } };
			await writeJsonObject(`${prefix}result.json`, data);
			return finishedReport(res, token, data);
		}
		// A transient download or storage fault: release the claim so the next
		// poll retries the copy instead of waiting out the stale window.
		await writeJsonObject(`${prefix}finalize.json`, { claimed_at: 0 }, { ifMatch: c.etag }).catch(() => null);
		return report(res, token, { status: 'running', stage: 'save', progress: SAVE_START });
	}
}

// model-panodepth names its steps download, decode, depth, export (point
// cloud and shell mesh) and upload; the page shows Depth then Mesh. A worker
// that reports no stage gets the mesh step for the tail of its run.
const MESH_STEPS = new Set(['export', 'upload', 'mesh']);
function depthWorkerStep(t) {
	if (typeof t.stage === 'string' && t.stage) return MESH_STEPS.has(t.stage) ? 'mesh' : 'depth';
	return t.progress >= 0.7 ? 'mesh' : 'depth';
}

async function advanceDepth(res, token, job, cfg, prefix, depthTaskId, since) {
	const base = job.kind === 'insp' ? STITCH_SHARE : 0;
	const span = SAVE_START - base;
	const t = await pollTask(cfg.depthUrl, cfg.key, depthTaskId, 'depth');
	if (t.kind === 'missing') return missingTask(res, token, 'depth', since, base);
	if (t.kind === 'unreachable') return report(res, token, { status: 'running', stage: 'depth', progress: base });
	if (t.status === 'failed' || t.status === 'cancelled') {
		return report(res, token, {
			status: 'failed',
			stage: 'depth',
			progress: base,
			error: taskError(t.error, 'depth_failed', 'Depth estimation failed on this photo. Try another 360 photo.'),
		});
	}
	if (t.status === 'succeeded') return finalize(res, token, prefix, t.result);
	const stage = depthWorkerStep(t);
	return report(res, token, { status: t.status, stage, progress: base + span * t.progress });
}

async function advanceStitch(res, token, job, cfg, prefix) {
	const t = await pollTask(cfg.stitchUrl, cfg.key, job.stitchTaskId, 'stitch');
	if (t.kind === 'missing') return missingTask(res, token, 'stitch', job.createdAt, 0);
	if (t.kind === 'unreachable') return report(res, token, { status: 'running', stage: 'stitch', progress: 0 });
	if (t.status === 'failed' || t.status === 'cancelled') {
		return report(res, token, {
			status: 'failed',
			stage: 'stitch',
			progress: 0,
			error: taskError(t.error, 'stitch_failed', 'This .insp file could not be stitched. Export a 360 photo from the Insta360 app and upload that instead.'),
		});
	}
	if (t.status !== 'succeeded') {
		return report(res, token, { status: t.status, stage: 'stitch', progress: STITCH_SHARE * t.progress });
	}

	const equirect = t.result?.equirect_url;
	let imageUrl;
	try {
		imageUrl = await assertPublicHttpsUrl(equirect, HTTPS_ONLY);
	} catch {
		return report(res, token, {
			status: 'failed',
			stage: 'stitch',
			progress: STITCH_SHARE,
			error: { code: 'stitch_no_output', message: 'Stitching finished without a usable 360 photo. Try again.' },
		});
	}

	const stateKey = `${prefix}state.json`;
	const c = await claim(stateKey, { staleMs: DEPTH_CLAIM_STALE_MS });
	if (!c.won) {
		if (c.data?.depth_task_id) {
			return advanceDepth(res, token, job, cfg, prefix, c.data.depth_task_id, Number(c.data.claimed_at) || job.createdAt);
		}
		return report(res, token, { status: 'running', stage: 'depth', progress: STITCH_SHARE });
	}

	let depthTaskId;
	try {
		depthTaskId = await submitTask(
			cfg.depthUrl,
			cfg.key,
			{ image_url: imageUrl, job_id: job.jobId, max_points: DEPTH_MAX_POINTS, mesh: true },
			'depth',
		);
	} catch (err) {
		const status = Number(err?.status) || 0;
		if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
			const data = { error: { code: err.code || 'depth_rejected', message: err.message } };
			await writeJsonObject(`${prefix}result.json`, data);
			return finishedReport(res, token, data);
		}
		await writeJsonObject(stateKey, { claimed_at: 0 }, { ifMatch: c.etag }).catch(() => null);
		return report(res, token, { status: 'running', stage: 'depth', progress: STITCH_SHARE });
	}
	const now = Date.now();
	await writeJsonObject(stateKey, { depth_task_id: depthTaskId, equirect_url: equirect, claimed_at: now }, { ifMatch: c.etag });
	return report(res, token, { status: 'queued', stage: 'depth', progress: STITCH_SHARE });
}

async function pollJob(req, res, token) {
	const job = decodeJobToken(token);
	if (!job) return json(res, 400, { error: 'invalid_job', message: 'That job id is not valid. Start a new scene.' });

	const rl = await limits.mcp3dStatus(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'Tool limit reached. Try again shortly.', { limit: 'tool_hourly' });

	const who = await requireCreator(req, res, { action: 'check a 360 scene' });
	if (!who) return;
	const caller = who.user?.id ?? null;
	if (caller !== job.owner) {
		return json(res, 404, { error: 'job_not_found', message: 'No scene with that id belongs to this account.' });
	}

	if (!objectStorageConfigured()) return storageUnconfigured(res);
	const prefix = jobPrefix(job.owner, job.jobId);

	const finished = await readJsonObject(`${prefix}result.json`);
	if (finished) return finishedReport(res, token, finished.data);

	const cfg = workerConfig();
	if (!laneConfigured(cfg, job.kind)) return unconfigured(res, job.kind);

	if (job.kind === 'equirect_image') return advanceDepth(res, token, job, cfg, prefix, job.depthTaskId, job.createdAt);

	const state = await readJsonObject(`${prefix}state.json`);
	if (state?.data?.depth_task_id) {
		return advanceDepth(res, token, job, cfg, prefix, state.data.depth_task_id, Number(state.data.claimed_at) || job.createdAt);
	}
	return advanceStitch(res, token, job, cfg, prefix);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'POST') return startJob(req, res);

	const url = new URL(req.url, 'http://localhost');
	const token = (url.searchParams.get('job') || '').trim();
	if (!token) {
		const cfg = workerConfig();
		const storage = objectStorageConfigured();
		return json(res, 200, {
			lanes: {
				equirect_image: storage && laneConfigured(cfg, 'equirect_image'),
				insp: storage && laneConfigured(cfg, 'insp'),
			},
		});
	}
	return pollJob(req, res, token);
});
