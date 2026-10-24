/**
 * /api/forge-scene-objects: turn one photo into a 3D scene of the objects in it
 * (SAM 3D Objects, workers/model-sam3d-objects).
 *
 *   POST /api/forge-scene-objects
 *     { image_url: string,
 *       boxes?: [[x0, y0, x1, y1], ...]   fractions of the frame, origin top-left
 *       mask_urls?: [string, ...]         one https PNG mask per object (white = object)
 *       detect?: true                     find the objects automatically (default when
 *                                         neither boxes nor mask_urls is sent)
 *       max_objects?: 1..12, seed?: int }
 *     → 202 { job_id, status, eta_seconds, source: 'boxes'|'masks'|'detected', objects: [{ label, box }] }
 *
 *   GET  /api/forge-scene-objects?job=<id>
 *     → { job_id, status, result_url?, objects?, object_count?, skipped?, error? }
 *
 * The scene GLB has one named node per object (object_01, ...) laid out like the
 * photo, and `objects` carries each node's position and size.
 *
 * Until MODEL_SAM3D_URL points at a deployed worker this answers 503
 * backend_unconfigured (the worker needs a 32 GB+ GPU). The SAM License refuses
 * comprehensively sanctioned jurisdictions, so those requests are turned away
 * before any work is queued.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { assertPublicHttpsUrl, SsrfError } from './_lib/ssrf.js';
import { createRegenProvider } from './_providers/gcp.js';
import { requestTerritory } from './_lib/forge-territory.js';
import {
	DEFAULT_SCENE_OBJECTS,
	MAX_SCENE_OBJECTS,
	detectObjectBoxes,
	isSanctionedTerritory,
	parseUserBoxes,
} from './_lib/forge-objects.js';

const JOB_ID_RE = /^[A-Za-z0-9_-]{20,600}$/;
const SEED_MAX = 4_294_967_295;

function unconfigured(res) {
	return json(res, 503, {
		error: 'backend_unconfigured',
		message:
			'Scene-from-a-photo is not switched on yet. It needs the SAM 3D Objects worker (a 32 GB+ GPU): ' +
			'deploy workers/model-sam3d-objects and set MODEL_SAM3D_URL and GCP_RECONSTRUCTION_KEY.',
	});
}

async function publicUrl(value, field, res) {
	try {
		return await assertPublicHttpsUrl(typeof value === 'string' ? value.trim() : '');
	} catch (err) {
		json(res, 400, {
			error: `invalid_${field}`,
			message: err instanceof SsrfError ? `${field} rejected: ${err.message}` : `${field} must be a public https URL.`,
		});
		return null;
	}
}

async function startJob(req, res) {
	if (isSanctionedTerritory(requestTerritory(req))) {
		return json(res, 451, {
			error: 'unavailable_in_region',
			message: 'This model is licensed to exclude comprehensively sanctioned jurisdictions, so it is not available from your region.',
		});
	}

	const rl = await limits.mcp3dGenerate(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = await readJson(req, 16_000).catch(() => null);
	if (!body || typeof body !== 'object') {
		return json(res, 400, { error: 'invalid_body', message: 'Send a JSON body with image_url.' });
	}

	let provider;
	try {
		provider = createRegenProvider();
		if (!provider.supportsMode('sam3d')) return unconfigured(res);
	} catch {
		return unconfigured(res);
	}

	const imageUrl = await publicUrl(body.image_url, 'image_url', res);
	if (!imageUrl) return undefined;

	let maxObjects = DEFAULT_SCENE_OBJECTS;
	if (body.max_objects !== undefined && body.max_objects !== null) {
		const n = Number(body.max_objects);
		if (!Number.isInteger(n) || n < 1 || n > MAX_SCENE_OBJECTS) {
			return json(res, 400, { error: 'invalid_max_objects', message: `max_objects must be an integer from 1 to ${MAX_SCENE_OBJECTS}.` });
		}
		maxObjects = n;
	}

	let seed;
	if (body.seed !== undefined && body.seed !== null) {
		const n = Number(body.seed);
		if (!Number.isInteger(n) || n < 0) {
			return json(res, 400, { error: 'invalid_seed', message: 'seed must be a non-negative integer.' });
		}
		seed = Math.min(n, SEED_MAX);
	}

	const hasMasks = Array.isArray(body.mask_urls) && body.mask_urls.length > 0;
	const hasBoxes = Array.isArray(body.boxes) && body.boxes.length > 0;
	if (hasMasks && hasBoxes) {
		return json(res, 400, { error: 'ambiguous_objects', message: 'Send mask_urls or boxes, not both.' });
	}

	const params = { seed, maxObjects };
	let source;
	let objects;
	if (hasMasks) {
		if (body.mask_urls.length > maxObjects) {
			return json(res, 400, { error: 'too_many_objects', message: `${body.mask_urls.length} masks sent but max_objects is ${maxObjects}.` });
		}
		const masks = [];
		for (const raw of body.mask_urls) {
			const url = await publicUrl(raw, 'mask_urls', res);
			if (!url) return undefined;
			masks.push(url);
		}
		params.maskUrls = masks;
		source = 'masks';
		objects = masks.map((_, i) => ({ label: `object ${i + 1}`, box: null }));
	} else {
		let boxes;
		if (hasBoxes) {
			const parsed = parseUserBoxes(body.boxes, maxObjects);
			if (parsed.error) return json(res, 400, { error: 'invalid_boxes', message: parsed.error });
			boxes = parsed.boxes.map((box, i) => ({ label: `object ${i + 1}`, box }));
			source = 'boxes';
		} else {
			try {
				boxes = await detectObjectBoxes(imageUrl, maxObjects);
			} catch (err) {
				return json(res, 502, {
					error: 'detect_failed',
					message: `Could not find objects in the photo automatically (${err?.message || 'vision unavailable'}). Send boxes or mask_urls to choose them yourself.`,
				});
			}
			if (!boxes.length) {
				return json(res, 422, {
					error: 'no_objects_found',
					message: 'No separate objects were found in the photo. Try a photo with clearer, whole objects, or send boxes to choose them yourself.',
				});
			}
			source = 'detected';
		}
		params.boxes = boxes.map((b) => b.box);
		objects = boxes;
	}

	try {
		const job = await provider.submit({ mode: 'sam3d', sourceUrl: imageUrl, params });
		return json(res, 202, { job_id: job.extJobId, status: 'queued', eta_seconds: job.eta, source, objects });
	} catch (err) {
		return json(res, 502, { error: 'sam3d_failed', message: err?.message || 'Scene reconstruction could not start.' });
	}
}

async function pollJob(req, res, jobId) {
	if (!JOB_ID_RE.test(jobId)) return json(res, 400, { error: 'invalid_job', message: 'Malformed job id.' });

	const rl = await limits.mcp3dStatus(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let provider;
	try {
		provider = createRegenProvider();
	} catch {
		return unconfigured(res);
	}

	let result;
	try {
		result = await provider.status(jobId);
	} catch (err) {
		return json(res, 502, { error: 'sam3d_status_failed', message: err?.message || 'Could not read the scene job.' });
	}
	return json(res, 200, {
		job_id: jobId,
		status: result.status,
		result_url: result.resultGlbUrl || null,
		objects: result.objects || null,
		object_count: result.objectCount ?? null,
		skipped: result.skipped || null,
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
	return pollJob(req, res, jobId);
});
