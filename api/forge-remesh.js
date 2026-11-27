/**
 * /api/forge-remesh: mesh processing for the forge pipeline.
 *
 *   POST /api/forge-remesh  {
 *     mesh_url: string,
 *     remesh_mode?: "triangle"|"quad"|"lowpoly",
 *     operation?: "full"|"simplify"|"repair"|"convert",   // triangle mode only
 *     target_faces?: number,
 *     texture_size?: 512|1024|2048,
 *     output_format?: "glb"|"obj"|"stl"|"ply"|"usdz"|"3mf"|"fbx",
 *     compression?: "none"|"meshopt"|"draco"           // triangle GLB only
 *   } → 202 { job_id, status }   (worker job: quad, low-poly, repair, convert, non-GLB)
 *     → 200 { job_id: "opt_…", status: "done", before, after, noop, notes, requires, … }
 *       (triangle full/simplify of a GLB, optimized in this process, see below)
 *
 *   GET  /api/forge-remesh?job=<id>
 *   GET  /api/forge-remesh?job=<id>&mirror=r2  (copy a finished GLB into first-party storage;
 *     the response then carries durable:boolean and bytes)
 *     → { job_id, status, result_url?, texture_url?, face_count?, quad_ratio?, textured?, mode?, error? }
 *
 * Triangle full/simplify of a GLB runs here, through api/_lib/glb-optimize.js,
 * instead of in the worker. The worker's triangle path rebuilds the mesh in
 * open3d, which keeps positions and faces only, so its output had no UVs, no
 * material, no texture and no skin: a 2.5 MB textured model came back as a grey
 * 0.6 MB one. The in-process path decimates the glTF document itself, so the
 * texture mapping, the materials and any skeleton survive, and it refuses to
 * return a file that is not meaningfully smaller ("already light" keeps the
 * original, with no worker call). Its result and a JSON sidecar are stored under
 * forge/optimized/<hash>, and `?job=opt_<hash>` reads the sidecar back, so every
 * caller that polls keeps working unchanged. A triangle request for another
 * format is optimized here first and only converted by the worker.
 *
 * Quad, low-poly, repair and convert route to workers/remesh (GCP Cloud Run)
 * when GCP_REMESH_URL is set. Quad and low-poly rebuild the surface, so a rigged
 * model is refused there (its skeleton cannot survive) and a quad target above
 * what the source can use is clamped, each with a note.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp, refundOnServerFailure } from './_lib/rate-limit.js';
import { requireCreator } from './_lib/creator-account.js';
import { assertPublicHttpsUrl, SsrfError } from './_lib/ssrf.js';
import { createRegenProvider } from './_providers/gcp.js';
import { mirrorToR2 } from './_lib/mirror-r2.js';
import { fetchModel, FetchModelError } from './_lib/fetch-model.js';
import { putObject, publicUrl, getObjectBuffer } from './_lib/r2.js';
import {
	COMPRESSIONS,
	OPTIMIZE_LIMITS,
	OptimizeError,
	clampTarget,
	glbHeaderSummary,
	isGlb,
	optimizeGlb,
} from './_lib/glb-optimize.js';
import { createHash } from 'node:crypto';

// Provider job ids are base64url JSON envelopes (packJobId in _providers/gcp.js)
// and run several hundred chars, so a 64-char cap 400s every poll.
const JOB_ID_RE = /^[A-Za-z0-9_-]{20,600}$/;
const VALID_OPERATIONS = new Set(['full', 'simplify', 'repair', 'convert']);
const VALID_FORMATS = new Set(['glb', 'obj', 'stl', 'ply', 'usdz', '3mf', 'fbx']);
const VALID_MODES = new Set(['triangle', 'quad', 'lowpoly']);
const VALID_TEXTURE_SIZES = new Set([512, 1024, 2048]);
const OPT_JOB_RE = /^opt_[a-f0-9]{40}$/;
// Bumped whenever the optimizer's output for the same input changes, so a stored
// result from an older pipeline is never served for a new request.
const OPTIMIZE_PIPELINE = 'glb-optimize-1';
const OPTIMIZED_PREFIX = 'forge/optimized';
// The worker fetches up to 128 MB; the quad/low-poly guards read the same cap.
const WORKER_MAX_BYTES = 128 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

const mb = (n) => `${Math.round(n / 1048576)} MB`;

function unconfigured(res) {
	return json(res, 503, {
		error: 'unconfigured',
		message:
			'Mesh processing is not configured. Set GCP_REMESH_URL and GCP_RECONSTRUCTION_KEY ' +
			'to the URL and bearer secret of your deployed workers/remesh Cloud Run service.',
	});
}

async function startJob(req, res) {
	// Making something needs an account (api/_lib/creator-account.js), and the
	// generation budget is metered per account so one person cannot spread a
	// burst across addresses. A platform job without a named person keeps the IP.
	const who = await requireCreator(req, res, { action: 'remesh a 3D model' });
	if (!who) return;
	const rateKey = who.user ? `user:${who.user.id}` : clientIp(req);
	const rl = await limits.mcp3dGenerate(rateKey);
	refundOnServerFailure(res, () => limits.mcp3dGenerateRefund(rateKey));
	if (!rl.success) {
		return rateLimited(res, rl, 'Tool limit reached. Try again shortly.', { limit: 'tool_hourly' });
	}

	const body = await readJson(req, 4_000).catch(() => null);
	const rawMeshUrl = typeof body?.mesh_url === 'string' ? body.mesh_url.trim() : '';
	// Resolve + validate the host our side (rejects private/loopback/metadata IPs)
	// before handing the URL to the worker: SSRF defense in depth.
	let meshUrl;
	try {
		meshUrl = await assertPublicHttpsUrl(rawMeshUrl);
	} catch (err) {
		return json(res, 400, {
			error: 'invalid_mesh_url',
			message: err instanceof SsrfError ? `mesh_url rejected: ${err.message}` : 'mesh_url must be a public https URL.',
		});
	}

	const remeshMode = VALID_MODES.has(body?.remesh_mode) ? body.remesh_mode : 'triangle';
	const operation = VALID_OPERATIONS.has(body?.operation) ? body.operation : 'full';
	const outputFormat = VALID_FORMATS.has(body?.output_format) ? body.output_format : 'glb';
	const notes = [];
	const clamped = clampTarget(body?.target_faces);
	let targetFaces = clamped.target;
	if (clamped.note) notes.push(clamped.note);
	const textureSize = VALID_TEXTURE_SIZES.has(Number(body?.texture_size))
		? Number(body.texture_size)
		: 1024;
	const compression = COMPRESSIONS.includes(body?.compression) ? body.compression : 'none';

	// Triangle full/simplify reads the GLB here and keeps its look (see the header).
	if (remeshMode === 'triangle' && (operation === 'full' || operation === 'simplify')) {
		const local = await optimizeInProcess(res, {
			meshUrl, operation, targetFaces, textureSize, compression, outputFormat, notes, rateKey,
		});
		if (local.handled) return;
		if (local.sourceUrl) {
			// The optimized GLB only needs a format change now.
			return submitWorker(res, {
				meshUrl: local.sourceUrl, remeshMode, operation: 'convert', targetFaces, textureSize, outputFormat,
				extra: local.extra, notes,
			});
		}
		if (local.fallbackNote) notes.push(local.fallbackNote);
	}

	if (remeshMode === 'quad' || remeshMode === 'lowpoly') {
		const guarded = await guardSurfaceRebuild(res, { meshUrl, remeshMode, targetFaces, notes, rateKey });
		if (guarded.handled) return;
		targetFaces = guarded.targetFaces;
		if (guarded.before) return submitWorker(res, { meshUrl, remeshMode, operation, targetFaces, textureSize, outputFormat, notes, extra: { before: guarded.before } });
	}

	return submitWorker(res, { meshUrl, remeshMode, operation, targetFaces, textureSize, outputFormat, notes });
}

async function submitWorker(res, { meshUrl, remeshMode, operation, targetFaces, textureSize, outputFormat, notes, extra = {} }) {
	let provider;
	try {
		provider = createRegenProvider();
		if (!provider.supportsMode('remesh')) return unconfigured(res);
	} catch {
		return unconfigured(res);
	}

	try {
		const job = await provider.submit({
			mode: 'remesh',
			sourceUrl: meshUrl,
			params: {
				remesh_mode: remeshMode,
				operation,
				target_faces: targetFaces,
				texture_size: textureSize,
				output_format: outputFormat,
			},
		});
		return json(res, 202, {
			job_id: job.extJobId,
			status: 'queued',
			remesh_mode: remeshMode,
			operation,
			output_format: outputFormat,
			target_faces: targetFaces,
			eta_seconds: job.eta,
			notes,
			...extra,
		});
	} catch (err) {
		return json(res, 502, { error: 'remesh_failed', message: err?.message || 'Mesh processing could not start.' });
	}
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const objectKey = (id, suffix = '.glb') => `${OPTIMIZED_PREFIX}/${id}${suffix}`;

async function readRecord(id) {
	try {
		const buf = await getObjectBuffer(objectKey(id, '.json'));
		const record = JSON.parse(buf.toString('utf8'));
		return record?.job_id === `opt_${id}` ? record : null;
	} catch {
		return null;
	}
}

// The sidecar is written last, so a readable record means its GLBs are stored.
async function storeRecord(id, record, files = []) {
	for (const { suffix, body } of files) {
		await putObject({
			key: objectKey(id, suffix),
			body: Buffer.from(body.buffer, body.byteOffset, body.byteLength),
			contentType: 'model/gltf-binary',
			metadata: { source: 'forge-optimize' },
		});
	}
	await putObject({
		key: objectKey(id, '.json'),
		body: Buffer.from(JSON.stringify(record)),
		contentType: 'application/json',
		metadata: { source: 'forge-optimize' },
	});
}

function tooLarge(res, limitBytes, hint = '') {
	json(res, 413, {
		error: 'mesh_too_large',
		message: `This model is larger than ${mb(limitBytes)}. ${hint}`.trim(),
		limit_bytes: limitBytes,
	});
	return { handled: true };
}

async function fetchSource(res, meshUrl, maxBytes, hint) {
	try {
		return { source: await fetchModel(meshUrl, { maxBytes, timeoutMs: FETCH_TIMEOUT_MS }) };
	} catch (err) {
		if (err instanceof FetchModelError && err.code === 'file_too_large') return tooLarge(res, maxBytes, hint);
		// Any other read failure is left to the worker, which fetches the same URL
		// and reports what it saw.
		console.warn('[forge-remesh] source read failed, worker path keeps the request:', err?.code || err?.message);
		return { source: null };
	}
}

// The response (and every later poll) for a stored optimize record. Request-only
// notes, such as a clamped target, ride on the POST answer alone.
function recordResponse(record, notes = []) {
	return { ...record, notes: [...notes, ...(record.notes || [])], eta_seconds: 0 };
}

/**
 * Triangle full/simplify of a GLB, done in this process so the look survives.
 * Returns `{ handled: true }` once it has answered, `{ sourceUrl, extra }` when
 * the optimized GLB still needs a worker format conversion, or `{}` to hand the
 * request to the worker unchanged (a file that is not GLB, an unreadable
 * document, or storage that cannot hold the result), with a `fallbackNote`.
 */
