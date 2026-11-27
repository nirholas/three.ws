// The post-generation quality stage for the Forge lanes that finish inside one
// request (NVIDIA NIM text-to-3D, the HuggingFace Spaces, the BYOK sync lanes).
//
// One rule decides everything here: the stage can only IMPROVE a result. It never
// blocks a delivered model, never delivers a worse one in place of a better one,
// and never costs the user a second generation.
//
//   1. Cheap deterministic checks first. A broken GLB (invalid, degenerate, or a
//      low score in the bottom band, see glb-quality.js) is retried on that
//      evidence alone. The vision judge is never asked to condemn what the
//      structure check has already condemned.
//   2. The vision judge runs only where the scope says it applies, inside a
//      scoring budget shared by every scoring this request makes. A judge that is
//      unreachable, hangs or answers nonsense returns a fail-open verdict.
//   3. ONE retry per request, whatever combination of checks asked for it. The
//      structural retry and the vision retry used to stack (two extra generations
//      for one request).
//   4. No retry when the lane is busy or the caller is at the edge of their
//      allowance: the first result ships as it is.
//   5. A retry is not a second request. It does not touch the rate limiter, and
//      the lane that regenerates is told so (`isRetry`), so it can create its row
//      without a second funnel start or a second success count.
//   6. The better of the two results is kept, and the attempt that lost is
//      retired so the user is not left holding a model they never saw.
//   7. The response says what happened (`retry.message`). These lanes answer the
//      request once the stage is done, so the user never sees one model and then
//      receives another.
//
// Everything lane-specific arrives as a callback, so each rule is testable on its
// own and the same stage serves api/forge.js and api/gpt-forge.js.

import { shouldRetryForQuality } from './glb-quality.js';

