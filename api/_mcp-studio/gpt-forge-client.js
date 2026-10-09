// three.ws 3D Studio (free) — client over the ChatGPT-dedicated generation
// pipeline. Exact clone of ./forge-client.js re-pointed at /api/gpt-forge (the
// ChatGPT clone of api/forge.js), so the ChatGPT surfaces (api/mcp-studio,
// api/3d/studio) can evolve independently of /api/forge and the surfaces that
// ride it (api/3d/generate, api/v1/ai/text-to-3d stay on ./forge-client.js).
//
// Every studio tool is a thin client over /api/gpt-forge — the public, auth-free
// twin of the paid 3D Studio MCP server (see api/gpt-forge.js). The platform's
// server-side keys (NVIDIA NIM, FLUX, TRELLIS/Hunyuan3D, UniRig, IBM Granite)
// cover the provider cost, so the ChatGPT user pays nothing and no wallet,
// payment, or API key is ever involved. This module is the SAME submit/poll
// logic the npm MCP tools use, factored once — not a fork and not a mock.
//
// All work runs against the deployment's own origin (STUDIO_API_BASE, else the
// configured PUBLIC_APP_ORIGIN; see api/_lib/self-origin.js), so the studio
// front door and the generation pipeline are always the same deployment.

import { selfOrigin } from '../_lib/self-origin.js';
import { watsonxConfig, watsonxChatComplete } from '../_lib/watsonx.js';
import { llmComplete } from '../_lib/llm.js';
import { TICKET_HEADER, newTicket, ticketHandle } from '../_lib/forge-submit-ticket.js';

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_MS = 3_000;
const SUBMIT_TIMEOUT_MS = 90_000;
const RIG_SUBMIT_TIMEOUT_MS = 30_000;

// A caller may bound a whole tool call with an absolute `deadline` (epoch ms).
// ChatGPT drops any tool call still open at 60 s, so its surface passes one and
// every wait below shrinks to fit it. A submit still gets this floor even past
// the deadline: without an accepted job there is nothing to hand back, and the
// surface's budget leaves room for it under the host's limit.
const SUBMIT_FLOOR_MS = 8_000;
// A ticketed submit has a handle to hand back whatever happens, so it needs no
// room past the deadline, only enough to get the request onto the wire.
const TICKET_SUBMIT_FLOOR_MS = 3_000;

function submitWindow(deadline, capMs, floorMs = SUBMIT_FLOOR_MS) {
	if (!deadline) return capMs;
	return Math.min(capMs, Math.max(floorMs, deadline - Date.now()));
}

function envNum(key, def) {
	const v = Number(process.env[key]);
	return Number.isFinite(v) && v > 0 ? v : def;
}

// Resolve the origin to call /api/gpt-forge on: STUDIO_API_BASE when set, otherwise
// the configured app origin (selfOrigin). Never a request header: the forge
// self-call can carry the internal seed credential, and a caller-chosen
// `x-forwarded-host` would send it, and the request, to any host they name.
export function originFromReq(req) {
	const explicit = process.env.STUDIO_API_BASE && String(process.env.STUDIO_API_BASE).trim();
	if (explicit) return explicit.replace(/\/$/, '');
	return selfOrigin(req);
}

export function viewerUrl(base, glbUrl) {
	return `${base}/viewer?src=${encodeURIComponent(glbUrl)}`;
}

// Device-aware AR launch link (api/ar.js): Android 302s straight into Scene
// Viewer, iOS gets a Quick Look launch page (GLB→USDZ converted in-page), and
// desktop falls back to the WebGL viewer. One URL places the model in the
// user's real room on any phone — the same lane the /ar and /forge pages use.
// `live: true` marks a rigged avatar (an agent's body): the launch page then
// leads with the IRL living handoff instead of static placement.
export function arLaunchUrl(base, glbUrl, title, { live = false } = {}) {
	const t = typeof title === 'string' && title.trim() ? `&title=${encodeURIComponent(title.trim().slice(0, 80))}` : '';
	const k = live ? '&kind=avatar' : '';
	return `${base}/api/ar?src=${encodeURIComponent(glbUrl)}${t}${k}`;
}

// IRL living-agent link: /irl loads the avatar as an agent body in the user's
// real space: camera passthrough, animation, movement, conversation. This is
// the digital-to-physical bridge for the agent economy; static AR placement is
// the fallback for props, not the destination for avatars.
export function irlUrl(base, glbUrl) {
	return `${base}/irl?avatar=${encodeURIComponent(glbUrl)}`;
}

