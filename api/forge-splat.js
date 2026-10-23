/**
 * /api/forge-splat: image to 3D Gaussian splat (TripoSplat, MIT).
 *
 *   POST /api/forge-splat  { image_url: string, num_gaussians?: int }
 *     → 202 { job_id, status, eta_seconds }
 *
 *   GET  /api/forge-splat?job=<id>
 *     → { job_id, status, splat_url?, ply_url?, num_gaussians?, viewer_url?, error? }
 *
 * Routes to workers/model-triposplat (GCP Cloud Run) when MODEL_TRIPOSPLAT_URL
 * is set. The result opens in the Splat Viewer (/splat?url=...).
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { assertPublicHttpsUrl, SsrfError } from './_lib/ssrf.js';
import { createRegenProvider } from './_providers/gcp.js';

const JOB_ID_RE = /^[A-Za-z0-9_-]{20,600}$/;
export const MIN_GAUSSIANS = 8192;
export const MAX_GAUSSIANS = 262144;

function unconfigured(res) {
	return json(res, 503, {
		error: 'unconfigured',
		message:
			'Image-to-splat is not configured. Set MODEL_TRIPOSPLAT_URL and GCP_RECONSTRUCTION_KEY ' +
			'to the URL and bearer secret of your deployed workers/model-triposplat Cloud Run service.',
	});
}

export function parseNumGaussians(raw) {
	if (raw === undefined || raw === null) return { value: undefined };
	if (!Number.isInteger(raw) || raw < MIN_GAUSSIANS || raw > MAX_GAUSSIANS) {
		return { error: `num_gaussians must be an integer between ${MIN_GAUSSIANS} and ${MAX_GAUSSIANS}.` };
	}
	return { value: raw };
}

async function startJob(req, res) {
	const rl = await limits.mcp3dGenerate(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = await readJson(req, 4_000).catch(() => null);
	let imageUrl;
	try {
		imageUrl = await assertPublicHttpsUrl(typeof body?.image_url === 'string' ? body.image_url.trim() : '');
	} catch (err) {
		return json(res, 400, {
			error: 'invalid_image_url',
			message: err instanceof SsrfError ? `image_url rejected: ${err.message}` : 'image_url must be a public https URL.',
		});
	}

	const count = parseNumGaussians(body?.num_gaussians);
	if (count.error) return json(res, 400, { error: 'invalid_num_gaussians', message: count.error });

	let provider;
	try {
		provider = createRegenProvider();
		if (!provider.supportsMode('triposplat')) return unconfigured(res);
	} catch {
		return unconfigured(res);
	}

	try {
		const job = await provider.submit({
			mode: 'triposplat',
			sourceUrl: imageUrl,
			params: { num_gaussians: count.value },
		});
		return json(res, 202, { job_id: job.extJobId, status: 'queued', eta_seconds: job.eta });
	} catch (err) {
		return json(res, 502, { error: 'triposplat_failed', message: err?.message || 'Splat generation could not start.' });
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
		return json(res, 502, { error: 'triposplat_status_failed', message: err?.message || 'Could not read the splat job.' });
	}
	const splatUrl = result.resultSplatUrl || null;
	return json(res, 200, {
		job_id: jobId,
		status: result.status,
		splat_url: splatUrl,
		ply_url: result.plyUrl || null,
		num_gaussians: result.numGaussians ?? null,
		viewer_url: splatUrl ? `/splat?url=${encodeURIComponent(splatUrl)}` : null,
		error: result.error || null,
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (req.method === 'POST') return startJob(req, res);

	const jobId = (new URL(req.url, 'http://localhost').searchParams.get('job') || '').trim();
	if (!jobId) return json(res, 400, { error: 'missing_job', message: 'Pass ?job=<id> to poll.' });
	return pollJob(req, res, jobId);
});