async function optimizeInProcess(res, { meshUrl, operation, targetFaces, textureSize, compression, outputFormat, notes, rateKey }) {
	const { source, handled } = await fetchSource(
		res,
		meshUrl,
		OPTIMIZE_LIMITS.maxBytes,
		`Optimize keeps textures and materials on models up to ${mb(OPTIMIZE_LIMITS.maxBytes)}. Low-poly mode accepts up to ${mb(WORKER_MAX_BYTES)}.`,
	);
	if (handled) return { handled };
	if (!source) return {};
	if (!isGlb(source.bytes)) {
		return { fallbackNote: 'This file is not a GLB, so it was simplified as geometry only and its textures were not kept.' };
	}

	const id = sha256(
		`${OPTIMIZE_PIPELINE}|${sha256(source.bytes)}|${JSON.stringify({ operation, targetFaces, textureSize, compression })}`,
	).slice(0, 40);
	let record = await readRecord(id);
	const cached = Boolean(record);
	if (!record) {
		let result;
		try {
			result = await optimizeGlb(source.bytes, { targetFaces, operation, textureSize, compression });
		} catch (err) {
			if (err instanceof OptimizeError) {
				json(res, err.status, {
					error: err.code,
					message: err.message,
					limit_bytes: OPTIMIZE_LIMITS.maxBytes,
					limit_triangles: OPTIMIZE_LIMITS.maxTriangles,
				});
				return { handled: true };
			}
			console.warn('[forge-remesh] in-process optimize failed, worker path keeps the request:', err?.message);
			return { fallbackNote: 'This model could not be optimized in place, so it was simplified as geometry only and its textures were not kept.' };
		}
		const universalUrl = result.noop ? null : publicUrl(objectKey(id));
		const compressedUrl = result.compressed ? publicUrl(objectKey(id, `-${result.compression}.glb`)) : null;
		const summary = result.after || result.before;
		record = {
			job_id: `opt_${id}`,
			status: 'done',
			noop: result.noop,
			reason: result.reason,
			result_url: result.noop ? meshUrl : universalUrl,
			universal_url: result.noop ? meshUrl : universalUrl,
			compressed_url: compressedUrl,
			compression: result.compression,
			requires: result.requires,
			face_count: summary.triangles,
			textured: summary.textures.length > 0,
			quad_ratio: null,
			texture_url: null,
			mode: 'triangle',
			remesh_mode: 'triangle',
			operation,
			output_format: 'glb',
			target_faces: targetFaces,
			before: result.before,
			after: result.after,
			notes: result.notes,
			source_url: meshUrl,
			error: null,
		};
		const files = [];
		if (result.universal) files.push({ suffix: '.glb', body: result.universal });
		if (result.compressed) files.push({ suffix: `-${result.compression}.glb`, body: result.compressed });
		try {
			await storeRecord(id, record, files);
		} catch (err) {
			console.warn('[forge-remesh] optimize result could not be stored, worker path keeps the request:', err?.message);
			return { fallbackNote: 'Storage was unavailable, so the model was simplified as geometry only and its textures were not kept.' };
		}
	}

	// Nothing ran on a GPU, so the request gives its hourly allowance back.
	if (record.noop || cached) await refundQuietly(rateKey);

	if (outputFormat !== 'glb') {
		return {
			sourceUrl: record.universal_url,
			extra: { optimize_job_id: record.job_id, noop: record.noop, before: record.before, after: record.after, optimize_notes: record.notes },
		};
	}
	json(res, 200, recordResponse(record, notes));
	return { handled: true };
}