function failure(code, message, extra = {}) {
	const e = new Error(message);
	e.code = code;
	Object.assign(e, extra);
	return e;
}

// The studio surfaces run server→server against the deployment's own /api/gpt-forge,
// so they may carry the internal seed token (the same one forge-seed-cron uses).
// Forge accepts it as proof the call is platform-originated, which clears the
// High-tier access gate — the ChatGPT user stays anonymous and keyless while the
// platform funds the premium tier. Absent secret → no header, and the tier
// fallback in startForge keeps the surface working.
function internalHeaders() {
	const secret = process.env.CRON_SECRET;
	return secret ? { 'x-forge-seed': secret } : {};
}

// Submit a generation job to /api/gpt-forge. Handles both the synchronous-done shape
// (the free lanes often complete inside the submit window) and the queued shape
// ({ job_id }). `backend`/`path`/`tier` pass through to forge's router; omitting
// `backend` lets the free-first router pick the best engine for the tier.
// `internal: true` attaches the platform seed token so gated tiers (high) run
// operator-funded. A high-tier submit degrades to the ungated standard tier
// rather than dead-ending when the gate refuses (402: secret missing or stale)
// OR when the high lane can't hand back a job inside the submit window. The
// self-hosted Hunyuan3D worker that serves high does return a poll handle, so
// the usual cause of the second case is its scale-to-zero cold start rather
// than a blocking lane; either way, standard is better than a dead end.
//
// `strictTier: true` disables that degrade and throws `tier_unavailable`
// instead. A PAID high-tier surface must use it: a buyer who paid the HD price
// and silently received standard has been overcharged, and the seller side
// settles on success, so refusing here is what keeps their money in their
// wallet.
//
// `director: false` tells the server not to run its own prompt director: the
// studio tools direct the prompt before they submit, and a second pass rewrote
// an already-directed brief (with the mesh director, even for an avatar) while
// spending up to another 15 s of the caller's budget.
//
// A bounded call (`deadline`) sends a submit ticket (see
// ../_lib/forge-submit-ticket.js). If the submit is still running at the
// deadline, it resolves to the ticket's handle, `{ status: 'submitting',
// job_id: 't1.…' }`, instead of a timeout: the server records the job under the
// ticket when it lands, and polling that handle collects it.
export async function startForge(base, { prompt, imageUrls, aspect, backend, path, tier, internal, director, strictTier = false }, { deadline } = {}) {
	const ticket = deadline ? newTicket() : null;
	const attempt = async (tierId, withInternal) => {
		const payload = {
			...(prompt ? { prompt } : {}),
			...(Array.isArray(imageUrls) && imageUrls.length ? { image_urls: imageUrls } : {}),
			...(aspect ? { aspect_ratio: aspect } : {}),
			...(backend ? { backend } : {}),
			...(path ? { path } : {}),
			...(tierId ? { tier: tierId } : {}),
			...(director === false ? { director: false } : {}),
		};
		let res;
		try {
			res = await fetch(`${base}/api/gpt-forge`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(withInternal ? internalHeaders() : {}),
					...(ticket ? { [TICKET_HEADER]: ticket } : {}),
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(submitWindow(deadline, SUBMIT_TIMEOUT_MS, ticket ? TICKET_SUBMIT_FLOOR_MS : SUBMIT_FLOOR_MS)),
			});
		} catch (err) {
			if (err?.name === 'TimeoutError' || err?.name === 'AbortError')
				throw failure('timeout', 'the 3D generator took too long to accept the job; try again');
			throw failure('provider_error', `the 3D generator is unreachable: ${err?.message || err}`);
		}
		const data = await res.json().catch(() => ({}));
		return { res, data };
	};

	let res;
	let data;
	try {
		({ res, data } = await attempt(tier, !!internal));
	} catch (err) {
		if (err?.code !== 'timeout') throw err;
		// The submit is still running server-side and will record its job under
		// the ticket, so hand back the ticket's handle rather than submit a
		// second job or report a timeout.
		if (ticket) return { status: 'submitting', job_id: ticketHandle(ticket) };
		// A bounded call that spent its budget on the first submit has no time
		// left for a second one; the caller reports the timeout instead.
		if (deadline && deadline - Date.now() < SUBMIT_FLOOR_MS) throw err;
		// One more shot at the accept path before giving up: the async lanes 202
		// in milliseconds, so a submit that blocked to the deadline almost always
		// hit a cold start or a blocking fallback lane. High tier degrades to the
		// async standard router; other tiers retry as submitted.
		if (tier === 'high' && strictTier)
			throw failure('tier_unavailable', 'the high-detail lane did not accept the job in time; try again shortly', { retryAfter: 30 });
		if (tier === 'high') ({ res, data } = await attempt('standard', false));
		else ({ res, data } = await attempt(tier, !!internal));
	}
	if (res.status === 402 && tier === 'high' && strictTier)
		throw failure('tier_unavailable', 'the high-detail lane is not accepting operator-funded jobs right now; try again shortly', { retryAfter: 60 });
	if (res.status === 402 && tier === 'high') ({ res, data } = await attempt('standard', false));
	if (res.status === 503) throw failure('not_configured', data?.message || '3D generation is not configured on this deployment');
	if (res.status === 429) throw failure('busy', data?.message || 'the 3D generator is busy; try again shortly', { retryAfter: data?.retry_after });
	const completedSync = data?.status === 'done' && data?.glb_url;
	if (!res.ok || !(data?.job_id || completedSync)) throw failure('provider_error', data?.message || `the 3D generator returned ${res.status}`);
	return data;
}

