// Forge submit observer: counts every generation POST by how it ended, most of
// all the ones that ended before a job existed.
//
// The lane counters (forge-events.js recordGenerationEvent, /api/nvidia/stats)
// only see jobs. A request refused by a limiter, or one whose reference image
// could not be painted, never created a forge_creations row, so it showed up in
// no failure count, no dashboard and no alert. On 2026-11-26 text prompts were
// failing at the reference image step all day while the lane rate read 93%.
//
// Rather than one recording call at each of the ~45 exits in api/forge.js (and
// another for every exit added later), the observer watches the one thing every
// exit shares: the response. It wraps res.end, lets the response go out first,
// then classifies status + body + the submit trace (the stage the handler
// marked and the last provider error it caught) and records the outcome fire
// and forget. A store outage or a slow store changes nothing for the caller.

import {
	newSubmitTrace,
	recordSubmitOutcome,
	runWithSubmitTrace,
} from './forge-events.js';

// Stages, in request order. `gate` is everything before provider work starts
// that is not one of the named checks (routing, the result cache, coalescing).
//   sign_in     the account check in the handler (refusals are not "accepted")
//   input       the request itself is invalid (prompt, images, options, keys)
//   access      a hold, payment, credit or BYOK-key gate refused
//   rate_limit  a platform limiter or daily cap refused before any work
//   image_check the uploaded photo failed the reconstructability check
//   direction   the LLM prompt rewrite (fail-soft: only an unexpected throw ends here)
//   reference   painting the reference image for a text prompt
//   views       painting the extra turnaround views (fail-soft)
//   submit      handing the job to a 3D lane
export const SUBMIT_STAGES = Object.freeze([
	'sign_in',
	'input',
	'access',
	'rate_limit',
	'image_check',
	'gate',
	'direction',
	'reference',
	'views',
	'submit',
]);

// Stages the handler marks once provider work has begun. A failure there is the
// work's, even when its response code reads like a gate (a provider's 429).
const WORK_STAGES = new Set(['direction', 'reference', 'views', 'submit']);

// Response codes that name their own stage wherever they happen.
const CODE_STAGE = {
	sign_in_required: 'sign_in',
	invalid_options: 'input',
	invalid_world: 'input',
	invalid_prompt: 'input',
	invalid_image_url: 'input',
	invalid_image_urls: 'input',
	invalid_view_labels: 'input',
	invalid_fill_other_sides: 'input',
	missing_sketch: 'input',
	backend_text_only: 'input',
	region_restricted: 'input',
	invalid_idempotency_key: 'input',
	idempotency_key_reused: 'input',
	image_not_usable: 'image_check',
	three_hold_required: 'access',
	payment_invalid: 'access',
	payment_already_used: 'access',
	insufficient_credits: 'access',
	needs_key: 'access',
	invalid_key: 'access',
	invalid_api_key: 'access',
	unauthorized: 'access',
	insufficient_scope: 'access',
	daily_limit_reached: 'rate_limit',
};

// Who refused, read from the provider error's own words. The image and lane
// clients name themselves at the start of their messages ("pollinations timed
// out", "hf flux-schnell unreachable", "nim flux withheld the image").
const PROVIDER_PATTERNS = [
	[/pollinations/i, 'pollinations'],
	[/wavespeed/i, 'wavespeed'],
	[/livepeer/i, 'livepeer'],
	[/replicate/i, 'replicate'],
	[/vertex|imagen|gemini/i, 'vertex'],
	[/\bhf\b|hugging ?face/i, 'huggingface'],
	[/\bnim\b|nvidia|nvcf/i, 'nvidia'],
	[/triposg/i, 'triposg'],
	[/hunyuan/i, 'hunyuan3d'],
	[/trellis/i, 'trellis'],
];

function providerFrom(error, body) {
	if (error?.provider) return error.provider;
	const text = error?.message || '';
	for (const [re, id] of PROVIDER_PATTERNS) if (re.test(text)) return id;
	// A lane refusal names its backend on the response.
	if (typeof body?.backend === 'string' && body.backend) return body.backend;
	if (typeof body?.provider === 'string' && body.provider) return body.provider;
	return null;
}