function intEnv(name, fallback) {
	const v = typeof process !== 'undefined' ? process.env?.[name] : null;
	const n = v == null || v === '' ? NaN : Number(v);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const QUALITY_STAGE_LIMITS = Object.freeze({
	// Total time the stage may spend SCORING in one request, across the first
	// scoring and the retry's. Generation time is the lane's own and is not in it.
	scoreBudgetMs: intEnv('FORGE_QUALITY_STAGE_BUDGET_MS', 30_000),
	// The async lanes score once, on poll, with no retry: a tighter bound, since a
	// poll that waits on a judge delays a model that is already finished.
	pollScoreBudgetMs: intEnv('FORGE_QUALITY_POLL_BUDGET_MS', 12_000),
	// A request gets at most one automatic retry, whatever the environment says.
	maxRetriesCeiling: 1,
});

// Fewer than this many generations left in the caller's hourly allowance after
// the one just charged counts as "at the edge". The retry is free to them, but a
// person about to be throttled is exactly who should not be made to wait on a
// second generation they did not ask for.
const ALLOWANCE_EDGE_REMAINING = 1;

const allowanceByRequest = new WeakMap();

/** Remember the allowance left after this request's up-front charge. */
export function noteAllowance(req, rl) {
	if (!req || typeof req !== 'object' || !rl) return;
	const remaining = Number(rl.remaining);
	if (!Number.isFinite(remaining)) return;
	allowanceByRequest.set(req, { remaining, limit: Number(rl.limit) || null });
}

/** True when this request spent the caller's last (or second to last) allowance. */
export function allowanceAtEdge(req) {
	if (!req || typeof req !== 'object') return false;
	const a = allowanceByRequest.get(req);
	return Boolean(a) && a.remaining <= ALLOWANCE_EDGE_REMAINING;
}

function outage(reason) {
	return {
		pass: true,
		score: null,
		defects: [],
		reason: `qa_unavailable: ${reason}`,
		suggested_retry_hint: null,
		qa_available: false,
		skipped: true,
	};
}

/**
 * Run a scorer inside a time budget. Always resolves to a verdict object: the
 * scorer's own when it answers in time, otherwise a passing qa_available:false
 * one. A throw, a hang and a non-object are all the same thing to the caller: the
 * judge did not give an opinion, so the model ships.
 */
export async function scoreWithinBudget(run, ms) {
	if (!(ms > 0)) return outage('the score budget was already spent');
	let timer;
	const TIMED_OUT = Symbol('timed out');
	try {
		const verdict = await Promise.race([
			Promise.resolve().then(run),
			new Promise((resolve) => {
				timer = setTimeout(() => resolve(TIMED_OUT), ms);
			}),
		]);
		if (verdict === TIMED_OUT) return outage(`no verdict inside the ${ms}ms score budget`);
		if (!verdict || typeof verdict !== 'object') return outage('the judge returned no verdict');
		return verdict;
	} catch (err) {
		return outage(`the judge threw: ${err?.message || err}`);
	} finally {
		clearTimeout(timer);
	}
}

// A verdict the stage may act on: the judge really ran and gave a number.
export function verdictUsable(v) {
	return Boolean(v) && v.qa_available !== false && v.skipped !== true && typeof v.score === 'number' && Number.isFinite(v.score);
}

// Only a usable verdict can fail a model. A bare pass:false with no score is the
// judge talking nonsense, not a quality call.
export function verdictFailed(v) {
	return verdictUsable(v) && v.pass === false;
}

function structurallyBroken(q) {
	return Boolean(q) && (q.flag === 'invalid' || q.flag === 'degenerate');
}

function structuralScore(q) {
	const n = Number(q?.score);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Should `next` replace `best`? Only when it is provably better.
 *  - never swap to a structurally broken model, and always leave one;
 *  - two real verdicts: a pass beats a fail, otherwise the higher score;
 *  - an unproven retry (the judge went blind on it) never displaces a judged one;
 *  - with no verdicts to compare, the higher structural score, strictly.
 * A tie keeps the first result: it is the one the lane's own cache and defaults
 * already describe.
 */
export function betterAttempt(best, next) {
	const bq = best?.durable?.quality;
	const nq = next?.durable?.quality;
	const bBroken = structurallyBroken(bq);
	const nBroken = structurallyBroken(nq);
	if (nBroken && !bBroken) return false;
	if (bBroken && !nBroken) return true;
	const bv = best?.verdict;
	const nv = next?.verdict;
	if (verdictUsable(bv) && verdictUsable(nv)) {
		if (nv.pass === true && bv.pass !== true) return true;
		if (bv.pass === true && nv.pass !== true) return false;
		return nv.score > bv.score;
	}
	if (verdictUsable(bv)) return false;
	if (!bq || !nq) return false;
	return structuralScore(nq) > structuralScore(bq);
}

/**
 * What to tell the person, or null when there is nothing to tell. Shown as the
 * quality badge's tooltip and in the result note.
 */
export function describeQualityRetry(retry) {
	if (!retry) return null;
	if (retry.ran) {
		return retry.kept === 'retry'
			? 'The first attempt did not pass the automatic quality check, so this model was regenerated once. You are seeing the improved result.'
			: 'The first attempt did not pass the automatic quality check. It was regenerated once, and Forge kept the first result because it was the better of the two.';
	}
	switch (retry.declined) {
		case 'busy':
			return 'The automatic quality check flagged this result, but the service is busy, so it was not regenerated. Try Regenerate in a moment.';
		case 'allowance':
			return 'The automatic quality check flagged this result. It was not regenerated automatically because you are close to your generation limit. Try Regenerate when you are ready.';
		case 'retry_failed':
			return 'The automatic quality check flagged this result and an automatic regeneration did not complete, so the first result is shown.';
		default:
			return null;
	}
}

function retryRecord(fields) {
	const retry = { ran: false, reason: null, kept: null, declined: null, ...fields };
	return { ...retry, message: describeQualityRetry(retry) };
}

async function discardQuietly(discard, loser, winner) {
	if (typeof discard !== 'function' || !loser?.id || !winner?.id || loser.id === winner.id) return;
	try {
		await discard({ loser, winner });
	} catch (err) {
		console.warn(`[forge] could not retire the discarded quality attempt ${loser.id}: ${err?.message || err}`);
	}
}

/**
 * Run the stage on a delivered model.
 *
 * @param {object} p
 * @param {{id?: string, glbUrl: string, quality?: object|null}} p.durable the delivered first attempt
 * @param {string} p.tierId
 * @param {string} p.prompt
 * @param {string} [p.path]
 * @param {(durable: object) => boolean} p.visionApplies whether the vision gate applies to this model
 * @param {(a: {durable: object, prompt: string}) => Promise<object>} p.score the vision judge
 * @param {(a: {prompt: string, hint: string|null, isRetry: true}) => Promise<{durable: object}|null>} p.regenerate
 * @param {() => Promise<{ok: boolean, reason?: string, release?: () => Promise<void>}>} p.admitRetry
 * @param {(verdict: object, ctx: object) => ({prompt?: string, hint?: string|null}|null)} [p.buildDirective]
 * @param {(a: {loser: object, winner: object}) => Promise<void>} [p.discard] retires the attempt that lost
 * @param {number} [p.maxRetries] clamped to 0..1
 * @param {number} [p.budgetMs] total scoring budget
 * @returns {Promise<{durable: object, verdict: object|null, retried: boolean, retry: object}>}
 */
export async function runQualityStage({
	durable,
	tierId,
	prompt,
	path = null,
	visionApplies,
	score,
	regenerate,
	admitRetry,
	buildDirective = null,
	discard = null,
	maxRetries = QUALITY_STAGE_LIMITS.maxRetriesCeiling,
	budgetMs = QUALITY_STAGE_LIMITS.scoreBudgetMs,
}) {
	const none = (verdict = null, fields = {}) => ({ durable, verdict, retried: false, retry: retryRecord(fields) });
	if (!durable?.glbUrl) return none();

	const cap = Math.max(0, Math.min(QUALITY_STAGE_LIMITS.maxRetriesCeiling, Math.floor(Number(maxRetries)) || 0));
	const clockEnd = Date.now() + (budgetMs > 0 ? budgetMs : QUALITY_STAGE_LIMITS.scoreBudgetMs);
	const scoreModel = (model, forPrompt) =>
		scoreWithinBudget(() => score({ durable: model, prompt: forPrompt }), clockEnd - Date.now());
	const applies = (model) => {
		try {
			return Boolean(visionApplies?.(model));
		} catch {
			return false;
		}
	};

	const structuralFail = shouldRetryForQuality(durable.quality);
	const wantsVision = applies(durable);
	if (!structuralFail && !wantsVision) return none();

	// 1. Decide whether a retry is warranted, cheapest evidence first.
	let firstVerdict = null;
	let directive = null;
	let reason;
	if (structuralFail) {
		reason = 'structural';
		directive = { prompt, hint: null };
	} else {
		firstVerdict = await scoreModel(durable, prompt);
		if (!verdictFailed(firstVerdict)) return none(firstVerdict);
		directive = typeof buildDirective === 'function' ? buildDirective(firstVerdict, { prompt, tier: tierId, path, attempt: 0, maxRetries: cap }) : { prompt, hint: firstVerdict.suggested_retry_hint || null };
		if (!directive) return none(firstVerdict);
		reason = 'vision';
	}

	// The first result stands unless a retry is admitted and proves better. It is
	// still judged once, for the badge, when the gate applies and has not run yet.
	const stand = async (fields) => {
		const verdict = firstVerdict || (wantsVision ? await scoreModel(durable, prompt) : null);
		return none(verdict, fields);
	};

	// 2. Is a retry allowed right now?
	if (cap < 1) return stand({ declined: 'disabled' });
	let admission;
	try {
		admission = await admitRetry();
	} catch {
		admission = { ok: false, reason: 'busy' };
	}
	if (!admission?.ok) return stand({ declined: admission?.reason || 'busy' });

	// 3. The one retry.
	let next = null;
	try {
		const retryPrompt = directive.prompt || prompt;
		const regenerated = await regenerate({ prompt: retryPrompt, hint: directive.hint || null, isRetry: true });
		next = regenerated?.durable?.glbUrl ? regenerated.durable : null;
	} catch (err) {
		console.warn(`[forge] quality retry could not regenerate, keeping the first result: ${err?.message || err}`);
	} finally {
		try {
			await admission.release?.();
		} catch {
			// Releasing a lease is best-effort; it expires on its own TTL.
		}
	}
	if (!next) return stand({ declined: 'retry_failed' });

	// 4. Keep the better of the two.
	const retryPromptUsed = directive.prompt || prompt;
	let first = { durable, verdict: firstVerdict };
	let second = { durable: next, verdict: null };
	if (reason === 'vision') {
		second.verdict = await scoreModel(next, retryPromptUsed);
	}
	const keepRetry = betterAttempt(first, second);
	let winner = keepRetry ? second : first;
	const loser = keepRetry ? first : second;
	// Structural path: the judge has not seen either attempt yet. Score the model
	// that is going out, once, when the gate applies to it.
	let verdict = winner.verdict;
	if (!verdict && applies(winner.durable)) {
		verdict = await scoreModel(winner.durable, keepRetry ? retryPromptUsed : prompt);
	}
	await discardQuietly(discard, loser.durable, winner.durable);

	return {
		durable: winner.durable,
		verdict: verdict || null,
		retried: true,
		retry: retryRecord({ ran: true, reason, kept: keepRetry ? 'retry' : 'first' }),
	};
}
