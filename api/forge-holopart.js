/**
 * /api/forge-holopart: complete the hidden/occluded geometry of every part
 * in an already part-segmented mesh (the output of /api/forge-segment or
 * the PartCrafter image lane).
 *
 *   POST /api/forge-holopart  { mesh_url: string, seed?: number }
 *     → 202 { job_id, status, eta_seconds }
 *
 *   GET  /api/forge-holopart?job=<id>
 *     → { job_id, status, result_url?, manifest_url?, parts?, part_count?, error? }
 *
 * Routes to workers/model-holopart (GCP Cloud Run) when MODEL_HOLOPART_URL
 * is set. mesh_url must already carry at least two named part geometries;
 * workers/segment and model-partcrafter both produce that shape.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { assertPublicHttpsUrl, SsrfError } from './_lib/ssrf.js';
import { createRegenProvider } from './_providers/gcp.js';
import { isFbxMeshUrl, HOLOPART_FBX_MESSAGE } from './_lib/mesh-input.js';

const JOB_ID_RE = /^[A-Za-z0-9_-]{20,600}$/;
const SEED_MAX = 4_294_967_295;

function unconfigured(res) {
	return json(res, 503, {
		error: 'unconfigured',
		message:
			'Hidden-part completion is not configured. Set MODEL_HOLOPART_URL and GCP_RECONSTRUCTION_KEY ' +
			'to the URL and bearer secret of your deployed workers/model-holopart Cloud Run service.',
	});
}

async function startJob(req, res) {
	const ip = clientIp(req);
	const rl = await limits.mcp3dGenerate(ip);
	if (!rl.success) {
		return rateLimited(res, rl);
	}

	const body = await readJson(req, 4_000).catch(() => null);
	const rawMeshUrl = typeof body?.mesh_url === 'string' ? body.mesh_url.trim() : '';
	let meshUrl;
	try {
		meshUrl = await assertPublicHttpsUrl(rawMeshUrl);
	} catch (err) {
		return json(res, 400, {
			error: 'invalid_mesh_url',
			message: err instanceof SsrfError ? `mesh_url rejected: ${err.message}` : 'mesh_url must be a public https URL.',
		});
	}
	if (isFbxMeshUrl(meshUrl)) {
		return json(res, 400, { error: 'unsupported_mesh_format', message: HOLOPART_FBX_MESSAGE });
	}

	let seed;
	if (body?.seed !== undefined && body?.seed !== null) {
		const n = Number(body.seed);
		if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
			return json(res, 400, { error: 'invalid_seed', message: 'seed must be a non-negative integer.' });
		}
		seed = Math.min(n, SEED_MAX);
	}

	let provider;
	try {
		provider = createRegenProvider();
		if (!provider.supportsMode('holopart')) return unconfigured(res);
	} catch {
		return unconfigured(res);
	}

	try {
		const job = await provider.submit({
			mode: 'holopart',
			sourceUrl: meshUrl,
			params: { seed },
		});
		return json(res, 202, {
			job_id: job.extJobId,
			status: 'queued',
			eta_seconds: job.eta,
		});
	} catch (err) {
		return json(res, 502, { error: 'holopart_failed', message: err?.message || 'Part completion could not start.' });
	}
}

async function pollJob(req, res, jobId) {
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

	let result;
	try {
		result = await provider.status(jobId);
	} catch (err) {
		return json(res, 502, {
			error: 'holopart_status_failed',
			message: err?.message || 'Could not read the part-completion job.',
		});
	}
	return json(res, 200, {
		job_id: jobId,
		status: result.status,
		result_url: result.resultGlbUrl || null,
		manifest_url: result.manifestUrl || null,
		parts: result.parts || null,
		part_count: result.partCount ?? null,
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
