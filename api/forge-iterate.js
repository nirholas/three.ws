/**
 * /api/forge-iterate — conversational, ownership-preserving 3D iteration.
 *
 *   POST /api/forge-iterate {
 *     glb_url: string, instruction: string,
 *     parent_prompt?: string, parent_lineage?: array, parent_index?: number
 *   } → 200 {
 *     ok, glbUrl, viewerUrl, prompt, instruction, creationId, durable,
 *     lineage, activeIndex
 *   }
 *
 * The free /api/mcp-studio JSON-RPC endpoint already exposes conversational
 * refinement for OpenAI/ChatGPT (the `refine_model` tool) — but that call is
 * server-to-server with no forwarded client identity, so its results aren't
 * owned by any browser session and can never be published to the remix bazaar
 * (api/remix-feed.js), which is ownership-scoped by `x-forge-client`.
 *
 * This endpoint is the SAME composeRefinement + version-lineage core
 * (mcp-server/src/tools/_lineage.js — the single source of truth shared with
 * refine_model, so the two paths can never drift) wired as a plain REST call
 * from the signed-in Forge Studio UI (/forge-studio). It forwards
 * `x-forge-client` straight through to /api/forge, so an iteration is a
 * normal, owned creation: it lands in the caller's gallery and can be
 * published as remixable exactly like any other forge result. No payment
 * surface: iteration is free on every track, same as the free studio.
 *
 * Iterating makes a new model, so it needs a signed-in account (401
 * sign_in_required otherwise), and the caller's cookie or bearer is forwarded
 * to /api/forge so the inner call is gated and attributed to the same person.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { originFromReq, viewerUrl } from './_mcp-studio/forge-client.js';
import { requireCreator, forwardCreatorAuth } from './_lib/creator-account.js';
import {
	composeRefinement,
	seedLineage,
	appendVersion,
	buildLineageChain,
	branchFrom,
} from '../mcp-server/src/tools/_lineage.js';
import { planIteration, mintSeed, parseSeed } from '../src/shared/iterate-plan.js';
import { restyleMaterialFromInstruction, MaterialStudioError } from './_lib/material-studio-store.js';

// auto: the server decides look vs shape from the words (src/shared/iterate-plan.js).
// look / shape: the user overrode that decision. variation: "more like this".
const MODES = new Set(['auto', 'look', 'shape', 'variation']);

const INPUT_KEYS = ['mode', 'prompt', 'instruction', 'parentPrompt', 'seed', 'backend', 'creationId'];

// Keep only the recorded-inputs fields we write, with their types, so a client
// round trip can carry them forward but never smuggle anything else in.
function sanitizeInputs(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const out = {};
	for (const k of INPUT_KEYS) {
		const v = raw[k];
		if (k === 'seed') out.seed = parseSeed(v);
		else out[k] = typeof v === 'string' ? v.slice(0, 1000) : null;
	}
	return out;
}

function resolveLineage(rawLineage, glbUrl, parentPrompt) {
	const fresh = () => seedLineage({ glbUrl, prompt: parentPrompt || null });
	if (!Array.isArray(rawLineage) || rawLineage.length === 0) return fresh();
	const rehydrated = rawLineage.slice(0, 200).map((v, i) => {
		const inputs = sanitizeInputs(v?.inputs);
		return {
			index: Number.isInteger(v?.index) ? v.index : i,
			parentIndex: v?.parentIndex ?? (i > 0 ? i - 1 : null),
			glbUrl: typeof v?.glbUrl === 'string' ? v.glbUrl : null,
			viewerUrl: v?.viewerUrl || null,
			prompt: v?.prompt || null,
			instruction: v?.instruction || null,
			refKind: v?.refKind || (i === 0 ? 'origin' : 'text'),
			...(inputs ? { inputs } : {}),
		};
	});
	const valid = buildLineageChain(rehydrated).ok && rehydrated.every((v) => /^https?:\/\//i.test(v.glbUrl || ''));
	return valid ? rehydrated : fresh();
}

// appendVersion (the core shared with the MCP refine_model tool) records the
// graph; this adds what produced the version so "do that again" is possible.
function appendRecorded(lineage, version, inputs) {
	const next = appendVersion(lineage, version);
	next[next.length - 1] = { ...next[next.length - 1], inputs };
	return next;
}

// A look-only change restyles the materials of the parent version in-process.
// No /api/forge call, so no geometry job: the shape stays byte-for-byte (the
// restyle verifies that before it persists anything).
async function iterateLook(res, { base, glbUrl, instruction, parentPrompt, baseLineage, parentIndex }) {
	let result;
	try {
		result = await restyleMaterialFromInstruction({ glbUrl, instruction });
	} catch (err) {
		if (err instanceof MaterialStudioError) {
			const unavailable = err.code === 'no_provider' || err.status >= 500;
			return json(res, unavailable ? 503 : err.status, {
				error: unavailable ? 'look_unavailable' : err.code,
				kind: 'look',
				fallback: 'materials',
				message: unavailable
					? 'Surface changes need a language model, and none is answering right now, so nothing was changed. The preset looks in Materials apply instantly, or rebuild the shape with this change instead.'
					: err.message,
			});
		}
		throw err;
	}
	const prompt = composeRefinement(parentPrompt, instruction);
	const vUrl = viewerUrl(base, result.glbUrl);
	const lineage = appendRecorded(
		baseLineage,
		{ glbUrl: result.glbUrl, viewerUrl: vUrl, prompt, instruction, refKind: 'restyle', parentIndex },
		{
			mode: 'look',
			prompt,
			instruction,
			parentPrompt: parentPrompt || null,
			seed: null,
			backend: 'material-restyle',
			creationId: null,
		},
	);
	return json(res, 200, {
		ok: true,
		kind: 'look',
		glbUrl: result.glbUrl,
		viewerUrl: vUrl,
		prompt,
		instruction,
		seed: null,
		creationId: null,
		durable: true,
		look: { name: result.factors?.name || null, notes: result.factors?.notes || null },
		lineage,
		activeIndex: lineage.length - 1,
	});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clientIdFrom(req) {
	const raw = req.headers['x-forge-client'];
	const id = Array.isArray(raw) ? raw[0] : raw;
	return typeof id === 'string' && id.trim() ? id.trim().slice(0, 128) : null;
}

// Submit + poll against /api/forge, forwarding the caller's x-forge-client so
// the resulting row is owned by the same browser session that owns the parent
// model — the piece the anonymous free-studio path deliberately omits.
//
// /api/forge holds the connection open while a saturated generator queues the
// job, so the accept can legitimately take minutes before it answers (a live
// three.ws submit held for 157s, then returned its own busy 429). A short submit
// timeout therefore fires on exactly the condition the busy branch below exists
// to report, which is why this window is generous and why a timeout is answered
// as busy rather than as a bare gateway timeout.
const SUBMIT_TIMEOUT_MS = Number(process.env.FORGE_ITERATE_SUBMIT_MS) || 60_000;

async function submitForge(base, payload, clientId, auth) {
	let res;
	try {
		res = await fetch(`${base}/api/forge`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(clientId ? { 'x-forge-client': clientId } : {}),
				...auth,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
		});
	} catch (err) {
		if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
			// Report it the way the generator itself would: busy, with a back-off the
			// caller can act on. Both iterate UIs (src/forge-studio/forge-iterate.js,
			// src/forge-conversational-refine.js) already render a 429 + retry_after as
			// "busy, try again in Ns"; the old 504 sent them down the generic
			// "rephrase your instruction" branch, which blamed a wording the user had
			// got right.
			return {
				error: 'busy',
				status: 429,
				message: 'The 3D generator is busy right now; try again shortly.',
				retryAfter: 20,
			};
		}
		return { error: 'provider_error', status: 502, message: `The 3D generator is unreachable: ${err?.message || err}` };
	}
	const data = await res.json().catch(() => ({}));
	if (res.status === 401) {
		return { error: 'sign_in_required', status: 401, message: data?.message || 'Sign in to refine a 3D model.' };
	}
	if (res.status === 503) {
		return { error: 'not_configured', status: 503, message: data?.message || '3D generation is not configured on this deployment.' };
	}
	if (res.status === 429) {
		return { error: 'busy', status: 429, message: data?.message || 'The 3D generator is busy; try again shortly.', retryAfter: data?.retry_after };
	}
	const completedSync = data?.status === 'done' && data?.glb_url;
	if (!res.ok || !(data?.job_id || completedSync)) {
		return { error: 'provider_error', status: 502, message: data?.message || `forge returned ${res.status}` };
	}
	return { data };
}

async function pollForge(base, jobId, clientId, auth, { timeoutMs, intervalMs }) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		let res;
		try {
			res = await fetch(`${base}/api/forge?job=${encodeURIComponent(jobId)}`, {
				headers: { accept: 'application/json', ...(clientId ? { 'x-forge-client': clientId } : {}), ...auth },
				signal: AbortSignal.timeout(Math.max(intervalMs * 3, 15_000)),
			});
		} catch (err) {
			if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
				await sleep(intervalMs);
				continue;
			}
			return { error: 'provider_error', status: 502, message: `forge poll failed: ${err?.message || err}` };
		}
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			return { error: 'provider_error', status: 502, message: data?.message || `forge poll returned ${res.status}` };
		}
		last = data;
		if (data.status === 'done' && data.glb_url) return { data };
		if (data.status === 'failed') {
			return { error: 'generation_failed', status: 502, message: data.error || 'Generation failed for this instruction.' };
		}
		await sleep(intervalMs);
	}
	return { data: { ...(last || {}), _timedOut: true } };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const who = await requireCreator(req, res, { action: 'refine a 3D model' });
	if (!who) return;

	const clientId = clientIdFrom(req);
	const auth = forwardCreatorAuth(req);
	const rl = await limits.forgeIterate(who.user ? `user:${who.user.id}` : clientId || clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = await readJson(req, 200_000).catch(() => null);
	if (!body || typeof body !== 'object') {
		return json(res, 400, { error: 'invalid_json', message: 'Malformed JSON body.' });
	}

	const bodyGlbUrl = typeof body.glb_url === 'string' ? body.glb_url.trim() : '';
	if (!/^https?:\/\//i.test(bodyGlbUrl)) {
		return json(res, 400, { error: 'invalid_glb_url', message: 'Provide the http(s) glb_url of the model to iterate on.' });
	}
	const mode = MODES.has(body.mode) ? body.mode : 'auto';
	const bodyParentPrompt = typeof body.parent_prompt === 'string' ? body.parent_prompt.trim() : '';

	// Resolve the starting lineage exactly like refine_model does: extend a
	// client-supplied one when it's structurally valid, otherwise seed fresh so
	// a malformed/tampered array never corrupts history.
	const baseLineage = resolveLineage(body.parent_lineage, bodyGlbUrl, bodyParentPrompt);
	let parentIndex = baseLineage.length - 1;
	if (Number.isInteger(body.parent_index)) {
		try {
			parentIndex = branchFrom(baseLineage, body.parent_index);
		} catch {
			parentIndex = baseLineage.length - 1;
		}
	}
	// A refinement applies to the version it starts from: its model and the
	// prompt that describes it (which already carries every earlier change).
	// The page's parent_prompt is only the fallback for a fresh lineage.
	const parent = baseLineage[parentIndex];
	const glbUrl = parent.glbUrl || bodyGlbUrl;
	const parentPrompt = parent.prompt || bodyParentPrompt;

	const plan = planIteration({
		instruction: body.instruction,
		mode,
		parentInstruction: parent.instruction,
		parentPrompt,
		allowNewSubject: body.allow_new_subject === true,
	});
	if (!plan.ok) {
		return json(res, plan.status, {
			error: plan.code,
			message: plan.message,
			...(plan.suggestedPrompt ? { suggested_prompt: plan.suggestedPrompt } : {}),
		});
	}
	const instruction = plan.text;
	const base = originFromReq(req);

	if (plan.kind === 'look') {
		return iterateLook(res, { base, glbUrl, instruction, parentPrompt, baseLineage, parentIndex });
	}

	// shape and variation both build a new model. A variation keeps the subject
	// prompt and takes a different seed than its parent; a shape change folds the
	// instruction into the parent's prompt. The seed is always explicit so the
	// version records exactly what produced it.
	const isVariation = plan.kind === 'variation';
	const composed = isVariation ? parentPrompt : composeRefinement(parentPrompt, instruction);
	const parentSeed = parseSeed(parent.inputs?.seed) ?? parseSeed(body.parent_seed);
	let seed = isVariation ? null : parseSeed(body.seed);
	while (seed === null || seed === parentSeed) seed = mintSeed();

	const submitted = await submitForge(base, { prompt: composed, seed }, clientId, auth);
	if (submitted.error) {
		return json(res, submitted.status, {
			error: submitted.error,
			message: submitted.message,
			kind: plan.kind,
			...(submitted.retryAfter ? { retry_after: submitted.retryAfter } : {}),
		});
	}
	const job = submitted.data;

	let final = job;
	if (!(job.status === 'done' && job.glb_url)) {
		const timeoutMs = Number(process.env.FORGE_ITERATE_TIMEOUT_MS) || 180_000;
		const intervalMs = Number(process.env.FORGE_ITERATE_POLL_MS) || 3000;
		const polled = await pollForge(base, job.job_id, clientId, auth, { timeoutMs, intervalMs });
		if (polled.error) {
			return json(res, polled.status, { error: polled.error, message: polled.message, kind: plan.kind });
		}
		final = polled.data;
	}
	if (final._timedOut || !final.glb_url) {
		return json(res, 504, {
			error: 'timeout',
			message: 'Iteration is taking longer than expected. Please try again.',
			kind: plan.kind,
			job_id: job.job_id || null,
			creation_id: final.creation_id ?? job.creation_id ?? null,
		});
	}

	const newGlbUrl = final.glb_url;
	const vUrl = viewerUrl(base, newGlbUrl);
	const creationId = final.creation_id ?? job.creation_id ?? null;
	const lineage = appendRecorded(
		baseLineage,
		{
			glbUrl: newGlbUrl,
			viewerUrl: vUrl,
			prompt: composed,
			instruction: isVariation ? null : instruction,
			refKind: isVariation ? 'variation' : 'text',
			parentIndex,
		},
		{
			mode: plan.kind,
			prompt: composed,
			instruction: isVariation ? null : instruction,
			parentPrompt: parentPrompt || null,
			seed,
			backend: final.backend || job.backend || null,
			creationId,
		},
	);

	return json(res, 200, {
		ok: true,
		kind: plan.kind,
		glbUrl: newGlbUrl,
		viewerUrl: vUrl,
		prompt: composed,
		instruction: isVariation ? null : instruction,
		seed,
		creationId,
		durable: Boolean(final.durable),
		lineage,
		activeIndex: lineage.length - 1,
	});
});
