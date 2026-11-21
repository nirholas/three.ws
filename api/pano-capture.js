/**
 * /api/pano-capture: 360 footage to a Gaussian splat scene, as a persistent job.
 *
 *   POST   /api/pano-capture
 *     { source_url, source_urls?, source_kind: "equirect_video"|"equirect_images"|"insv",
 *       trim?: { start_s, end_s }, quality?: "preview"|"standard"|"high" }
 *                                   -> 202 { job_id, status, eta_seconds }
 *   GET    /api/pano-capture?job=<id>  -> { job_id, status, stage, progress, result?, error? }
 *   GET    /api/pano-capture?mine=1    -> { captures: [...] } newest first, the caller's own
 *   DELETE /api/pano-capture?job=<id>  -> cancels an active job or deletes a finished one
 *
 * Contract C4 in prompts/finish/_context/insta360-00-CONTEXT.md; the worker is
 * workers/model-pano2splat (contract C1) at GCP_PANO2SPLAT_URL. Jobs live in
 * pano_captures and belong to the account that made them; finished files are
 * copied into our bucket so they outlive the worker's 7-day URLs. Logic lives
 * in api/_lib/pano-capture.js, docs in docs/api-reference.md and docs/capture.md.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits } from './_lib/rate-limit.js';
import { requireCreator, resolveCreator, signInRequired } from './_lib/creator-account.js';
import { validatePublicUrl, resolvePublicHost, SsrfError } from './_lib/ssrf.js';
import {
	SOURCE_KINDS,
	QUALITIES,
	MAX_ACTIVE_PER_USER,
	ACTIVE_STATUSES,
	workerConfig,
	captureConfigured,
	createCapture,
	getOwnedJob,
	listOwnedJobs,
	syncJob,
	removeJob,
	etaSeconds,
	publicJob,
	publicListItem,
	WorkerError,
} from './_lib/pano-capture.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_URL_LEN = 4096;
// Matches the `high` preset's frame budget (contract C1): more photos than
// that would be subsampled away by the worker anyway.
const MAX_IMAGES = 600;
const MIN_IMAGES = 3;
// A split-pair recording is two .insv files, one per lens.
const MAX_INSV_FILES = 2;
const VIDEO_KINDS = new Set(['equirect_video', 'insv']);

// The 503 body is shown to visitors, so `message` is for them; `hint` is for
// the operator and is never rendered.
function unconfigured(res) {
	return json(res, 503, {
		error: 'unconfigured',
		message: '360 capture is offline on this deployment, so footage cannot be turned into a 3D scene right now.',
		hint:
			'Set GCP_PANO2SPLAT_URL and GCP_RECONSTRUCTION_KEY to the URL and bearer secret of the deployed ' +
			'workers/model-pano2splat Cloud Run service, and configure S3_* object storage for the saved results.',
	});
}

const bad = (res, error, message, status = 400) => json(res, status, { error, message });

/**
 * Validate the request body into a job source, or answer 400 and return null.
 * Every URL is scheme-checked and every distinct host is resolved and refused
 * if it points at a private, loopback or metadata address.
 */
async function parseSource(res, body) {
	const sourceKind = body?.source_kind;
	if (sourceKind === 'insp') {
		return (
			bad(
				res,
				'unsupported_source_kind',
				'A single raw .insp photo has no camera movement to build a splat from. Send it to /api/pano-scene ' +
					'(source_kind "insp") to step inside it as a depth scene, or capture a 360 video or several photos.',
			),
			null
		);
	}
	if (!SOURCE_KINDS.includes(sourceKind)) {
		return bad(res, 'invalid_source_kind', `source_kind must be one of ${SOURCE_KINDS.join(', ')}.`), null;
	}

	let urls = [];
	if (body?.source_urls != null) {
		if (!Array.isArray(body.source_urls) || body.source_urls.some((u) => typeof u !== 'string' || !u.trim())) {
			return bad(res, 'invalid_source_urls', 'source_urls must be a list of https URLs.'), null;
		}
		urls = body.source_urls.map((u) => u.trim());
	}
	let sourceUrl = typeof body?.source_url === 'string' ? body.source_url.trim() : '';
	if (!sourceUrl && urls.length) sourceUrl = urls[0];
	if (!sourceUrl) {
		return bad(res, 'missing_source_url', 'Pass the uploaded file as source_url (a public https URL).'), null;
	}

	if (sourceKind === 'equirect_images') {
		const set = urls.length ? urls : [sourceUrl];
		if (set.length < MIN_IMAGES) {
			return bad(res, 'too_few_images', `A scene needs at least ${MIN_IMAGES} 360 photos taken from different spots. Pass them as source_urls.`), null;
		}
		if (set.length > MAX_IMAGES) {
			return bad(res, 'too_many_images', `Pass at most ${MAX_IMAGES} 360 photos per capture.`), null;
		}
		urls = set;
	} else if (sourceKind === 'insv') {
		if (urls.length > MAX_INSV_FILES) {
			return bad(res, 'too_many_files', 'A raw .insv recording is one file, or two for a split-pair recording.'), null;
		}
	} else if (urls.length > 1) {
		return bad(res, 'too_many_files', 'A 360 video is a single file: pass it as source_url.'), null;
	} else {
		urls = [];
	}

	const all = [...new Set([sourceUrl, ...urls])];
	const hosts = new Map();
	for (const raw of all) {
		if (raw.length > MAX_URL_LEN) return bad(res, 'invalid_source_url', 'A source URL is too long.'), null;
		try {
			const u = validatePublicUrl(raw, { allowHttp: false });
			hosts.set(u.hostname, raw);
		} catch (err) {
			return bad(res, 'invalid_source_url', `Source URL rejected: ${err instanceof SsrfError ? err.message : 'must be a public https URL'}.`), null;
		}
	}
	for (const [host] of hosts) {
		try {
			await resolvePublicHost(host);
		} catch (err) {
			return bad(res, 'invalid_source_url', `Source URL rejected: ${err instanceof SsrfError ? err.message : 'host could not be resolved'}.`), null;
		}
	}

	let trim = null;
	if (body?.trim != null) {
		if (!VIDEO_KINDS.has(sourceKind)) {
			return bad(res, 'invalid_trim', 'trim applies to video footage only (equirect_video or insv).'), null;
		}
		const start = Number(body.trim.start_s ?? 0);
		const end = body.trim.end_s == null ? null : Number(body.trim.end_s);
		if (!Number.isFinite(start) || start < 0 || (end != null && (!Number.isFinite(end) || end <= start))) {
			return bad(res, 'invalid_trim', 'trim needs start_s >= 0 and, when given, end_s greater than start_s (seconds).'), null;
		}
		trim = end == null ? { start_s: start } : { start_s: start, end_s: end };
	}

	const quality = body?.quality == null ? 'standard' : body.quality;
	if (!QUALITIES.includes(quality)) {
		return bad(res, 'invalid_quality', `quality must be one of ${QUALITIES.join(', ')}.`), null;
	}

	return {
		source_kind: sourceKind,
		source_url: new URL(sourceUrl).href,
		source_urls: urls.length ? urls.map((u) => new URL(u).href) : null,
		trim,
		quality,
	};
}

