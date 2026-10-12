// Tripo provider: alternative native geometry-first backend, on Tripo's v3 API.
//
//   geometry path → POST /generation/text-to-model
//       Native text->model: clean (often quad) geometry directly from the
//       prompt. `face_limit` carries the tier's poly budget.
//
//   image path    → POST /generation/image-to-model
//       Single-image reconstruction with PBR textures.
//
// v3 gives every capability its own endpoint (no more shared `type` field) and
// unifies every file/task source under a single `input` string: a public
// http(s) URL, a `task_id` from a prior task, or a `file_token` from /files.
// Every task type polls the same GET /tasks/{id}, returning
// {status, output, credits_consumed, created_at, completed_at}; rig-check is
// the one task whose `output` is `{riggable, rig_type}` instead of a model url.
//
// BYOK or house key: the caller passes either the user's Tripo key (tsk_...)
// or, when TRIPO_API_KEY is set, the platform's own key (forge-tiers.js /
// forge-provider-key.js resolve which one). The model version defaults to
// v3.1 and is overridable via TRIPO_MODEL_VERSION.

import { fetchUpstream } from '../_lib/upstream-fetch.js';

const TRIPO_BASE = 'https://openapi.tripo3d.com/v3';
const DEFAULT_MODEL_VERSION = 'v3.1-20260211';

// Tripo's face_limit is unbounded upward in practice, but keep the same sane
// floor/ceiling as the rest of the pipeline so a tier can't request an
// unworkable mesh.
const FACE_MIN = 100;
const FACE_MAX = 300_000;

function clampFaces(n) {
	const v = Math.round(Number(n) || 0);
	return Math.max(FACE_MIN, Math.min(FACE_MAX, v));
}

function modelVersion() {
	if (typeof process !== 'undefined' && process.env?.TRIPO_MODEL_VERSION) {
		return process.env.TRIPO_MODEL_VERSION;
	}
	return DEFAULT_MODEL_VERSION;
}

function mapStatus(s) {
	switch (String(s || '').toLowerCase()) {
		case 'queued':
			return 'queued';
		case 'running':
			return 'running';
		case 'success':
			return 'done';
		case 'failed':
		case 'cancelled':
			return 'failed';
		default:
			return 'queued';
	}
}

// Parse a data:image/...;base64,... URI into its raw bytes, mime, and the file
// extension Tripo expects. Returns null for anything that isn't a base64 image
// data URI (e.g. a plain http(s) URL), so callers can branch on it.
function parseImageDataUri(s) {
	const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/is.exec(String(s || ''));
	if (!m) return null;
	const mime = m[1].toLowerCase();
	const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
	let bytes;
	try {
		bytes = Buffer.from(m[2], 'base64');
	} catch {
		return null;
	}
	if (!bytes.length) return null;
	return { bytes, mime, ext };
}

// Every v3 error response (any status) is the unified envelope
// { code, message, suggestion, request_id }. HTTP status is advisory;
// disambiguate credits-vs-permission on 403 using the error code, since Tripo
// overloads 403 for both "no permission" and "insufficient credits".
function classify(res, data) {
	if (res.status === 401) {
		throw Object.assign(new Error(data?.message || 'Tripo rejected the API key.'), {
			code: 'invalid_key',
			status: 401,
			providerStatus: res.status,
		});
	}
	if (data?.code === 2010) {
		throw Object.assign(new Error(data?.message || 'Tripo account is out of credits.'), {
			code: 'insufficient_credits',
			status: 402,
			providerStatus: res.status,
		});
	}
	if (res.status === 403) {
		throw Object.assign(new Error(data?.message || 'Tripo rejected the API key.'), {
			code: 'invalid_key',
			status: 401,
			providerStatus: res.status,
		});
	}
	if (res.status === 429 || data?.code === 2000) {
		throw Object.assign(new Error(data?.message || 'Tripo is rate limiting this key.'), {
			code: 'rate_limited',
			status: 429,
			providerStatus: res.status,
		});
	}
	if (!res.ok || data?.code !== 0) {
		throw Object.assign(
			new Error(data?.message || `tripo returned ${res.status} (code ${data?.code})`),
			{ code: 'provider_error', status: 502, providerStatus: res.status },
		);
	}
	return data;
}

