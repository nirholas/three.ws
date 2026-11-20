/**
 * /api/dad/generate — headless photo → rigged 3D avatar for the /dad page.
 *
 *   POST /api/dad/generate  { image_url: string }
 *                         → 202 { job_id, status, eta_seconds, backend }
 *
 *   GET  /api/dad/generate?job=<id>
 *                         → 200 { job_id, status, glb_url?, error? }
 *
 * Isolated from the forge pipeline: it reuses the shared, platform-configured
 * reconstruct provider (Replicate Hunyuan3D → GCP → HF, resolved by env) via
 * getRegenProvider(), which returns an image→textured-GLB on a humanoid rig.
 * No forge routing, tiers, or providers are touched.
 *
 * Making an avatar needs an account (api/_lib/creator-account.js): anonymous
 * callers get 401 sign_in_required. The page stays public and shareable; only
 * the generate call asks. Spend is bounded by a per-account limiter PLUS the
 * platform-wide cost circuit breaker whenever the resolved lane bills real
 * money (the same breaker the forge endpoint uses). Polling stays open.
 */

import { cors, json, method, readJson, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireCreator } from '../_lib/creator-account.js';
import { assertPublicHttpsUrl, SsrfError } from '../_lib/ssrf.js';
import { getRegenProvider } from '../_lib/regen-provider.js';

// Replicate prediction ids, GCP packed base64url envelopes, etc. — bounded.
const JOB_ID_RE = /^[A-Za-z0-9_=:.-]{8,512}$/;
// Lanes that bill real GPU money per generation — gated behind the
// platform-wide breaker on top of the per-IP cap.
const PAID_LANES = new Set(['replicate', 'gcp']);

function unconfigured(res) {
	return json(res, 503, {
		error: 'unconfigured',
		message:
			'The 3D avatar engine is not available right now. Set a reconstruct provider ' +
			'(REPLICATE_API_TOKEN + REPLICATE_RECONSTRUCT_MODEL, or GCP_RECONSTRUCTION_URL).',
	});
}

async function startJob(req, res) {
	const who = await requireCreator(req, res, { action: 'make a 3D avatar' });
	if (!who) return;
	const rl = await limits.mcp3dGenerate(who.user ? `user:${who.user.id}` : clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	// Let wrap() surface a genuine 413 (too large) / 415 (not JSON) instead of
	// masking either as an "invalid_image_url" 400.
	const body = await readJson(req, 8_000).catch((e) => {
		if (e?.status === 413 || e?.status === 415) throw e;
		return null;
	});

	let imageUrl;
	try {
		const raw = typeof body?.image_url === 'string' ? body.image_url.trim() : '';
		imageUrl = await assertPublicHttpsUrl(raw);
	} catch (err) {
		return json(res, 400, {
			error: 'invalid_image_url',
			message:
				err instanceof SsrfError
					? `image_url rejected: ${err.message}`
					: 'image_url must be a public https URL.',
		});
	}

	let resolved;
	try {
		resolved = await getRegenProvider();
		if (!resolved.instance || !resolved.instance.supportsMode('reconstruct')) {
			return unconfigured(res);
		}
	} catch {
		return unconfigured(res);
	}

	// Cost circuit breaker: this endpoint is unauthenticated, so the per-IP cap
	// alone doesn't bound total spend on the shared paid GPU budget.
	if (PAID_LANES.has(resolved.name)) {
		const g = await limits.mcp3dGenerateGlobal();
		if (!g.success) {
			return rateLimited(res, g, 'Paid 3D generation is at capacity right now — please try again shortly.');
		}
	}

	try {
		const job = await resolved.instance.submit({
			mode: 'reconstruct',
			sourceUrl: imageUrl,
			params: { images: [imageUrl], name: 'dad avatar' },
		});
		return json(res, 202, {
			job_id: job.extJobId,
			status: 'queued',
			eta_seconds: job.eta ?? 60,
			backend: job.backend || resolved.name || null,
		});
	} catch (err) {
		const status = err?.status >= 400 && err?.status < 600 ? err.status : 502;
		return json(res, status, {
			error: err?.code || 'reconstruct_failed',
			message: err?.message || 'The avatar job could not start.',
		});
	}
}

async function pollJob(req, res, jobId) {
	if (!JOB_ID_RE.test(jobId)) {
		return json(res, 400, { error: 'invalid_job', message: 'Malformed job id.' });
	}

	const rl = await limits.mcp3dStatus(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let provider;
	try {
		const resolved = await getRegenProvider();
		provider = resolved.instance;
		if (!provider) return unconfigured(res);
	} catch {
		return unconfigured(res);
	}

	// A transient status() throw must not 500 + ops-alert on every 2.5s poll —
	// report still-running so the client keeps polling toward its own timeout.
	let result;
	try {
		result = await provider.status(jobId);
	} catch {
		return json(res, 200, { job_id: jobId, status: 'running', glb_url: null, error: null });
	}
	result = result || {};

	// Some lanes emit a terminal "done" with no GLB + a precise error. Normalize
	// it to "failed" so the client fails fast with the real message rather than
	// waiting out its full timeout.
	const glb = result.resultGlbUrl || null;
	let status = result.status;
	if (status === 'done' && !glb) status = 'failed';

	return json(res, 200, {
		job_id: jobId,
		status,
		glb_url: glb,
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