export async function startRig(base, glbUrl, { deadline } = {}) {
	let res;
	try {
		res = await fetch(`${base}/api/gpt-forge?action=rig`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ glb_url: glbUrl }),
			signal: AbortSignal.timeout(submitWindow(deadline, RIG_SUBMIT_TIMEOUT_MS)),
		});
	} catch (err) {
		if (err?.name === 'TimeoutError' || err?.name === 'AbortError')
			throw failure('timeout', 'the rigger took too long to accept the job; try again');
		throw failure('provider_error', `the rigger is unreachable: ${err?.message || err}`);
	}
	const data = await res.json().catch(() => ({}));
	if (res.status === 503 || res.status === 501) throw failure('not_configured', data?.message || 'auto-rigging is not enabled on this deployment');
	if (res.status === 429) throw failure('busy', data?.message || 'the rigger is busy; try again shortly', { retryAfter: data?.retry_after });
	if (!res.ok || !data?.job_id) throw failure('provider_error', data?.message || `the rigger returned ${res.status}`);
	return data;
}

// Poll a /api/gpt-forge job to a terminal state. Returns the done payload, throws a
// coded failure on a failed job, or returns { _timedOut: true } at the deadline.
// `deadline` (epoch ms) caps the wait below timeoutMs when the caller's own call
// budget ends sooner; no probe or sleep is allowed to run past it.
export async function pollJob(base, jobId, { timeoutMs, intervalMs, deadline: callDeadline, onPoll } = {}) {
	const tMs = timeoutMs || DEFAULT_TIMEOUT_MS;
	const deadline = Math.min(Date.now() + tMs, callDeadline || Infinity);
	const left = () => deadline - Date.now();
	// Gentle backoff: start at the configured cadence and stretch toward a cap,
	// so a minutes-long self-host job costs ~a third of the self-calls a fixed
	// 3s cadence would fire at the shared mcp3dStatus rate bucket.
	let iMs = intervalMs || DEFAULT_POLL_MS;
	const maxIMs = Math.max(iMs, envNum('STUDIO_POLL_MAX_MS', 10_000));
	let last = null;
	let softFails = 0;
	while (Date.now() < deadline) {
		let res = null;
		let data = {};
		try {
			res = await fetch(`${base}/api/gpt-forge?job=${encodeURIComponent(jobId)}`, {
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(Math.max(1_000, Math.min(Math.max(iMs * 3, 15_000), left()))),
			});
			data = await res.json().catch(() => ({}));
		} catch {
			res = null;
		}
		// Transient conditions (a network blip, the shared status rate bucket
		// answering 429, a 5xx from a rolling deploy) must NOT kill the loop:
		// the job is still running server-side and this handle is the only way
		// back to it. Only a clean, definitive 4xx (bad/expired job id) throws.
		if (!res || res.status === 429 || res.status >= 500) {
			if (++softFails >= 20) {
				// Persistently unreachable: hand back the pending shape so the
				// caller returns a pollable handle, never a dead error.
				return { ...(last || {}), _timedOut: true };
			}
			await sleep(Math.max(0, Math.min(iMs, left())));
			iMs = Math.min(maxIMs, Math.round(iMs * 1.35));
			continue;
		}
		if (!res.ok) throw failure('provider_error', data?.message || `generation poll returned ${res.status}`);
		softFails = 0;
		last = data;
		// Tell a progress listener what the job just reported. A listener that
		// throws must never cost the caller their generation.
		if (onPoll) {
			try {
				onPoll(data);
			} catch {
				/* progress is advisory */
			}
		}
		if (data.status === 'done' && data.glb_url) return data;
		if (data.status === 'failed') {
			throw failure('generation_failed', data.error || 'generation failed', {
				retryBackends: Array.isArray(data.retry_backends) ? data.retry_backends : undefined,
			});
		}
		await sleep(Math.max(0, Math.min(iMs, left())));
		iMs = Math.min(maxIMs, Math.round(iMs * 1.35));
	}
	return { ...(last || {}), _timedOut: true };
}

