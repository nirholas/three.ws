/**
 * /api/forge-motion — text → animation clip for the forge/avatar pipeline.
 *
 *   POST /api/forge-motion  {
 *     prompt: string,            // "waving confidently", "a slow tai-chi sweep"
 *     duration_seconds?: number, // 1–10, default 4
 *     fps?: number               // 8–60, default 30
 *   } → 202 { job_id, status, eta_seconds, note }
 *   400 invalid_prompt (empty, no words, one key held down) is checked before
 *   the allowance is charged; a 5xx (unconfigured, submit failed) refunds it.
 *
 *   GET  /api/forge-motion?job=<id>
 *     → { job_id, status, clip_url?, frames?, fps?, error? }
 *
 * The worker (workers/model-text2motion) samples a motion-diffusion model and
 * returns a three.js AnimationClip JSON on the canonical Wolf3D skeleton — the
 * SAME format the curated animation library serves — so the client retargets a
 * generated clip onto a loaded avatar with the existing engine
 * (src/animation-retarget.js), identical to a preset. Routes to the worker via
 * the GCP provider's `text2motion` mode when GCP_TEXT2MOTION_URL is set.
 *
 * Tripo (and the rest of the field) cannot generate animation from a prompt —
 * this is the differentiating capability, reusing our rig + retarget + library.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp, refundOnServerFailure } from './_lib/rate-limit.js';
import { requireCreator } from './_lib/creator-account.js';
import { createRegenProvider } from './_providers/gcp.js';
import { fetchUpstream } from './_lib/upstream-fetch.js';
import { libraryReadyClip } from './_lib/motion-seed.js';
import { checkMotionPrompt } from '../src/motion-prompt-check.js';

// Provider job ids are base64url JSON envelopes (packJobId in _providers/gcp.js)
// and run several hundred chars — a 64-char cap 400s every poll.
const JOB_ID_RE = /^[A-Za-z0-9_-]{20,600}$/;
const MAX_DURATION = 10;
const MIN_DURATION = 1;

function unconfigured(res) {
	return json(res, 503, {
		error: 'unconfigured',
		message:
			'Text-to-animation is not configured. Set GCP_TEXT2MOTION_URL and GCP_RECONSTRUCTION_KEY ' +
			'to the URL and bearer secret of your deployed workers/model-text2motion Cloud Run service.',
	});
}

async function startJob(req, res) {
	// Making something needs an account (api/_lib/creator-account.js), and the
	// generation budget is metered per account so one person cannot spread a
	// burst across addresses. A platform job without a named person keeps the IP.
	const who = await requireCreator(req, res, { action: 'make an animation' });
	if (!who) return;
	const rateKey = who.user ? `user:${who.user.id}` : clientIp(req);
	// Read and check the prompt before charging: a refusal costs nothing.
	const body = await readJson(req, 4_000).catch(() => null);
	const checked = checkMotionPrompt(body?.prompt);
	if (!checked.ok) {
		return json(res, 400, { error: 'invalid_prompt', reason: checked.reason, message: checked.message });
	}
	const { prompt, note } = checked;
	// The free-lane bucket, not the paid one. This endpoint has exactly one
	// backend: the self-hosted text2motion worker behind GCP_TEXT2MOTION_URL,
	// which is our own Cloud Run GPU service. There is no vendor fallback: with
	// the URL unset the mode is honestly unsupported and the request 503s, so a
	// call here can never bill a third party, and metering it against the paid
	// ceiling (30/h, fail-closed) throttled our own GPU fleet to a fifth of what
	// it sustains and blocked bulk library seeding outright.
	const rl = await limits.mcp3dGenerateFree(rateKey);
	if (!rl.success) {
		return rateLimited(res, rl);
	}
	// Charged up front; handed back when the job never starts (a 5xx: worker
	// unconfigured or the submit failed), so a failure never costs a generation.
	refundOnServerFailure(res, () => limits.mcp3dGenerateFreeRefund(rateKey));

	const duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, Number(body?.duration_seconds) || 4));
	const fps = Math.max(8, Math.min(60, Number(body?.fps) || 30));

	let provider;
	try {
		provider = createRegenProvider();
		if (!provider.supportsMode('text2motion')) return unconfigured(res);
	} catch {
		return unconfigured(res);
	}

	try {
		const job = await provider.submit({
			mode: 'text2motion',
			sourceUrl: null,
			params: { prompt, duration_seconds: duration, fps },
		});
		return json(res, 202, {
			job_id: job.extJobId,
			status: 'queued',
			eta_seconds: job.eta,
			note,
		});
	} catch (err) {
		return json(res, 502, { error: 'motion_failed', message: err?.message || 'Motion generation could not start.' });
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

	const result = await provider.status(jobId);
	const clip = result.status === 'done' && result.resultClipUrl ? await convertedClip(result.resultClipUrl) : null;
	return json(res, 200, {
		job_id: jobId,
		status: result.status,
		clip_url: result.resultClipUrl || null,
		// The clip in the library's basis, ready to play. The worker writes its
		// rotations against HumanML3D's raw rest directions (arms hanging, head
		// forward of the neck), and played as-is that throws the head back and
		// raises the arms on every rig. `clip_url` stays for callers that convert
		// themselves; `clip` is null only when the conversion could not run.
		clip,
		frames: typeof result.frames === 'number' ? result.frames : null,
		fps: typeof result.fps === 'number' ? result.fps : null,
		error: result.error || null,
	});
}

// A failed conversion degrades to the raw clip URL rather than failing a
// generation the GPU already paid for.
async function convertedClip(url) {
	try {
		const res = await fetchUpstream(url, {}, { name: 'lane:motion-clip', timeoutMs: 15_000, attempts: 2 });
		return libraryReadyClip(await res.json());
	} catch (err) {
		console.warn('[forge-motion] clip conversion failed', err?.message || err);
		return null;
	}
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
