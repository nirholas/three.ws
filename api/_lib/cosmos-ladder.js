// The /api/cosmos model ladder: the best current Cosmos model first, older ones
// behind it while NVIDIA still serves them. Each rung owns its request builder,
// its limits, and the modes it can actually render, so a request only ever
// reaches a rung that can honor it.
//
//   1. cosmos3-nano        self-hosted worker (workers/model-cosmos), text, image,
//                          depth, edge. 600-char prompts, 480p or 720p, 33-121 frames.
//   2. cosmos-predict1-7b  hosted NVCF Text2World, text only, 300-char prompts.
//   3. cosmos-predict1-5b  hosted NVCF Text2World, text only, 300-char prompts.
//
// Rungs are walked in order. A rung is skipped when it is not configured or
// cannot render the mode; it is stepped past when it reports itself gone
// (lane_unavailable) or unreachable. Busy, credential, and validation failures
// stop the walk: the next rung would not fix them, and a busy worker should
// tell the user to wait rather than silently swap in an older model.
//
// Job ids carry their rung so a poll needs nothing but the id:
//   cw_<32 hex>   worker task id
//   nv_<reqid>    NVCF request id on predict1-7b (legacy unprefixed ids too)
//   n5_<reqid>    NVCF request id on predict1-5b

import { env } from './env.js';
import {
	cosmosWorkerConfigured,
	submitWorld,
	worldStatus,
	WORKER_MODEL_ID,
	WORKER_MODES,
	WORKER_PROMPT_MAX,
	WORKER_RESOLUTIONS,
	WORKER_FRAMES,
	WORKER_MAX_IMAGE_BYTES,
	WORKER_MAX_CONTROL_BYTES,
} from '../_providers/cosmos-worker.js';
import {
	createNvidiaCosmosProvider,
	nvidiaCosmosConfigured,
	COSMOS_PREDICT1_7B_URL,
	COSMOS_PREDICT1_5B_URL,
	COSMOS_PROMPT_MAX,
} from '../_providers/nvidia-cosmos.js';

export const ALL_MODES = Object.freeze(['text', 'image', 'depth', 'edge']);
const FALL_THROUGH = new Set(['lane_unavailable', 'provider_unreachable']);

const WORKER_JOB_RE = /^cw_[a-f0-9]{32}$/;
const NVCF_JOB_RE = /^(?:nv_|n5_)?[A-Za-z0-9-]{20,64}$/;

function hostedRung(id, label, url, prefix, etaSeconds) {
	return {
		id,
		label,
		kind: 'hosted',
		modes: ['text'],
		limits: { prompt_min: 3, prompt_max: COSMOS_PROMPT_MAX, resolutions: ['704'], frames: { min: 121, max: 121, default: 121 } },
		etaSeconds,
		configured: () => nvidiaCosmosConfigured(),
		async submit(req) {
			const provider = createNvidiaCosmosProvider();
			const result = await provider.textToWorld({ prompt: req.prompt, seed: req.seed, routes: [url] });
			if (result.resultVideoUrl) return { done: true, videoUrl: result.resultVideoUrl };
			return { jobId: `${prefix}${result.taskId}`, queuePosition: null };
		},
	};
}

export const RUNGS = Object.freeze([
	{
		id: WORKER_MODEL_ID,
		label: 'Cosmos 3 Nano',
		kind: 'worker',
		modes: [...WORKER_MODES],
		limits: {
			prompt_min: 3,
			prompt_max: WORKER_PROMPT_MAX,
			resolutions: [...WORKER_RESOLUTIONS],
			frames: { ...WORKER_FRAMES },
			image_max_bytes: WORKER_MAX_IMAGE_BYTES,
			control_max_bytes: WORKER_MAX_CONTROL_BYTES,
		},
		// Measured on the RTX PRO 6000 worker; see docs/nvidia/evals.
		etaSeconds: 180,
		configured: () => cosmosWorkerConfigured(),
		async submit(req) {
			const { taskId, queuePosition } = await submitWorld(req);
			return { jobId: `cw_${taskId}`, queuePosition };
		},
	},
	hostedRung('cosmos-predict1-7b', 'Cosmos Predict1 7B (hosted)', COSMOS_PREDICT1_7B_URL, 'nv_', 90),
	hostedRung('cosmos-predict1-5b', 'Cosmos Predict1 5B (hosted)', COSMOS_PREDICT1_5B_URL, 'n5_', 90),
]);

export function describeLadder() {
	const rungs = RUNGS.map((r) => ({
		id: r.id,
		label: r.label,
		kind: r.kind,
		modes: [...r.modes],
		limits: r.limits,
		eta_seconds: r.etaSeconds,
		configured: r.configured(),
	}));
	// A pinned NVIDIA_COSMOS_INVOKE_URL means the operator chose one hosted model;
	// the hosted rungs then both submit to that pin.
	const modes = ALL_MODES.filter((m) => rungs.some((r) => r.configured && r.modes.includes(m)));
	return { rungs, modes, pinned_hosted_route: Boolean(env.NVIDIA_COSMOS_INVOKE_URL) };
}

// Validate a request against one rung's limits. Returns null when it fits, or a
// caller-safe reason.
function misfit(rung, req) {
	if (!rung.modes.includes(req.mode)) return `${rung.label} cannot render ${req.mode} worlds`;
	if (req.prompt.length > rung.limits.prompt_max) return `${rung.label} takes prompts up to ${rung.limits.prompt_max} characters`;
	return null;
}

// Walk the ladder for one request. Resolves to
//   { rung, jobId, queuePosition } | { rung, done:true, videoUrl }
// or throws the last meaningful lane error.
export async function submitToLadder(req) {
	let lastErr = null;
	let tried = 0;
	for (const rung of RUNGS) {
		if (!rung.configured()) continue;
		if (misfit(rung, req)) continue;
		tried++;
		try {
			const result = await rung.submit(req);
			return { rung, ...result };
		} catch (err) {
			if (!FALL_THROUGH.has(err?.code)) throw err;
			console.warn('[cosmos-ladder] %s %s, trying the next rung: %s', rung.id, err.code, err.message);
			lastErr = err;
		}
	}
	if (lastErr) {
		// Every rung that could take this mode is gone or unreachable: report the
		// lane offline, never a retryable transport error.
		throw Object.assign(lastErr, { code: 'lane_unavailable', status: 503 });
	}
	throw Object.assign(new Error(tried ? 'no rung accepted the request' : `no configured rung renders ${req.mode} worlds`), {
		code: 'lane_unavailable',
		status: 503,
	});
}

export function rungForJob(jobId) {
	if (WORKER_JOB_RE.test(jobId)) return RUNGS[0];
	if (jobId.startsWith('cw_')) return null;
	if (NVCF_JOB_RE.test(jobId)) return jobId.startsWith('n5_') ? RUNGS[2] : RUNGS[1];
	return null;
}

export async function pollLadderJob(jobId) {
	const rung = rungForJob(jobId);
	if (!rung) return null;
	if (rung.kind === 'worker') {
		const out = await worldStatus(jobId, jobId.slice(3));
		return { model: rung.id, ...out };
	}
	const provider = createNvidiaCosmosProvider();
	const taskId = /^(?:nv|n5)_/.test(jobId) ? jobId.slice(3) : jobId;
	const result = await provider.status({ taskId });
	return {
		model: rung.id,
		status: result.status === 'running' ? 'generating' : result.status,
		video_url: result.resultVideoUrl || null,
		...(result.status === 'failed' ? { error_code: 'generation_failed' } : {}),
		diagnostic: result.error || null,
	};
}
