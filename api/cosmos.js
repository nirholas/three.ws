/**
 * /api/cosmos: generate an animated WORLD video with NVIDIA Cosmos, from text or
 * conditioned on the avatar and its scene.
 *
 *   GET  /api/cosmos
 *     → 200 { rungs:[{ id, label, kind, modes, limits, eta_seconds, configured }], modes }
 *
 *   POST /api/cosmos  { mode?: 'text'|'image'|'depth'|'edge', prompt, seed?,
 *                       resolution?: '480'|'720', num_frames?,
 *                       image?: data:image/…  (mode image: a still of the scene),
 *                       control_video?: data:video/… (mode depth|edge: a three.js render) }
 *     → 202 { job_id, status, model, queue_position, eta_seconds }
 *     → 200 { status:'done', video_url, model }        (rare synchronous completion)
 *
 *   GET  /api/cosmos?job=<id>
 *     → { job_id, model, status, step?, total_steps?, progress?, eta_seconds?,
 *         queue_position?, video_url, error_code, error, timings? }
 *
 * Generation walks the model ladder in api/_lib/cosmos-ladder.js: the
 * self-hosted Cosmos 3 Nano worker first (all four modes), then the hosted
 * predict1 routes for text worlds while NVIDIA still serves them. The job id
 * names its rung, and every rung keeps its own durable job record (the worker's
 * GCS bucket, NVCF's request store), so a poll needs only the id and a page
 * reload resumes exactly where it was. Finished worker clips land in R2 at
 * forge/cosmos/<job_id>.mp4.
 *
 * When no rung can serve (nothing configured, or every configured rung retired
 * or unreachable) the answer is 503 lane_unavailable and the page keeps its
 * designed offline state. Upstream details are operator diagnostics: they are
 * logged, never returned (NVCF details have carried the account id).
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { ALL_MODES, describeLadder, submitToLadder, pollLadderJob, rungForJob, RUNGS } from './_lib/cosmos-ladder.js';

const JOB_ID_RE = /^[A-Za-z0-9_-]{20,64}$/;
// Cloud Run caps an HTTP/1 request at 32 MiB, and base64 inflates by 4/3, so a
// scene clip above ~22 MB of video cannot arrive at all. The page records well
// under that (a 5 s 720p canvas capture is 1-4 MB).
const BODY_LIMIT_BYTES = 30 * 1024 * 1024;
const MEDIA_RE = {
	image: /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/,
	control_video: /^data:video\/(webm|mp4)(;[^,]*)?;base64,[A-Za-z0-9+/=\s]+$/,
};

// Copy per submit failure code. Validation and queue messages from the worker
// are caller-safe and replace the generic sentence when present.
const SUBMIT_COPY = {
	lane_unavailable:
		'Cosmos world generation is offline right now. Your avatar keeps its living backdrop; try again later.',
	lane_busy: 'The world GPU is busy with other worlds right now. Try again in a few minutes.',
	invalid_input: 'This request could not be used. Check the prompt and the scene capture, then try again.',
	invalid_key: 'The Cosmos lane rejected this deployment’s credentials. An operator needs to refresh the key.',
	insufficient_credits: 'The Cosmos lane is out of NVIDIA credits for now.',
	rate_limited: 'NVIDIA Cosmos is rate limiting right now.',
	provider_unreachable: 'The Cosmos lane did not answer. Try again in a moment.',
	provider_error: 'Cosmos could not start this world. Try again, or try a simpler prompt.',
};
const SUBMIT_STATUS = {
	lane_unavailable: 503,
	lane_busy: 429,
	invalid_input: 400,
	invalid_key: 401,
	insufficient_credits: 402,
	rate_limited: 429,
	provider_unreachable: 502,
	provider_error: 502,
};

// Copy per job failure code. The worker writes caller-safe messages for the
// input-shaped failures, so those pass through; the rest get a fixed sentence.
const JOB_COPY = {
	worker_restarted: 'The world GPU restarted while rendering this world. Start it again; your settings are kept.',
	timeout: 'This world ran past its time limit. Try 480p or fewer frames.',
	bad_control_video: 'The scene recording could not steer this world. Record the scene again.',
	gpu_oom: 'The GPU ran out of memory on this world. Try 480p or fewer frames.',
	bad_image: 'The scene still could not be read. Capture it again.',
	expired: 'This world is no longer stored on the generator. Start a new one.',
	generation_failed: 'Cosmos could not finish this world. Try again, or try a different prompt.',
};
const PASS_WORKER_MESSAGE = new Set(['timeout', 'bad_control_video', 'gpu_oom', 'bad_image']);

function failureResponse(res, err) {
	const code = SUBMIT_COPY[err?.code] ? err.code : 'provider_error';
	console.warn('[cosmos] submit failed (%s/%s): %s', code, err?.providerStatus ?? '-', err?.message || 'no detail');
	return json(res, SUBMIT_STATUS[code], {
		error: code,
		message: err?.userMessage || SUBMIT_COPY[code],
		...(err?.retryAfter ? { retry_after: err.retryAfter } : {}),
	});
}

function invalid(res, message) {
	return json(res, 400, { error: 'invalid_input', message });
}

// Normalize and check a POST body against what the API can see. Media decoding
// and exact geometry checks belong to the worker, which reports them as 400s.
function parseBody(body) {
	const mode = body?.mode == null ? 'text' : String(body.mode);
	if (!ALL_MODES.includes(mode)) return { error: `mode must be one of ${ALL_MODES.join(', ')}` };
	const prompt = typeof body?.prompt === 'string' ? body.prompt.replace(/\s+/g, ' ').trim() : '';
	const promptMax = Math.max(...RUNGS.filter((r) => r.modes.includes(mode)).map((r) => r.limits.prompt_max));
	if (prompt.length < 3 || prompt.length > promptMax) {
		return { error: `Describe the world in 3-${promptMax} characters (e.g. "a neon Tokyo street in the rain at night").` };
	}
	const req = { mode, prompt };
	if (body?.seed != null) {
		const seed = Number(body.seed);
		if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) return { error: 'seed must be an integer from 0 to 2147483647' };
		req.seed = seed;
	}
	if (body?.resolution != null) {
		const resolution = String(body.resolution);
		if (!['480', '720'].includes(resolution)) return { error: 'resolution must be 480 or 720' };
		req.resolution = resolution;
	}
	if (body?.num_frames != null) {
		const n = Number(body.num_frames);
		if (!Number.isInteger(n) || n < 33 || n > 121 || (n - 1) % 4 !== 0) return { error: 'num_frames must be 1 + 4k between 33 and 121' };
		req.numFrames = n;
	}
	if (mode === 'image') {
		if (typeof body?.image !== 'string' || !MEDIA_RE.image.test(body.image)) {
			return { error: 'Image worlds need a still of your scene (a PNG, JPEG or WebP data URL). Capture the scene and try again.' };
		}
		req.image = body.image;
	}
	if (mode === 'depth' || mode === 'edge') {
		if (typeof body?.control_video !== 'string' || !MEDIA_RE.control_video.test(body.control_video)) {
			return { error: `${mode === 'depth' ? 'Depth' : 'Edge'} worlds need a recording of your scene (a WebM or MP4 data URL). Record the scene and try again.` };
		}
		req.controlVideo = body.control_video;
	}
	return { req };
}

async function startJob(req, res) {
	const ip = clientIp(req);
	const rl = await limits.cosmosWorldGenerate(ip);
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try {
		body = await readJson(req, BODY_LIMIT_BYTES);
	} catch (err) {
		if (err?.status === 413) return json(res, 413, { error: 'too_large', message: 'The scene recording is too large. Record a shorter clip.' });
		return invalid(res, 'Send a JSON body.');
	}
	const parsed = parseBody(body);
	if (parsed.error) return invalid(res, parsed.error);

	const global = await limits.cosmosWorldGenerateGlobal();
	if (!global.success) return rateLimited(res, global);

	try {
		const result = await submitToLadder(parsed.req);
		if (result.done) return json(res, 200, { status: 'done', video_url: result.videoUrl, model: result.rung.id });
		return json(res, 202, {
			job_id: result.jobId,
			status: 'queued',
			model: result.rung.id,
			mode: parsed.req.mode,
			queue_position: result.queuePosition,
			eta_seconds: result.rung.etaSeconds,
		});
	} catch (err) {
		return failureResponse(res, err);
	}
}

async function pollJob(req, res, jobId) {
	if (!JOB_ID_RE.test(jobId) || !rungForJob(jobId)) {
		return json(res, 400, { error: 'invalid_job', message: 'Malformed job id.' });
	}
	const rl = await limits.mcp3dStatus(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const rung = rungForJob(jobId);
	if (!rung.configured()) {
		return json(res, 503, { error: 'lane_unavailable', message: SUBMIT_COPY.lane_unavailable });
	}

	const { diagnostic, worker_error: workerError, ...result } = await pollLadderJob(jobId);
	if (diagnostic) console.warn('[cosmos] poll %s (%s): %s', jobId, result.status, diagnostic);
	const failed = result.status === 'failed';
	const code = failed ? (JOB_COPY[result.error_code] ? result.error_code : 'generation_failed') : null;
	if (failed && workerError) console.warn('[cosmos] job %s failed (%s): %s', jobId, code, workerError);
	return json(res, 200, {
		job_id: jobId,
		...result,
		video_url: result.video_url || null,
		error_code: code,
		error: failed ? (PASS_WORKER_MESSAGE.has(code) && workerError ? workerError : JOB_COPY[code]) : null,
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'POST') return startJob(req, res);

	const url = new URL(req.url, 'http://localhost');
	const jobId = (url.searchParams.get('job') || '').trim();
	if (!jobId) return json(res, 200, describeLadder());
	return pollJob(req, res, jobId);
});