function statedWait(body, retryAfterHeader) {
	const fromBody = Number(body?.retry_after);
	if (Number.isFinite(fromBody) && fromBody > 0) return fromBody;
	const fromHeader = Number(retryAfterHeader);
	return Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : null;
}

function stageFor(status, code, trace) {
	const named = CODE_STAGE[code];
	// A provider's own throttle inside the work reads `rate_limited`; the stage
	// is where it happened, not the platform limiter.
	if (named && !(named === 'rate_limit' && WORK_STAGES.has(trace?.stage))) return named;
	if (WORK_STAGES.has(trace?.stage)) return trace.stage;
	if (code === 'rate_limited' || status === 429) return 'rate_limit';
	if (status === 401 || status === 402 || status === 403) return 'access';
	if (status === 400 || status === 413 || status === 415 || status === 422) return 'input';
	return trace?.stage || 'gate';
}

/**
 * Pure: how one generation POST ended.
 * @returns {{ outcome: 'job'|'delivered'|'failed'|'sign_in'|'replay'|'duplicate',
 *   stage?: string, cause?: string, provider?: string|null, retryAfterS?: number|null,
 *   upstreamStatus?: number|null }}
 *   replay and duplicate are not counted: the original request already was.
 */
export function classifySubmitExit({ status, body = null, trace = null, replayed = false, retryAfterHeader = null }) {
	if (replayed) return { outcome: 'replay' };
	const code = typeof body?.error === 'string' ? body.error : null;
	if (code === 'idempotency_in_progress') return { outcome: 'duplicate' };

	if (status >= 200 && status < 300) {
		if (trace?.jobCreated || body?.job_id || body?.creation_id) return { outcome: 'job' };
		if (body?.glb_url) return { outcome: 'delivered' };
		return { outcome: 'job' };
	}
	// The row exists, so the lane counters own this outcome (markFailed counts
	// it when the row flips). Counting it here too would count it twice.
	if (trace?.jobCreated) return { outcome: 'job' };

	const stage = stageFor(status, code, trace);
	const error = trace?.error || null;
	return {
		outcome: stage === 'sign_in' ? 'sign_in' : 'failed',
		stage,
		cause: code || `http_${status}`,
		provider: WORK_STAGES.has(stage) ? providerFrom(error, body) : null,
		retryAfterS: statedWait(body, retryAfterHeader),
		upstreamStatus: error?.providerStatus ?? null,
	};
}

function parseBody(chunk) {
	if (chunk == null || typeof chunk === 'function') return null;
	try {
		return JSON.parse(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
	} catch {
		return null;
	}
}

function header(res, name) {
	try {
		return typeof res.getHeader === 'function' ? res.getHeader(name) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Watch one generation POST. Install before the sign-in check so its refusal is
 * seen too, then run the submit through `run` so the handler's stage marks land
 * on this request's trace.
 * @param {import('http').ServerResponse} res
 * @param {{ internal?: boolean, record?: typeof recordSubmitOutcome }} [opts]
 *   internal: a platform showcase seed job (logged, never counted).
 */
export function observeForgeSubmit(res, { internal = false, record = recordSubmitOutcome } = {}) {
	const trace = newSubmitTrace();
	const end = res.end;
	let seen = false;
	res.end = function observedEnd(chunk, ...rest) {
		const out = end.call(this, chunk, ...rest);
		if (!seen) {
			seen = true;
			try {
				const exit = classifySubmitExit({
					status: res.statusCode,
					body: parseBody(chunk),
					trace,
					replayed: header(res, 'idempotent-replayed') === 'true',
					retryAfterHeader: header(res, 'retry-after'),
				});
				if (exit.outcome !== 'replay' && exit.outcome !== 'duplicate') {
					Promise.resolve(
						record({ ...exit, httpStatus: res.statusCode, internal }),
					).catch(() => {});
				}
			} catch {
				/* observing must never break a response */
			}
		}
		return out;
	};
	return {
		trace,
		run: (fn) => runWithSubmitTrace(trace, fn),
	};
}
