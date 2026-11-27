// How the synchronous Forge lanes run the quality stage (forge-quality-stage.js).
//
// api/forge.js and its ChatGPT clone api/gpt-forge.js both finish two lanes inside
// the request: the free NVIDIA NIM text-to-3D lane and the Hugging Face Spaces
// lane. Both used to stack a structural retry on top of a vision retry (up to
// three generations for one request), replace the first model with the retry
// whether or not it was better, count the retry as a second generation, and wait
// on the judge with no bound of their own. This module is the one place those
// handlers now get the stage from, so the two copies cannot drift apart again.
//
// The async lanes (self-host TRELLIS, Hunyuan3D, the hosted NVIDIA TRELLIS job)
// never come through here: they are scored once on poll and never retried, so a
// retry never lands on the platform's own GPU.

import { runQualityStage, allowanceAtEdge } from './forge-quality-stage.js';
import { retireAttempt } from './forge-store.js';
import { providersInCooldown } from './provider-health.js';
import { NIM_TRELLIS_COOLDOWN_KEY } from './nvcf-lane-health.js';
import { acquireBlockingSlot, SCALE_LIMITS } from './forge-scale.js';

function intEnv(name, fallback) {
	const v = typeof process !== 'undefined' ? process.env?.[name] : null;
	const n = v == null || v === '' ? NaN : Number(v);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Quality retries the NIM lane may run at once across the fleet. NVIDIA meters
// the shared key per minute; a burst of flagged drafts must not turn into a burst
// of second submits that throttles every first attempt behind them.
const NIM_RETRY_MAX_CONCURRENT = intEnv('FORGE_NIM_QUALITY_RETRY_MAX', 4);
// Lease outlives the longest synchronous NIM completion, so a killed instance's
// slot always reclaims.
const NIM_RETRY_SLOT_TTL_MS = 305_000;

const BUSY = Object.freeze({ ok: false, reason: 'busy' });

/** Admission for a NIM quality retry: not while the lane is cooling, not past the fleet cap. */
export async function admitNimQualityRetry() {
	const cooling = await providersInCooldown([NIM_TRELLIS_COOLDOWN_KEY]);
	if (cooling.has(NIM_TRELLIS_COOLDOWN_KEY)) return BUSY;
	const slot = await acquireBlockingSlot('nim-quality-retry', {
		max: NIM_RETRY_MAX_CONCURRENT,
		ttlMs: NIM_RETRY_SLOT_TTL_MS,
	});
	return slot.ok ? { ok: true, release: slot.release } : BUSY;
}

/**
 * Admission for a Hugging Face quality retry: it needs a free Spaces slot of its
 * own, the same pool first attempts draw from, so a busy fleet keeps the first
 * result instead of starving other callers of their turn.
 */
export async function admitHfQualityRetry() {
	const slot = await acquireBlockingSlot('hf', { max: SCALE_LIMITS.hfConcurrent, ttlMs: SCALE_LIMITS.hfSlotTtlMs });
	return slot.ok ? { ok: true, release: slot.release } : BUSY;
}

// buildRetryDirective (forge-quality-gate.js) owns the retry prompt: it keeps
// the subject and adds the judge's guidance. Loaded lazily so a missing module
// degrades to the judge's own hint instead of breaking the lane.
async function loadDirectiveBuilder() {
	try {
		const mod = await import('./forge-quality-gate.js');
		if (typeof mod.buildRetryDirective !== 'function') return null;
		return (verdict, ctx) => {
			const d = mod.buildRetryDirective(verdict, ctx);
			return d ? { prompt: d.prompt, hint: verdict?.suggested_retry_hint || null } : null;
		};
	} catch {
		return null;
	}
}

/**
 * Run the quality stage for one synchronous lane.
 *
 * @param {object} p
 * @param {object} p.req the request, so its up-front allowance charge is read
 * @param {object|null} p.durable the delivered first attempt
 * @param {string} p.tierId
 * @param {string} p.prompt
 * @param {string} [p.path]
 * @param {(tierId: string, quality: object|null) => boolean} p.gateApplies the handler's scope rule
 * @param {(a: {glbUrl: string, prompt: string, tier: string}) => Promise<object>} p.scoreGate the handler's judge shim
 * @param {(a: {prompt: string, hint: string|null, isRetry: true}) => Promise<{durable: object}|null>} p.regenerate
 * @param {() => Promise<{ok: boolean, reason?: string, release?: () => Promise<void>}>} p.admitRetry lane busy check
 * @param {number} [p.maxRetries]
 * @returns {Promise<{durable: object|null, verdict: object|null, retried: boolean, retry: object}>}
 */
export async function runSyncLaneQualityStage({
	req,
	durable,
	tierId,
	prompt,
	path = null,
	gateApplies,
	scoreGate,
	regenerate,
	admitRetry,
	maxRetries,
}) {
	return runQualityStage({
		durable,
		tierId,
		prompt,
		path,
		visionApplies: (model) => gateApplies(tierId, model?.quality),
		score: ({ durable: model, prompt: forPrompt }) => scoreGate({ glbUrl: model.glbUrl, prompt: forPrompt, tier: tierId }),
		regenerate,
		// Allowance first: it needs no network, and a person about to be throttled
		// is never made to wait on a generation they did not ask for.
		admitRetry: async () => (allowanceAtEdge(req) ? { ok: false, reason: 'allowance' } : admitRetry()),
		buildDirective: await loadDirectiveBuilder(),
		discard: async ({ loser }) => {
			await retireAttempt({ id: loser.id });
		},
		maxRetries,
	});
}

/** The response field: present only when a retry ran or was considered and declined. */
export function qualityRetryField(retry) {
	return retry && (retry.ran || retry.declined) ? retry : undefined;
}