// Single status probe for the check_job tool: one GET, no loop. Throws a coded
// failure only on a definitive non-2xx; the caller decides how to render each
// status.
//
// A definitive 4xx means the HANDLE is wrong, not that the generator broke: forge
// answers a malformed or unrecognized job id with 400 invalid_job / 404. Those get
// their own `unknown_job` code so the caller can say "that handle is not valid any
// more, start a new generation" instead of the generic retry copy, which sends the
// user back to a probe that can never succeed.
export async function pollOnce(base, jobId) {
	let res;
	try {
		// The FIRST poll that finds a job done materializes the creation and runs
		// the quality gate (20-30 s measured); every later poll of that job is
		// served from the done-frame cache in milliseconds. 30 s covers the one
		// slow read without letting a stalled upstream hold a buyer for a minute.
		res = await fetch(`${base}/api/gpt-forge?job=${encodeURIComponent(jobId)}`, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(30_000),
		});
	} catch (err) {
		if (err?.name === 'TimeoutError' || err?.name === 'AbortError')
			throw failure('timeout', 'the status check timed out; try again');
		throw failure('provider_error', `the status check is unreachable: ${err?.message || err}`);
	}
	const data = await res.json().catch(() => ({}));
	if (res.status === 429) throw failure('busy', data?.message || 'status checks are rate limited; try again shortly', { retryAfter: data?.retry_after });
	if (res.status === 400 || res.status === 404) throw failure('unknown_job', data?.message || 'that job id is not recognized');
	if (!res.ok) throw failure('provider_error', data?.message || `the status check returned ${res.status}`);
	return data;
}