async function refundQuietly(rateKey) {
	try {
		await limits.mcp3dGenerateRefund(rateKey);
	} catch (err) {
		console.warn('[forge-remesh] allowance refund failed:', err?.message);
	}
}

/**
 * Quad and low-poly rebuild the whole surface, so they cannot keep a skeleton,
 * and asking for more faces than the source has only inflates it. Refuse the
 * first, clamp or skip the second, before a worker job is queued.
 */
async function guardSurfaceRebuild(res, { meshUrl, remeshMode, targetFaces, notes, rateKey }) {
	const { source, handled } = await fetchSource(res, meshUrl, WORKER_MAX_BYTES, `The mesh worker accepts models up to ${mb(WORKER_MAX_BYTES)}.`);
	if (handled) return { handled };
	const header = source && glbHeaderSummary(source.bytes);
	if (!header) return { targetFaces };
	if (header.skins > 0) {
		json(res, 422, {
			error: 'rigged_model',
			message: `This model is rigged (${header.joints} bones). ${remeshMode === 'quad' ? 'Quad retopology' : 'Low-poly'} rebuilds the surface and would drop the skeleton, so use Triangle mode, which keeps the rig and skin.`,
		});
		return { handled: true };
	}
	let target = targetFaces;
	let noopReason = null;
	if (remeshMode === 'quad') {
		// One quad covers two triangles: a quad target above half the source
		// triangle count adds faces instead of removing them.
		const most = Math.floor(header.triangles / 2);
		if (most < OPTIMIZE_LIMITS.minTargetFaces) {
			noopReason = `This model is already light (${header.triangles.toLocaleString('en-US')} triangles). A quad retopology would add faces, so the original is kept.`;
		} else if (target > most) {
			notes.push(`The quad target was lowered to ${most.toLocaleString('en-US')}, half the model's ${header.triangles.toLocaleString('en-US')} triangles, so the result is not heavier than the original.`);
			target = most;
		}
	} else if (header.triangles <= target) {
		noopReason = `This model is already light (${header.triangles.toLocaleString('en-US')} triangles, at or under the ${target.toLocaleString('en-US')} target). The original is kept.`;
	}
	if (!noopReason) return { targetFaces: target, before: { bytes: source.bytes.byteLength, triangles: header.triangles } };

	const id = sha256(`${OPTIMIZE_PIPELINE}|${sha256(source.bytes)}|${remeshMode}|${target}`).slice(0, 40);
	const record = {
		job_id: `opt_${id}`,
		status: 'done',
		noop: true,
		reason: noopReason,
		result_url: meshUrl,
		universal_url: meshUrl,
		compressed_url: null,
		compression: 'none',
		requires: [],
		face_count: header.triangles,
		textured: null,
		quad_ratio: null,
		texture_url: null,
		mode: remeshMode,
		remesh_mode: remeshMode,
		operation: 'full',
		output_format: 'glb',
		target_faces: target,
		before: { bytes: source.bytes.byteLength, triangles: header.triangles, skins: 0 },
		after: null,
		notes: [],
		source_url: meshUrl,
		error: null,
	};
	try {
		await storeRecord(id, record);
	} catch (err) {
		// Without storage there is no pollable record, so the worker keeps the job.
		console.warn('[forge-remesh] no-op record could not be stored, worker path keeps the request:', err?.message);
		return { targetFaces: target };
	}
	await refundQuietly(rateKey);
	json(res, 200, recordResponse(record, notes));
	return { handled: true };
}