async function owner(req, res) {
	const who = await resolveCreator(req, res);
	if (who.user?.id && UUID_RE.test(String(who.user.id))) return who.user;
	signInRequired(res, { action: 'see your 360 captures' });
	return null;
}

async function startJob(req, res) {
	const who = await requireCreator(req, res, { action: 'turn 360 footage into a 3D scene', allowPlatform: false });
	if (!who) return;
	if (!UUID_RE.test(String(who.user.id))) return signInRequired(res, { action: 'turn 360 footage into a 3D scene' });
	const rl = await limits.mcp3dGenerate(`user:${who.user.id}`);
	if (!rl.success) return rateLimited(res, rl, 'Capture limit reached. Try again shortly.');

	const body = await readJson(req, 1_500_000).catch(() => null);
	if (!body || typeof body !== 'object') return bad(res, 'invalid_body', 'Send a JSON body with source_url and source_kind.');
	const source = await parseSource(res, body);
	if (!source) return;

	const cfg = workerConfig();
	if (!cfg || !captureConfigured()) return unconfigured(res);

	const out = await createCapture(cfg, who.user.id, source);
	if (out.limited) {
		return json(res, 429, {
			error: 'too_many_active',
			message: `You already have ${MAX_ACTIVE_PER_USER} captures processing. Wait for one to finish or cancel it, then start this one.`,
		});
	}
	if (out.retryable) {
		return json(res, 503, { error: out.error.code, message: out.error.message }, { 'retry-after': '120' });
	}
	if (out.error) {
		// The worker's own code and message, unchanged; its 4xx means the footage
		// was refused, anything else that the worker is unavailable.
		const status = out.status >= 400 && out.status < 500 ? 422 : 502;
		return json(res, status, { error: out.error.code, message: out.error.message, job_id: out.row.id });
	}
	return json(res, 202, { job_id: out.row.id, status: out.row.status, eta_seconds: etaSeconds(out.row.quality) });
}

async function pollJob(req, res, user, jobId) {
	let row = await getOwnedJob(user.id, jobId);
	if (!row) return bad(res, 'not_found', 'No capture with that id belongs to this account.', 404);
	const cfg = workerConfig();
	if (cfg && ACTIVE_STATUSES.includes(row.status)) row = await syncJob(cfg, row);
	return json(res, 200, publicJob(row), { 'cache-control': 'no-store' });
}

async function listMine(req, res, user, url) {
	const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50));
	const rows = await listOwnedJobs(user.id, limit);
	return json(res, 200, { captures: rows.map(publicListItem) }, { 'cache-control': 'no-store' });
}

async function deleteJob(req, res, user, jobId) {
	const row = await getOwnedJob(user.id, jobId);
	if (!row) return bad(res, 'not_found', 'No capture with that id belongs to this account.', 404);
	try {
		const out = await removeJob(workerConfig(), row);
		return json(res, 200, { job_id: row.id, ...out });
	} catch (err) {
		if (err instanceof WorkerError) return json(res, 502, { error: err.code, message: err.message });
		return bad(res, 'cancel_failed', 'The capture could not be cancelled right now. Try again in a moment.', 502);
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	if (req.method === 'POST') return startJob(req, res);

	const url = new URL(req.url, 'http://localhost');
	const user = await owner(req, res);
	if (!user) return;
	const rl = await limits.mcp3dStatus(`user:${user.id}`);
	if (!rl.success) return rateLimited(res, rl);

	if (req.method === 'GET' && url.searchParams.get('mine')) return listMine(req, res, user, url);

	const jobId = (url.searchParams.get('job') || '').trim();
	if (!jobId) return bad(res, 'missing_job', 'Pass ?job=<id> for one capture, or ?mine=1 for your captures.');
	if (!UUID_RE.test(jobId)) return bad(res, 'invalid_job', 'Malformed capture id.');
	return req.method === 'DELETE' ? deleteJob(req, res, user, jobId) : pollJob(req, res, user, jobId);
});