export function createTripoProvider(apiKey) {
	if (!apiKey) {
		throw Object.assign(new Error('Tripo API key is required'), { code: 'missing_key' });
	}
	const headers = {
		authorization: `Bearer ${apiKey}`,
		'content-type': 'application/json',
	};

	async function postJson(path, body) {
		let res;
		try {
			res = await fetchUpstream(`${TRIPO_BASE}${path}`, {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
			}, { name: 'tripo', timeoutMs: 30_000, attempts: 2, okWhen: () => true });
		} catch (err) {
			throw Object.assign(new Error(`tripo unreachable: ${err?.message}`), {
				code: 'provider_unreachable',
				status: 502,
			});
		}
		const data = await res.json().catch(() => ({}));
		return classify(res, data);
	}

	async function createTask(path, body) {
		const data = await postJson(path, body);
		const taskId = data?.data?.task_id;
		if (!taskId) {
			throw Object.assign(new Error('tripo accepted the task but returned no task_id'), {
				code: 'provider_error',
				status: 502,
			});
		}
		return String(taskId);
	}

	// Pushes raw bytes (a selfie data URI, a re-exported mesh, ...) through
	// Tripo's multipart /files endpoint and hands back a file_token usable as
	// `input` on any other v3 endpoint. Mirrors createTask's error
	// classification so a bad key / no credits / throttle surfaces the same
	// actionable code.
	async function uploadFile({ bytes, mime, ext }) {
		const form = new FormData();
		form.append('file', new Blob([bytes], { type: mime }), `upload.${ext}`);
		let res;
		try {
			// Let fetch set the multipart content-type (with boundary) itself, only
			// forward the bearer, never the JSON content-type from `headers`.
			res = await fetchUpstream(`${TRIPO_BASE}/files`, {
				method: 'POST',
				headers: { authorization: headers.authorization },
				body: form,
			}, { name: 'tripo', timeoutMs: 60_000, attempts: 2, okWhen: () => true });
		} catch (err) {
			throw Object.assign(new Error(`tripo upload unreachable: ${err?.message}`), {
				code: 'provider_unreachable',
				status: 502,
			});
		}
		const data = await res.json().catch(() => ({}));
		classify(res, data);
		const token = data?.data?.file_token;
		if (!token) {
			throw Object.assign(new Error('tripo upload returned no file_token'), {
				code: 'provider_error',
				status: 502,
			});
		}
		return String(token);
	}

	// Resolves an imageUrl/modelUrl into the string the v3 `input` field wants:
	// a data URI is uploaded first and replaced with its file_token; a real
	// http(s) URL (or an existing task_id/file_token) passes straight through.
	async function resolveInput(source) {
		const parsed = parseImageDataUri(source);
		if (!parsed) return source;
		return uploadFile(parsed);
	}

	// Every task type's status payload is {status, output, credits_consumed,
	// error_message} except rig-check, whose output is {riggable, rig_type}
	// instead of a model url. Surface both shapes on the same result object.
	async function status({ taskId }) {
		let res;
		try {
			res = await fetchUpstream(`${TRIPO_BASE}/tasks/${encodeURIComponent(taskId)}`, { headers }, { name: 'tripo', timeoutMs: 15_000, attempts: 2, okWhen: () => true });
		} catch (err) {
			return { status: 'running', error: `tripo poll failed: ${err?.message}` };
		}
		const data = await res.json().catch(() => ({}));
		if (res.status === 404) return { status: 'failed', error: 'tripo task not found' };
		if (!res.ok || data?.code !== 0) {
			return { status: 'running', error: `tripo returned ${res.status}` };
		}

		const d = data.data || {};
		const taskStatus = mapStatus(d.status);
		const result = { status: taskStatus, progress: Number(d.progress) || 0 };

		if (taskStatus === 'done') {
			const out = d.output || {};
			if (out.model_url) {
				result.resultGlbUrl = out.model_url;
			} else if (typeof out.riggable === 'boolean') {
				result.riggable = out.riggable;
				result.rigType = out.rig_type || null;
			} else {
				result.error = 'tripo finished but produced no model url';
			}
			if (typeof d.credits_consumed === 'number') result.creditsConsumed = d.credits_consumed;
		}
		if (taskStatus === 'failed') {
			result.error = d.error_message || `tripo task ${d.status || 'failed'}`;
		}
		return result;
	}

	return {
		// targetFaces overrides the tier's poly budget when the caller sent an
		// explicit target_polycount/target_faces (forge-options.js).
		async textToGeometry({ prompt, tier, targetPolycount: targetFaces }) {
			const taskId = await createTask('/generation/text-to-model', {
				prompt: String(prompt).slice(0, 1024),
				model: modelVersion(),
				face_limit: clampFaces(targetFaces ?? tier.polycount),
				texture: false,
				pbr: false,
			});
			return { kind: 'task', taskId };
		},

		async imageTo3d({ imageUrl, tier, targetPolycount: targetFaces }) {
			const input = await resolveInput(imageUrl);
			const taskId = await createTask('/generation/image-to-model', {
				input,
				model: modelVersion(),
				face_limit: clampFaces(targetFaces ?? tier.polycount),
				texture: true,
				pbr: Boolean(tier.pbr),
			});
			return { kind: 'task', taskId };
		},

		// One status endpoint for every task type.
		status,

		// Riggability pre-check: recommended before rig() so the UI can show
		// "not riggable" without spending a rig credit.
		async rigCheck({ input }) {
			const taskId = await createTask('/animations/rig-check', { input: await resolveInput(input) });
			return { kind: 'task', taskId };
		},

		// spec:'mixamo' asks Tripo for Mixamo-named bones, which plugs directly
		// into this repo's existing glb-canonicalize.js Mixamo mapping, no new
		// bone-naming code needed on our side.
		async rig({ input, rigType, model, spec = 'mixamo', outFormat = 'glb' }) {
			const body = { input: await resolveInput(input), spec, out_format: outFormat };
			if (rigType) body.rig_type = rigType;
			if (model) body.model = model;
			const taskId = await createTask('/animations/rig', body);
			return { kind: 'task', taskId };
		},

		async retarget({ input, animation, animations, outFormat = 'glb', bakeAnimation = true }) {
			const body = { input, out_format: outFormat, bake_animation: bakeAnimation };
			if (Array.isArray(animations) && animations.length) body.animations = animations;
			else body.animation = animation || 'preset:walk';
			const taskId = await createTask('/animations/retarget', body);
			return { kind: 'task', taskId };
		},

		// Retopology for the "game-ready" preset. v3.0 can also unwrap UVs
		// (smart_uv) in the same task; v2.0 (default) does smart highpoly-to-
		// lowpoly retopology; v1.0 is basic decimation.
		async decimate({ input, faceLimit, quad = false, smartUv = false, model = 'v2.0' }) {
			const body = { input: await resolveInput(input), model, quad: Boolean(quad) };
			if (faceLimit) body.face_limit = clampFaces(faceLimit);
			if (smartUv) body.smart_uv = true;
			const taskId = await createTask('/mesh/decimate', body);
			return { kind: 'task', taskId };
		},

		// Semantic/geometry segmentation feeding the parts editor.
		async segment({ input, model = 'v1.0-20250506' }) {
			const taskId = await createTask('/mesh/segment', { input: await resolveInput(input), model });
			return { kind: 'task', taskId };
		},

		// Exposed so callers that already have raw bytes (not an imageUrl/task_id)
		// can get a file_token without duplicating the upload logic.
		uploadFile,
	};
}