async function pollOptimized(req, res, jobId, { mirror }) {
	const rl = await limits.mcp3dStatus(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const record = await readRecord(jobId.slice(4));
	if (!record) {
		return json(res, 404, {
			error: 'job_not_found',
			status: 'failed',
			message: 'This optimize result is no longer stored. Run Optimize again.',
		});
	}
	// A stored result is already first-party. A no-op points at the caller's own
	// source, which forge-in-world still needs copied into storage it accepts.
	if (mirror) {
		if (!record.noop) return json(res, 200, { ...recordResponse(record), durable: true, bytes: record.after?.bytes ?? null });
		const key = `forge/world-props/${sha256(jobId).slice(0, 24)}.glb`;
		const mirrored = await mirrorToR2(record.result_url, key, 'glb');
		return json(res, 200, { ...recordResponse(record), result_url: mirrored.url, durable: mirrored.durable, bytes: mirrored.bytes });
	}
	return json(res, 200, recordResponse(record));
}

async function pollJob(req, res, jobId, { mirror = false } = {}) {
	if (OPT_JOB_RE.test(jobId)) return pollOptimized(req, res, jobId, { mirror });
	if (!JOB_ID_RE.test(jobId)) {
		return json(res, 400, { error: 'invalid_job', message: 'Malformed job id.' });
	}

	const rl = await limits.mcp3dStatus(clientIp(req));
	if (!rl.success) {
		return rateLimited(res, rl);
	}

	let provider;
	try {
		provider = createRegenProvider();
	} catch {
		return unconfigured(res);
	}

	// Poll is an outbound call to the worker, so it gets the same boundary guard
	// as submit. Without it an upstream fault escapes to wrap() as a 500, and
	// because clients poll every couple of seconds one worker outage pages ops
	// once per poll per client instead of once. A 502 with no `status` field
	// leaves the client's poll loop retrying, which is what a transient fault
	// deserves.
	let result;
	try {
		result = await provider.status(jobId);
	} catch (err) {
		return json(res, 502, {
			error: 'remesh_status_failed',
			message: err?.message || 'Could not read the mesh-processing job.',
		});
	}
	// Opt-in first-party copy (forge-in-world): the room's asset allow-list refuses
	// the worker's own URL, so a world-bound GLB is mirrored into our storage and
	// the response says whether that copy landed. The key is derived from the job
	// id so a repeated poll overwrites the same object instead of orphaning copies.
	let resultUrl = result.resultGlbUrl || null;
	let mirrored = null;
	if (mirror && result.status === 'done' && resultUrl) {
		const key = `forge/world-props/${createHash('sha256').update(jobId).digest('hex').slice(0, 24)}.glb`;
		mirrored = await mirrorToR2(resultUrl, key, 'glb');
		resultUrl = mirrored.url;
	}
	return json(res, 200, {
		job_id: jobId,
		status: result.status,
		result_url: resultUrl,
		...(mirrored ? { durable: mirrored.durable, bytes: mirrored.bytes } : {}),
		texture_url: result.textureUrl || null,
		face_count: typeof result.faceCount === 'number' ? result.faceCount : null,
		quad_ratio: typeof result.quadRatio === 'number' ? result.quadRatio : null,
		textured: typeof result.textured === 'boolean' ? result.textured : null,
		mode: result.mode || null,
		error: result.error || null,
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'POST') return startJob(req, res);

	const url = new URL(req.url, 'http://localhost');
	const jobId = (url.searchParams.get('job') || '').trim();
	if (!jobId) return json(res, 400, { error: 'missing_job', message: 'Pass ?job=<id> to poll.' });
	return pollJob(req, res, jobId, { mirror: url.searchParams.get('mirror') === 'r2' });
});