// Run a submit→poll cycle end to end, returning the terminal job payload.
// A timed-out payload keeps `job_id` so the caller can hand the (still
// running) job back to the client as a pollable handle instead of an error.
export async function generate(base, submitArgs, { timeoutEnv, deadline, onPoll } = {}) {
	const job = await startForge(base, submitArgs, { deadline });
	if (job.status === 'done' && job.glb_url) return job;
	// The submit outlived the call budget: its ticket handle is the job id.
	if (job.status === 'submitting') return { _timedOut: true, job_id: job.job_id };
	const out = await pollJob(base, job.job_id, {
		timeoutMs: timeoutEnv ? envNum(timeoutEnv, DEFAULT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
		intervalMs: envNum('STUDIO_POLL_MS', DEFAULT_POLL_MS),
		deadline,
		onPoll,
	});
	return out._timedOut ? { ...out, job_id: job.job_id } : out;
}

export async function rig(base, glbUrl, { timeoutEnv, deadline, onPoll } = {}) {
	const job = await startRig(base, glbUrl, { deadline });
	const out = await pollJob(base, job.job_id, {
		timeoutMs: timeoutEnv ? envNum(timeoutEnv, DEFAULT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
		intervalMs: envNum('STUDIO_POLL_MS', DEFAULT_POLL_MS),
		deadline,
		onPoll,
	});
	return out._timedOut ? { ...out, job_id: job.job_id } : out;
}

// IBM Granite prompt director. Rewrites a rough idea into a tight single-subject
// 3D spec. Runs IN PROCESS: watsonx Granite leads, and the shared free-first LLM
// chain (llmComplete, the same one forge-enhance rides) is the fallback. The
// previous implementation POSTed provider=watsonx to its own /api/chat, which
// the anonymous-provider gate 401s (chat.js pins anon callers to the free
// providers), so the director silently never ran on any surface. Fail-soft:
// returns null on any failure so the caller forwards the original prompt
// unchanged, never faked.
// A complete director spec (subject, construction, materials, lighting, framing,
// negatives) measures ~800 characters, which is right at what 200 tokens buys.
// With no headroom, any model even slightly more verbose than average had its
// answer cut mid-clause, and the fragment was then forwarded as the brief:
// observed on production 2026-08-07, "a red wooden rocking chair" directed to
// "A classic wooden rocking chair with gracefully curved" and "a small ceramic
// teapot with a bamboo handle" to "A small,", which reconstructed as a coffee
// tamper. Budget for a whole spec instead of a clipped one.
const DIRECTOR_MAX_TOKENS = 400;
// ONE bound for the whole director step, watsonx and the fallback chain
// together. Each leg used to carry its own 20 s, so a stalled watsonx followed
// by a stalled chain cost 40 s before the paint step began; measured live on
// 2026-08-27 as the gap between a 60 s paint budget and 110 s submits. The
// director is a quality lever, not a requirement: past this it is skipped.
const DIRECTOR_TIMEOUT_MS = 15_000;
const DIRECTOR_WATSONX_SHARE_MS = 6_000;

// Longest brief we forward. The director's own specs land near 800 characters;
// beyond this the model has stopped writing a prompt and started writing prose.
const DIRECTOR_MAX_CHARS = 1000;

// The director's system prompts ask for a complete spec, and a complete spec is
// a finished sentence: every well-formed one observed in production closes on a
// period after its negatives clause ("...no second subject."). A generation that
// ran out of tokens cannot, which makes terminal punctuation the one signal that
// separates a whole brief from a clipped one without guessing at grammar. Both
// production truncations fail it, as does any fragment ending on a separator or
// a dangling connective, with no per-word list to keep current.
const ENDS_COMPLETE = /[.!?]["'\u201d\u2019)\]]*$/;

// Decide whether a director rewrite is safe to forward in place of the user's
// own words. The director is a quality lever that must never cost a caller their
// intent, so anything that fails this check falls back to the raw prompt rather
// than shipping a fragment. Erring toward rejection is cheap: the fallback is
// the caller's own wording, which is always a valid brief. Pure: same inputs to
// same verdict.
export function isUsableDirectorRewrite(refined, rawPrompt) {
	if (typeof refined !== 'string') return false;
	const text = refined.trim();
	if (text.length < 3 || text.length > DIRECTOR_MAX_CHARS) return false;
	if (!ENDS_COMPLETE.test(text)) return false;
	// A brief describes an object; it never carries a link. A URL or a markdown
	// link means the reply is a provider notice ("raise the key budget at
	// https://...") or chatter, and reconstructing a mesh from it is how 22
	// production generations came out of a billing message.
	if (/https?:\/\/|\]\(|\bwww\./i.test(text)) return false;
	// The director's contract is to ENRICH a rough idea into a denser spec. A
	// result no longer than what the caller typed has added nothing, and is more
	// likely a clipped opening clause than a genuine tightening, so the user's
	// own wording is the better brief.
	const raw = String(rawPrompt ?? '').trim();
	if (raw && text.length <= raw.length) return false;
	return true;
}

export async function directPrompt(instruction, rawPrompt) {
	const user = `Idea: ${rawPrompt}`;
	let text = null;

	// watsonxChatComplete carries no abort signal of its own, so cap it here; a
	// hung IAM or inference call must degrade to the free chain, not stall the
	// whole generation submit.
	const cfg = watsonxConfig();
	const deadline = Date.now() + DIRECTOR_TIMEOUT_MS;
	const remaining = () => deadline - Date.now();
	if (cfg.configured) {
		let timer;
		try {
			const result = await Promise.race([
				watsonxChatComplete(cfg, {
					messages: [
						{ role: 'system', content: instruction },
						{ role: 'user', content: user },
					],
					maxTokens: DIRECTOR_MAX_TOKENS,
				}),
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error('watsonx director timed out')),
						Math.min(DIRECTOR_WATSONX_SHARE_MS, remaining()),
					);
				}),
			]);
			text = result?.text || null;
		} catch {
			text = null;
		} finally {
			clearTimeout(timer);
		}
	}

	if (!text && remaining() > 2_000) {
		try {
			const result = await llmComplete({
				system: instruction,
				user,
				maxTokens: DIRECTOR_MAX_TOKENS,
				timeoutMs: remaining(),
				track: { tool: 'forge-director' },
			});
			text = result?.text || null;
		} catch {
			return null;
		}
	}

	if (!text) return null;
	// First line only, then strip wrapping quotes; the reverse order leaves a
	// dangling quote when the model adds commentary lines after a quoted prompt.
	const firstLine = text.trim().split('\n')[0].trim();
	const refined = firstLine.replace(/^["'“”]+|["'“”]+$/g, '').trim();
	// Returning null here is the documented fail-soft path: the caller forwards
	// the caller's original prompt unchanged, which is always a valid brief.
	return isUsableDirectorRewrite(refined, rawPrompt) ? refined : null;
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
