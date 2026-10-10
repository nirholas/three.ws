// three.ws 3D Studio (free) — tool catalog + handlers.
//
// This module holds eight of the connector's eleven tools: the six generation
// tools (five generators plus refine_model) + check_job + look_at_model. The
// other three (create_agent_persona, get_agent_persona, persona_say) live in
// ./persona-tools.js, and dispatch.js merges both catalogs into the single
// tools/list the endpoint serves. docs/mcp-studio.md splits the catalog the
// same way, and tests/mcp-studio.test.js pins the total at eleven.
//
// All eight are FREE (no x402, no
// wallet, no API key): the platform's server-side keys cover provider cost via
// /api/forge (the public, auth-free twin of the paid pipeline). refine_model adds
// conversational iteration — describe a change and it re-generates a new version
// anchored to the prior model, returning a revertable/branchable version lineage.
// Responses carry ONLY what a client needs
// to show the model — a GLB URL, a viewer link, the kind, and the prompt — with
// every internal identifier (creation id, prediction id, backend name, trace)
// stripped, per OpenAI's data-minimization policy. One deliberate exception:
// a job that outlives the inline wait budget returns its PUBLIC poll handle
// (the same job token the auth-free /api/forge REST lane hands any anonymous
// caller); without it the still-running work would be unreachable.
// Every model-bearing result also carries the four agent-first links from
// ./asset-links.js (viewer_url, glb_url, poster_png_url, embed_html), stated in
// the first lines of its text too, for clients that render no widget.
// Each tool links the Apps SDK widget via _meta["openai/outputTemplate"] and returns structuredContent
// the widget renders. No coin, token, wallet, or payment surface anywhere.

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { assertSafePublicUrl, SsrfBlockedError } from '../_lib/ssrf-guard.js';
import {
	meshDirectorFor,
	meshSubjectClass,
	avatarDirectorFor,
	classifySubject,
	resolveLogoPrompt,
} from '../_lib/forge-director-prompts.js';
import { checkPromptSafety } from './safety.js';
import {
	originFromReq,
	viewerUrl,
	arLaunchUrl,
	irlUrl,
	generate,
	rig,
	pollOnce,
	directPrompt,
} from './gpt-forge-client.js';
import { COMPONENT_URI } from './component.js';
import { assetLinks, assetLinksText } from './asset-links.js';
import { runOnce, normalizeKey, argsDigest } from '../_lib/idempotency.js';
import { renderTurntable, describeGeometry, fetchGeometryStats } from '../_lib/3d-vision.js';
import { buildSpatialArtifact } from '../_lib/spatial-mcp.js';
// The same pure cold-start core the browser surfaces render from
// (src/shared/forge-frames.js). Zero DOM, zero env, zero network, so it is safe
// server-side, and sharing it is what keeps the MCP wording from drifting away
// from what /forge and the homepage chamber say about the identical job.
import { coldStartState } from '../../src/shared/forge-frames.js';
// Pure, dependency-free lineage core — the SAME module the paid stdio server's
// runRefineModel uses (mcp-server/src/tools/_lineage.js), so conversational
// iteration behaves identically on both tracks and never drifts. It carries
// zero payment/coin/wallet surface — safe to import into the free studio bundle.
import {
	composeRefinement,
	seedLineage,
	appendVersion,
	summarizeLineage,
	buildLineageChain,
	branchFrom,
} from '../../mcp-server/src/tools/_lineage.js';

const VALID_TIER = new Set(['draft', 'standard', 'high']);

// ── result helpers ──────────────────────────────────────────────────────────

// The bucket's public r2.dev domain only answers CORS for our own origin, but
// ChatGPT renders the widget in a sandboxed cross-origin iframe — model-viewer
// there can only fetch a GLB served with open CORS. /cdn/<key> (api/cdn-object.js)
// streams the same object first-party with `access-control-allow-origin: *`, so
// every URL a widget must fetch goes out in its CDN form.
function firstPartyGlbUrl(glbUrl, base) {
	const pub = process.env.S3_PUBLIC_DOMAIN;
	if (!pub || !base || typeof glbUrl !== 'string' || !glbUrl.startsWith(`${pub}/`)) return glbUrl;
	return `${base}/cdn/${glbUrl.slice(pub.length + 1)}`;
}

// Minimal, identifier-free success envelope. structuredContent is the contract
// the widget + model read; content is the human/agent-readable narration.
function ok({ glbUrl, base, kind, prompt, rigged, referenceImageUrl }) {
	glbUrl = firstPartyGlbUrl(glbUrl, base);
	// An avatar (rigged or humanoid) is an agent's body, not a prop: it also gets
	// the IRL living handoff: walk it, talk to it, camera AR in the real room.
	const live = Boolean(rigged) || kind === 'avatar';
	const vUrl = viewerUrl(base, glbUrl);
	const aUrl = arLaunchUrl(base, glbUrl, prompt, { live });
	const iUrl = live ? irlUrl(base, glbUrl) : '';
	// The painted concept view the generator sculpted from — the forge's
	// image-generation first step. https-only; the widget uses it as the
	// model-viewer poster so something visual shows while the GLB streams in.
	const refImg =
		typeof referenceImageUrl === 'string' && /^https:\/\//.test(referenceImageUrl)
			? firstPartyGlbUrl(referenceImageUrl, base)
			: '';
	// The four plain links a widget-less agent needs (asset-links.js). Additive:
	// the widget keeps reading the camelCase fields below.
	const links = assetLinks({ base, glbUrl, kind, title: prompt, rigged });
	const structured = {
		kind,
		glbUrl,
		viewerUrl: vUrl,
		arUrl: aUrl,
		format: 'glb',
		...links,
		...(prompt ? { prompt } : {}),
		...(rigged ? { rigged: true } : {}),
		...(iUrl ? { irlUrl: iUrl } : {}),
		...(refImg ? { referenceImageUrl: refImg } : {}),
		// Spatial MCP artifact — the open, coin-clean shape for a 3D-native tool
		// result (specs/SPATIAL_MCP.md). Additive to the fields the widget already
		// reads, so any Spatial-MCP renderer can display this model, not just ours.
		spatial: buildSpatialArtifact({
			glbUrl,
			kind: rigged ? 'rigged-model' : kind === 'avatar' ? 'avatar' : kind === 'mesh' ? 'mesh' : 'model',
			viewerUrl: vUrl,
			prompt: prompt || undefined,
			rigged: Boolean(rigged),
			ar: { glbUrl, launchUrl: aUrl },
		}),
	};
	const label = rigged ? 'rigged 3D model' : '3D model';
	const refLine = refImg ? `\nConcept image it was sculpted from: ${refImg}` : '';
	// Links lead, so a text-only client reads them before any narration.
	return {
		content: [
			{
				type: 'text',
				text:
					`Generated a ${label} (GLB).\n${assetLinksText(links)}\n` +
					(iUrl
						? `Bring it to life in your real room (it moves and talks through the camera, open on a phone): ${iUrl}\n` +
							`Place a static copy in AR: ${aUrl}`
						: `Place it in your room (AR, open on a phone): ${aUrl}`) +
					refLine,
			},
		],
		structuredContent: structured,
	};
}

// `extra` carries machine-readable facts about the failure, such as
// `retryable: true` when the job is fine and only the check itself failed.
function toolError(message, extra = {}) {
	return {
		content: [{ type: 'text', text: message }],
		structuredContent: { error: true, message, ...extra },
		isError: true,
	};
}

// Lift the timing/warmth facts a poll payload carries into the shape
// pendingResult() reads. One helper rather than seven inline spreads, so a new
// field reaches every tool at once instead of the six that got remembered.
// Every value is passed straight through; nothing here is derived from a local
// clock, so a job handed back after a client reconnect reports the JOB's age.
function pendingTiming(job) {
	return {
		etaRemainingSeconds: job?.eta_remaining_seconds,
		// null when the API is not reporting a boot on this frame.
		cold: coldStartState(job || {}),
	};
}

// Success envelope for a job that outlived the inline wait budget but IS still
// running. This used to be an error, which threw away real work: with the
// self-host TRELLIS lane as forge primary a generation takes 4-6 minutes, the
// inline wait is 3, so every hosted studio call "failed" while its model
// quietly finished minutes later and the caller never learned. The job handle
// is public (the free /api/forge poll endpoint takes it with no auth), so hand
// it over and let the caller collect the result.
//
// `next: 'rig'` marks a mesh that the caller asked to have rigged (forge_avatar
// ran out of budget before the rig stage). The viewer widget reads it and runs
// rig_mesh itself once the mesh lands, so the user still ends with the rigged
// avatar they asked for rather than a bare mesh.
//
// `refine` rides along on a pending refinement: the version history the new
// model joins. A client hands it back to check_job, which appends the finished
// version the same way refine_model would have, so the version strip survives
// the wait.
function pendingResult({ base, jobId, what, prompt, etaRemainingSeconds, stage = 'mesh', cold = null, next = null, refine = null }) {
	// The ChatGPT pipeline's own endpoint, not /api/forge: the whole point of
	// the clone is that this surface can evolve independently.
	const pollUrl = `${base}/api/gpt-forge?job=${encodeURIComponent(jobId)}`;
	// No GLB exists yet, so there is no file, poster or embed to hand over. What a
	// widget-less agent CAN use is a page that finishes the wait itself: the viewer
	// polls this job and opens the model the moment it lands (public/viewer.html).
	const watchUrl = `${base}/viewer?job=${encodeURIComponent(jobId)}`;
	const eta = Number.isFinite(Number(etaRemainingSeconds)) && Number(etaRemainingSeconds) > 0
		? Math.round(Number(etaRemainingSeconds))
		: null;
	const elapsed = cold?.elapsedSeconds ?? null;
	// A queued job on a scale-to-zero worker is a container boot, not a slow
	// render, and saying so is the difference between a client that waits and a
	// client that retries into the same boot. Every number comes off the poll
	// payload via coldStartState; when the API reports the boot without a budget
	// we name the state and promise no time rather than inventing one.
	let head;
	if (cold) {
		const inNote = elapsed != null && elapsed >= 5 ? `, ${elapsed}s in` : '';
		const budget =
			cold.remainingSeconds != null
				? ` (about ${cold.remainingSeconds}s of boot left${inNote})`
				: cold.pastBudget
					? ` (past its usual ${cold.budgetSeconds}s boot${inNote})`
					: cold.budgetSeconds != null
						? ` (about ${cold.budgetSeconds}s)`
						: '';
		head =
			`The GPU worker for this ${what} is waking up${budget}. ` +
			'The job is accepted and rendering starts the moment it answers';
	} else {
		head = `The ${what} is still rendering (heavier scenes take a few minutes)${eta ? ` (roughly ${eta}s to go)` : ''}`;
	}
	// Point the retry at the BOOT when one is running: telling a caller to come
	// back in the render ETA when the worker answers sooner wastes the difference.
	const retryIn = cold?.remainingSeconds ?? eta;
	const message =
		`${head}. ` +
		`It keeps running: call the check_job tool with this job_id${retryIn ? ` in ~${retryIn}s` : ' shortly'} to collect it, ` +
		`or poll ${pollUrl} until status is "done", then use its glb_url ` +
		`(view at ${base}/viewer?src=<glb_url>).\n` +
		`Viewer (opens the model by itself the moment it is ready): ${watchUrl}`;
	return {
		content: [{ type: 'text', text: message }],
		structuredContent: {
			status: 'pending',
			jobId,
			job_id: jobId,
			pollUrl,
			viewer_url: watchUrl,
			// Which half of the pipeline is still running. A client that collects
			// the job needs this to know whether the GLB it gets back is a bare
			// mesh (rig it) or the finished rig (use it). Identifier-free, so it
			// costs the data-minimization rule nothing.
			stage,
			...(next ? { next } : {}),
			...(eta ? { etaRemainingSeconds: eta } : {}),
			// Machine-readable twin of the sentence above, so a client can render
			// its own "waking up" state instead of parsing prose.
			...(cold
				? {
						coldStart: true,
						...(cold.budgetSeconds != null ? { coldStartSeconds: cold.budgetSeconds } : {}),
						...(cold.remainingSeconds != null ? { coldStartRemainingSeconds: cold.remainingSeconds } : {}),
					}
				: {}),
			...(elapsed != null ? { elapsedSeconds: elapsed } : {}),
			...(prompt ? { prompt } : {}),
			...(refine ? { refine } : {}),
		},
	};
}

// Success envelope for a conversational refinement. Carries the same minimal,
// identifier-free fields as ok() PLUS the version lineage the widget renders as
// a version strip. The lineage is the durable record the client passes back on
// the next refinement (parent_lineage) so branch/revert work without any
// server-side session — a pointer move over an immutable array, never a mutation.
function refineOk({ glbUrl, base, prompt, instruction, lineage, activeIndex }) {
	glbUrl = firstPartyGlbUrl(glbUrl, base);
	const vUrl = viewerUrl(base, glbUrl);
	const aUrl = arLaunchUrl(base, glbUrl, instruction || prompt);
	const links = assetLinks({ base, glbUrl, kind: 'refined model', title: instruction || prompt });
	const structured = {
		kind: 'refined model',
		glbUrl,
		viewerUrl: vUrl,
		arUrl: aUrl,
		format: 'glb',
		...links,
		...(prompt ? { prompt } : {}),
		...(instruction ? { instruction } : {}),
		// Version chips swap GLBs inside the same sandboxed iframe, so every
		// lineage URL needs the CDN form too — and its own AR launch link so the
		// Place-in-AR button tracks the selected version.
		lineage: summarizeLineage(lineage, activeIndex).map((v) => {
			const vGlb = firstPartyGlbUrl(v.glbUrl, base);
			return { ...v, glbUrl: vGlb, arUrl: arLaunchUrl(base, vGlb, v.instruction || prompt) };
		}),
		activeIndex,
		// Conformant Spatial MCP artifact (specs/SPATIAL_MCP.md) for the refined model.
		spatial: buildSpatialArtifact({
			glbUrl,
			kind: 'model',
			viewerUrl: vUrl,
			prompt: prompt || undefined,
			title: instruction || undefined,
			ar: { glbUrl, launchUrl: aUrl },
		}),
	};
	const versionNo = activeIndex; // 0 = original, 1 = first refinement, …
	return {
		content: [
			{
				type: 'text',
				text:
					`Refined the model (v${versionNo}: "${instruction}").\n${assetLinksText(links)}\n` +
					`Place it in your room (AR, open on a phone): ${aUrl}`,
			},
		],
		structuredContent: structured,
	};
}

// Map a coded forge-client failure to a clean, user-facing message — never leak
// provider internals, hostnames, or stack text.
function failureMessage(err) {
	switch (err?.code) {
		case 'timeout':
			return 'Generation is taking longer than expected. Please try again.';
		case 'busy': {
			const wait = Number(err?.retryAfter);
			return Number.isFinite(wait) && wait > 0
				? `The 3D generator is busy right now. Try again in about ${Math.ceil(wait)}s.`
				: 'The 3D generator is busy right now. Please try again in a moment.';
		}
		case 'not_configured':
			return 'This capability is temporarily unavailable. Please try again later.';
		case 'generation_failed':
			return 'Generation failed for this prompt. Try again (a retry is routed to a healthy engine) or rephrase it.';
		// A dead handle, not a broken generator: the generic retry copy sent the
		// caller back to a probe that can never succeed. Point them at the one
		// action that does work.
		case 'unknown_job':
			return 'That job id is not recognized (it may be mistyped or expired). Start a new generation to get a fresh one.';
		default:
			return 'Could not generate the model right now. Please try again.';
	}
}

async function guardImage(url) {
	if (!url) return;
	try {
		await assertSafePublicUrl(url);
	} catch (err) {
		if (err instanceof SsrfBlockedError) throw Object.assign(new Error('That image URL is not allowed.'), { userMessage: true });
		throw err;
	}
}

// Compact humanoid heuristic for the avatar gate — auto-rigging assumes a biped.
// A clearly non-humanoid subject is steered to mesh generation instead of
// silently wasting a rig pass. Conservative: only obvious objects/quadrupeds
// short-circuit; ambiguous prompts proceed.
const NON_HUMANOID = /\b(chair|sofa|couch|table|desk|lamp|car|truck|vehicle|building|house|tree|plant|sword|gun|bottle|cup|mug|phone|laptop|rock|stone|food|fruit|flower|dog|cat|horse|cow|fish|bird|dragon|snake|spider|dinosaur)\b/i;
const HUMANOID = /\b(human|person|man|woman|boy|girl|character|avatar|hero|warrior|knight|robot|android|figure|mascot|humanoid|biped|wizard|elf|orc|zombie|ninja|soldier|astronaut)\b/i;

function looksNonHumanoid(prompt) {
	const t = String(prompt || '');
	return NON_HUMANOID.test(t) && !HUMANOID.test(t);
}

// Tier for AVATAR generation specifically (a person, not a prop).
//
// The router maps the image path's high tier to the self-hosted Hunyuan3D lane
// and standard to TRELLIS (GET /api/forge?catalog, default_backend_for_tier).
// On people that is the difference the whole likeness bar rests on: Hunyuan3D
// is the organic/portrait-strength lane, and it is what the avatar skill has
// documented these tools to request all along ("Both avatar tools always
// request the platform's `high` quality tier under the hood"). The code was
// still sending `standard`, so every avatar quietly came back off the weaker
// lane while the docs promised otherwise.
//
// Asking for high is safe rather than a latency gamble: startForge degrades an
// explicit high request to standard on a 402 (a deployment without the platform
// seed token) or on a submit timeout, and a slow job returns a pollable handle
// instead of an error. So the worst case is exactly today's behaviour.
//
// Props stay on standard. handleForgeFree documents its own reasoning for that
// and a coffee cup gains nothing from the portrait lane.
const AVATAR_TIER = 'high';

// The avatar director is fail-soft, and when it fails the raw words ("a knight
// in silver plate armor") go to a portrait-leaning lane that answers with a
// head-and-shoulders bust: a model that cannot be rigged into anything posable.
// The fallback therefore still states the framing the director would have, so
// an outage on the LLM chain costs polish, never the body.
export function avatarFallbackBrief(prompt, subject) {
	return subject === 'animal'
		? `${prompt}, full body, the whole animal in frame from head to tail and feet, standing, centered on a plain neutral background`
		: `${prompt}, full-body character standing in a neutral A-pose, arms slightly away from the body, legs slightly apart, the entire figure in frame head to toe, centered on a plain neutral background`;
}

// ── handlers ────────────────────────────────────────────────────────────────

// The generating handlers below direct the prompt themselves, so each submit
// carries `director: false`: /api/gpt-forge would otherwise run its own director
// over the already-directed brief. refine_model is the exception; it composes
// rather than directs, and keeps the server's pass.

async function handleForgeFree(args, _auth, req, ctx = {}) {
	const base = originFromReq(req);
	const prompt = String(args.prompt || '').trim();
	if (prompt.length < 3) return toolError('Provide a text prompt of at least 3 characters.');
	const safety = checkPromptSafety(prompt);
	if (!safety.allowed) return toolError(safety.message);
	// Standard by default, and every doc describing this tool says exactly that.
	// The high tier is a real, working option, not a stub: it runs on our own
	// async Hunyuan3D worker (GCP_HUNYUAN3D_URL) behind a genuine poll handle,
	// and a live production probe on 2026-08-06 returned a 2.69 MB high-tier GLB
	// from backend `hunyuan3d` end to end. It stays opt-in rather than default
	// for two reasons a caller cannot see: that worker is scale-to-zero, so a
	// cold container adds a spin-up on top of the generation, and the high-tier
	// access gate is cleared only by the platform seed token, so any deployment
	// without CRON_SECRET would quietly serve standard while a "high by default"
	// promise stayed on the page. startForge degrades an explicit high request to
	// standard on a 402 or submit timeout, and a job that outlives
	// STUDIO_FORGE_TIMEOUT_MS comes back as a pollable handle, never an error.
	const tier = VALID_TIER.has(args.tier) ? args.tier : 'standard';
	// Known brand marks resolve deterministically; everything else runs the
	// subject-classified Granite director (fail-soft: original prompt on any
	// failure) so this free lane gets the same photoreal-reference treatment as
	// mesh_forge instead of reconstructing straight from the raw words.
	let effective = prompt;
	let markImageUrls;
	const knownMark = resolveLogoPrompt(prompt);
	if (knownMark) {
		effective = knownMark.prompt;
		if (knownMark.imagePath) markImageUrls = [`${base}${knownMark.imagePath}`];
	} else {
		const directed = await directPrompt(meshDirectorFor(meshSubjectClass(prompt)), prompt);
		if (directed) effective = directed;
	}
	let job;
	try {
		job = await generate(
			base,
			markImageUrls
				? { prompt: effective, imageUrls: markImageUrls, tier, internal: true, director: false }
				: { prompt: effective, path: 'image', tier, internal: true, director: false },
			{ timeoutEnv: 'STUDIO_FORGE_TIMEOUT_MS', deadline: ctx.deadline, onPoll: ctx.onPoll },
		);
	} catch (err) {
		return toolError(failureMessage(err));
	}
	if (job._timedOut && job.job_id) return pendingResult({ base, jobId: job.job_id, what: 'model', prompt, ...pendingTiming(job) });
	if (job._timedOut || !job.glb_url) return toolError('Generation is taking longer than expected. Please try again.');
	return ok({ glbUrl: job.glb_url, base, kind: 'model', prompt, referenceImageUrl: job.preview_image_url });
}

async function handleTextToAvatar(args, _auth, req, ctx = {}) {
	const base = originFromReq(req);
	const prompt = String(args.prompt || '').trim();
	const imageUrl = args.image_url ? String(args.image_url).trim() : '';
	if (!prompt && !imageUrl) return toolError('Provide a text prompt or a reference image_url.');
	if (prompt) {
		const safety = checkPromptSafety(prompt);
		if (!safety.allowed) return toolError(safety.message);
	}
	try {
		await guardImage(imageUrl);
	} catch (err) {
		return toolError(err.userMessage ? err.message : 'That image URL could not be used.');
	}
	// Granite avatar director (text mode only, fail-soft): without this the raw
	// words reconstructed straight into TRELLIS/Hunyuan3D with no photoreal
	// reference-image briefing at all — the realism gap forge_avatar already closes.
	let effective = prompt;
	if (prompt && !imageUrl) {
		const subject = classifySubject(prompt) === 'animal' ? 'animal' : 'person';
		const directed = await directPrompt(avatarDirectorFor(subject), prompt);
		effective = directed || avatarFallbackBrief(prompt, subject);
	}
	let job;
	try {
		job = await generate(
			base,
			{ prompt: effective || undefined, imageUrls: imageUrl ? [imageUrl] : undefined, aspect: '1:1', tier: AVATAR_TIER, internal: true, director: false },
			{ timeoutEnv: 'STUDIO_FORGE_TIMEOUT_MS', deadline: ctx.deadline, onPoll: ctx.onPoll },
		);
	} catch (err) {
		return toolError(failureMessage(err));
	}
	if (job._timedOut && job.job_id) return pendingResult({ base, jobId: job.job_id, what: 'avatar', prompt: prompt || undefined, ...pendingTiming(job) });
	if (job._timedOut || !job.glb_url) return toolError('Generation is taking longer than expected. Please try again.');
	return ok({ glbUrl: job.glb_url, base, kind: 'avatar', prompt: prompt || undefined, referenceImageUrl: job.preview_image_url });
}

async function handleMeshForge(args, _auth, req, ctx = {}) {
	const base = originFromReq(req);
	const prompt = String(args.prompt || '').trim();
	const imageUrl = args.image_url ? String(args.image_url).trim() : '';
	if (!prompt && !imageUrl) return toolError('Provide a text prompt or a reference image_url.');
	if (prompt) {
		const safety = checkPromptSafety(prompt);
		if (!safety.allowed) return toolError(safety.message);
	}
	try {
		await guardImage(imageUrl);
	} catch (err) {
		return toolError(err.userMessage ? err.message : 'That image URL could not be used.');
	}
	// Known brand marks resolve deterministically (no LLM knows a niche mark's
	// geometry; the lexicon spec is already tight, so a rewrite could only hurt)
	// and, when a pre-rendered reference view ships with the mark, go image→3D
	// for an exact reconstruction. Everything else runs the Granite prompt
	// director (text mode only; fail-soft — original prompt on any failure).
	let effective = prompt;
	let markImageUrls;
	if (prompt && !imageUrl) {
		const knownMark = resolveLogoPrompt(prompt);
		if (knownMark) {
			effective = knownMark.prompt;
			if (knownMark.imagePath) markImageUrls = [`${base}${knownMark.imagePath}`];
		} else {
			const directed = await directPrompt(meshDirectorFor(meshSubjectClass(prompt)), prompt);
			if (directed) effective = directed;
		}
	}
	let job;
	try {
		job = await generate(
			base,
			{
				prompt: effective || undefined,
				imageUrls: imageUrl ? [imageUrl] : markImageUrls,
				aspect: '1:1',
				tier: 'standard',
				internal: true,
				director: false,
			},
			{ timeoutEnv: 'STUDIO_FORGE_TIMEOUT_MS', deadline: ctx.deadline, onPoll: ctx.onPoll },
		);
	} catch (err) {
		return toolError(failureMessage(err));
	}
	if (job._timedOut && job.job_id) return pendingResult({ base, jobId: job.job_id, what: 'mesh', prompt: prompt || undefined, ...pendingTiming(job) });
	if (job._timedOut || !job.glb_url) return toolError('Generation is taking longer than expected. Please try again.');
	return ok({ glbUrl: job.glb_url, base, kind: 'mesh', prompt: prompt || undefined, referenceImageUrl: job.preview_image_url });
}

async function handleRigMesh(args, _auth, req, ctx = {}) {
	const base = originFromReq(req);
	const glbUrl = String(args.glb_url || '').trim();
	if (!/^https?:\/\//i.test(glbUrl)) return toolError('Provide an http(s) URL to a GLB mesh to rig.');
	try {
		await guardImage(glbUrl);
	} catch (err) {
		return toolError(err.userMessage ? err.message : 'That GLB URL could not be used.');
	}
	let job;
	try {
		job = await rig(base, glbUrl, { timeoutEnv: 'STUDIO_RIG_TIMEOUT_MS', deadline: ctx.deadline, onPoll: ctx.onPoll });
	} catch (err) {
		return toolError(failureMessage(err));
	}
	if (job._timedOut && job.job_id) return pendingResult({ base, jobId: job.job_id, what: 'rigged model', ...pendingTiming(job), stage: 'rig' });
	if (job._timedOut || !job.glb_url) return toolError('Rigging is taking longer than expected. Please try again.');
	return ok({ glbUrl: job.glb_url, base, kind: 'rigged model', rigged: true });
}

async function handleForgeAvatar(args, _auth, req, ctx = {}) {
	const base = originFromReq(req);
	const prompt = String(args.prompt || '').trim();
	const imageUrl = args.image_url ? String(args.image_url).trim() : '';
	if (!prompt && !imageUrl) return toolError('Provide a text prompt or a reference image_url.');
	if (prompt) {
		const safety = checkPromptSafety(prompt);
		if (!safety.allowed) return toolError(safety.message);
	}
	if (prompt && !imageUrl && args.allow_non_humanoid !== true && looksNonHumanoid(prompt)) {
		return toolError(
			'That looks like an object rather than a character. Auto-rigging needs a humanoid figure. Use the 3D mesh generator for objects, or set allow_non_humanoid to override.',
		);
	}
	try {
		await guardImage(imageUrl);
	} catch (err) {
		return toolError(err.userMessage ? err.message : 'That image URL could not be used.');
	}
	// Stage 1 — generate the mesh (Granite director in text mode, fail-soft).
	let effective = prompt;
	if (prompt && !imageUrl) {
		const subject = classifySubject(prompt) === 'animal' ? 'animal' : 'person';
		const directed = await directPrompt(avatarDirectorFor(subject), prompt);
		effective = directed || avatarFallbackBrief(prompt, subject);
	}
	let gen;
	try {
		gen = await generate(
			base,
			{ prompt: effective || undefined, imageUrls: imageUrl ? [imageUrl] : undefined, aspect: '1:1', tier: AVATAR_TIER, internal: true, director: false },
			{ timeoutEnv: 'STUDIO_FORGE_TIMEOUT_MS', deadline: ctx.deadline, onPoll: ctx.onPoll },
		);
	} catch (err) {
		return toolError(failureMessage(err));
	}
	if (gen._timedOut && gen.job_id) return pendingResult({ base, jobId: gen.job_id, what: 'avatar mesh (rig it with rig_mesh once done)', prompt: prompt || undefined, ...pendingTiming(gen), stage: 'mesh', next: 'rig' });
	if (gen._timedOut || !gen.glb_url) return toolError('Generation is taking longer than expected. Please try again.');

	// Stage 2 — auto-rig the generated mesh.
	let rigged;
	try {
		rigged = await rig(base, gen.glb_url, { timeoutEnv: 'STUDIO_RIG_TIMEOUT_MS', deadline: ctx.deadline, onPoll: ctx.onPoll });
	} catch (err) {
		// Generation succeeded but rigging failed: hand back the (unrigged) mesh so
		// the work isn't lost, and say so plainly.
		// It rides the SAME ok() envelope as every other success, because this
		// hand-rolled one silently dropped what ok() adds: the /cdn rewrite (without
		// it a bucket-domain GLB is unfetchable inside ChatGPT's cross-origin widget
		// sandbox, so this path error-stated instead of showing the mesh it just
		// saved), the AR launch link, and the Spatial MCP artifact. Only the
		// narration differs, so a partial result stays as usable as a whole one.
		const partial = ok({ glbUrl: gen.glb_url, base, kind: 'mesh', prompt: prompt || undefined, referenceImageUrl: gen.preview_image_url });
		return {
			...partial,
			content: [
				{
					type: 'text',
					text:
						`Generated the mesh but auto-rigging failed (${failureMessage(err)}). The model itself is fine and ready to use.\n` +
						partial.content[0].text,
				},
			],
		};
	}
	if (rigged._timedOut && rigged.job_id) return pendingResult({ base, jobId: rigged.job_id, what: 'avatar rig', prompt: prompt || undefined, ...pendingTiming(rigged), stage: 'rig' });
	if (rigged._timedOut || !rigged.glb_url) return toolError('Rigging is taking longer than expected. Please try again.');
	return ok({ glbUrl: rigged.glb_url, base, kind: 'avatar', prompt: prompt || undefined, rigged: true, referenceImageUrl: gen.preview_image_url });
}

// Rebuild a client-supplied lineage (refine_model's parent_lineage, or the
// `refine.lineage` a pending refinement handed out) into the internal shape. It
// is UNTRUSTED: buildLineageChain checks contiguous indices, a single root and no
// cycles, and a malformed array returns null so the caller starts fresh rather
// than corrupting history.
function rehydrateLineage(clientLineage) {
	if (!Array.isArray(clientLineage) || clientLineage.length === 0) return null;
	const rehydrated = clientLineage.map((v, i) => ({
		index: Number.isInteger(v?.index) ? v.index : i,
		parentIndex: v?.parentIndex ?? (i > 0 ? i - 1 : null),
		glbUrl: v?.glbUrl,
		viewerUrl: v?.viewerUrl || null,
		prompt: v?.prompt || null,
		instruction: v?.instruction || null,
		refKind: v?.refKind || (i === 0 ? 'origin' : 'text'),
	}));
	return buildLineageChain(rehydrated).ok ? rehydrated : null;
}

// Conversational refinement — carry a prior model forward with a natural-language
// change ("make it metallic", "bigger helmet"). REAL anchored re-generation: the
// parent prompt is folded into the new prompt so form/subject/materials carry
// forward, and when a reference image of the parent is supplied it anchors the
// generation as image→3D. No faked diffing — the composed prompt is what the
// generator actually runs. Every version is recorded in an immutable lineage the
// client passes back to branch/revert. Free, stateless, zero payment surface.
async function handleRefineModel(args, _auth, req, ctx = {}) {
	const base = originFromReq(req);
	const glbUrl = String(args.glb_url || '').trim();
	if (!/^https?:\/\//i.test(glbUrl)) return toolError('Provide the http(s) glb_url of the model to refine.');
	const instruction = String(args.instruction || '').trim();
	if (!instruction) return toolError('Provide an instruction describing the change, e.g. "make it metallic".');
	const safety = checkPromptSafety(instruction);
	if (!safety.allowed) return toolError(safety.message);

	const parentPrompt = typeof args.parent_prompt === 'string' ? args.parent_prompt.trim() : '';
	if (parentPrompt) {
		const ps = checkPromptSafety(parentPrompt);
		if (!ps.allowed) return toolError(ps.message);
	}
	const refImageUrl = args.reference_image_url ? String(args.reference_image_url).trim() : '';
	try {
		await guardImage(glbUrl);
		if (refImageUrl) await guardImage(refImageUrl);
	} catch (err) {
		return toolError(err.userMessage ? err.message : 'That URL could not be used.');
	}

	const composed = composeRefinement(parentPrompt, instruction);

	// Resolve the starting lineage: extend the one the client passed, or seed a
	// fresh lineage rooted at the parent model. The client-supplied lineage is
	// UNTRUSTED — validate its structural integrity (contiguous indices, single
	// root, no cycles) with buildLineageChain before extending it. A malformed
	// array (buggy client, tampering) falls back to a fresh lineage rooted at the
	// parent model rather than corrupting history.
	const baseLineage =
		rehydrateLineage(args.parent_lineage) ||
		seedLineage({ glbUrl, viewerUrl: viewerUrl(base, glbUrl), prompt: parentPrompt || null });

	// Branch point: refine off an earlier version instead of the leaf. branchFrom
	// validates the index against the lineage; an out-of-range index falls back to
	// the default (extend the leaf) rather than erroring.
	let parentIndex;
	if (Number.isInteger(args.parent_index)) {
		try {
			parentIndex = branchFrom(baseLineage, args.parent_index);
		} catch {
			parentIndex = undefined;
		}
	}

	let job;
	try {
		job = await generate(
			base,
			refImageUrl
				? { prompt: composed, imageUrls: [refImageUrl], aspect: '1:1', tier: 'standard', internal: true }
				: { prompt: composed, tier: 'standard', internal: true },
			{ timeoutEnv: 'STUDIO_REFINE_TIMEOUT_MS', deadline: ctx.deadline, onPoll: ctx.onPoll },
		);
	} catch (err) {
		return toolError(failureMessage(err));
	}
	if (job._timedOut && job.job_id)
		return pendingResult({
			base,
			jobId: job.job_id,
			what: 'refined model',
			prompt: composed || undefined,
			...pendingTiming(job),
			refine: {
				lineage: baseLineage,
				instruction,
				refKind: refImageUrl ? 'image' : 'text',
				...(parentIndex !== undefined ? { parentIndex } : {}),
			},
		});
	if (job._timedOut || !job.glb_url) return toolError('Refinement is taking longer than expected. Please try again.');

	const lineage = appendVersion(baseLineage, {
		glbUrl: job.glb_url,
		viewerUrl: viewerUrl(base, job.glb_url),
		prompt: composed,
		instruction,
		refKind: refImageUrl ? 'image' : 'text',
		...(parentIndex !== undefined ? { parentIndex } : {}),
	});
	return refineOk({ glbUrl: job.glb_url, base, prompt: composed, instruction, lineage, activeIndex: lineage.length - 1 });
}

// A refinement collected by check_job joins the version history its pending
// result carried, exactly as refine_model appends it inline. Anything malformed
// falls back to the plain model envelope; the model itself is never lost.
function finishRefinement(base, data, refine) {
	const instruction = typeof refine?.instruction === 'string' ? refine.instruction.trim() : '';
	const lineage = instruction ? rehydrateLineage(refine.lineage) : null;
	if (!lineage) return null;
	let parentIndex;
	if (Number.isInteger(refine.parentIndex)) {
		try {
			parentIndex = branchFrom(lineage, refine.parentIndex);
		} catch {
			parentIndex = undefined;
		}
	}
	const prompt = typeof data.prompt === 'string' && data.prompt ? data.prompt : null;
	const next = appendVersion(lineage, {
		glbUrl: data.glb_url,
		viewerUrl: viewerUrl(base, data.glb_url),
		prompt,
		instruction,
		refKind: refine.refKind === 'image' ? 'image' : 'text',
		...(parentIndex !== undefined ? { parentIndex } : {}),
	});
	return refineOk({ glbUrl: data.glb_url, base, prompt: prompt || undefined, instruction, lineage: next, activeIndex: next.length - 1 });
}

// Collect a generation that outlived a tool call's inline wait. One status
// probe, no loop: done renders the full result envelope in the widget, still
// running returns a fresh pending envelope with updated timing, failed returns
// the same clean failure copy the generating tools use. Without this tool the
// only way back to a pending job was browsing the raw poll URL.
async function collectJob(args, req) {
	const base = originFromReq(req);
	const jobId = String(args.job_id || '').trim();
	if (!jobId) {
		return { result: toolError('Provide the job_id a pending generation returned.'), job: { status: 'unknown' } };
	}
	let data;
	try {
		data = await pollOnce(base, jobId);
	} catch (err) {
		// Only an unrecognized handle is final. A timeout, a busy status bucket or
		// an upstream blip leaves the job running, and the first check of a
		// finished job does the slow save-and-score work, so checking again
		// usually returns the model at once.
		const final = err?.code === 'unknown_job';
		return {
			result: toolError(failureMessage(err), final ? {} : { retryable: true }),
			job: {
				status: final ? 'not_found' : 'unknown',
				retryable: !final,
				error: failureMessage(err),
				remedy: final
					? 'Start a new generation; a job id that is not recognized cannot be recovered.'
					: `Call get_job again with the same job_id${Number(err?.retryAfter) > 0 ? ` in about ${Math.ceil(Number(err.retryAfter))}s` : ' shortly'}; the job itself is not affected.`,
			},
		};
	}
	if (data.status === 'done' && data.glb_url) {
		const result =
			finishRefinement(base, data, args.refine) ||
			ok({
				glbUrl: data.glb_url,
				base,
				kind: 'model',
				prompt: typeof data.prompt === 'string' && data.prompt ? data.prompt : undefined,
				referenceImageUrl: data.preview_image_url,
			});
		return { result, job: { status: 'done' } };
	}
	if (data.status === 'failed') {
		// data.error is already sanitized server-side (sanitizeJobError): safe copy.
		const message = data.error ? `Generation failed: ${data.error}` : failureMessage({ code: 'generation_failed' });
		const backends = Array.isArray(data.retry_backends) ? data.retry_backends : [];
		return {
			result: toolError(message),
			job: {
				status: 'failed',
				retryable: true,
				error: message,
				remedy:
					'Start a new generation. Rephrase the prompt to name the subject plainly (one object or character, no scene), ' +
					'or pass a reference image_url' +
					(backends.length ? `; the engines that can take it next: ${backends.join(', ')}` : '') +
					'. A failed attempt is never remembered, so the same idempotency_key starts a fresh job.',
			},
		};
	}
	const result = pendingResult({
		base,
		jobId,
		what: 'model',
		prompt: typeof data.prompt === 'string' && data.prompt ? data.prompt : undefined,
		...pendingTiming(data),
	});
	return {
		result,
		job: {
			status: data.status === 'queued' ? 'queued' : 'running',
			elapsedSeconds: finiteOrNull(data.elapsed_seconds),
			etaRemainingSeconds: finiteOrNull(data.eta_remaining_seconds),
		},
	};
}

function handleCheckJob(args, _auth, req) {
	return collectJob(args, req).then((c) => c.result);
}

function finiteOrNull(n) {
	return Number.isFinite(Number(n)) && n !== null && n !== '' ? Number(n) : null;
}

/**
 * How far along a job is, 0 to 1, from the two numbers the poll reports: seconds
 * elapsed and seconds left. Null when the job reports neither (never a guess), and
 * capped just under 1 until the job is actually done, because the estimate is a
 * typical duration and not a deadline.
 */
export function jobProgress({ status, elapsedSeconds, etaRemainingSeconds }) {
	if (status === 'done') return 1;
	if (status === 'failed' || status === 'not_found' || status === 'unknown') return null;
	const elapsed = finiteOrNull(elapsedSeconds);
	const left = finiteOrNull(etaRemainingSeconds);
	if (elapsed === null || left === null) return null;
	const total = elapsed + left;
	return total > 0 ? Math.min(0.95, Math.max(0, Math.round((elapsed / total) * 100) / 100)) : null;
}

// The machine-readable status of one job: the same probe as check_job, reshaped
// for an agent that schedules its own follow-ups. Every field is present on every
// state so a client branches on `status` alone: queued and running carry progress
// and eta_seconds, done carries the asset links (viewer_url, glb_url,
// poster_png_url, embed_html), failed and not_found carry the reason and a remedy.
async function handleGetJob(args, _auth, req) {
	const jobId = String(args.job_id || '').trim();
	const { result, job } = await collectJob(args, req);
	const status = job.status;
	const eta = status === 'done' ? 0 : finiteOrNull(job.etaRemainingSeconds);
	const base = {
		job_id: jobId,
		status,
		progress: jobProgress(job),
		eta_seconds: eta,
		elapsed_seconds: finiteOrNull(job.elapsedSeconds),
		...(job.error ? { error: job.error, retryable: Boolean(job.retryable), remedy: job.remedy } : {}),
		...(status === 'queued' || status === 'running'
			? { next_check_seconds: eta ? Math.min(60, Math.max(5, Math.round(eta / 2))) : 15 }
			: {}),
	};
	const structuredContent = { ...(result.structuredContent || {}), ...base };
	if (status === 'failed' || status === 'not_found' || status === 'unknown') {
		return {
			content: [{ type: 'text', text: `${job.error}\n${job.remedy}` }],
			structuredContent,
			isError: true,
		};
	}
	return { ...result, structuredContent };
}


// ── idempotency ─────────────────────────────────────────────────────────────

const IDEMPOTENCY_PROPERTY = {
	type: 'string',
	minLength: 1,
	maxLength: 200,
	description:
		'Optional retry key. Send the same key again (same caller, same arguments, within 24 hours) and you get the ' +
		'original job back instead of a second generation, so a retry after a timeout cannot burn quota twice. ' +
		'Use a fresh key for each distinct request. A failed attempt is not remembered, so its key can be reused.',
};

function idempotencyError(code, message, retryable) {
	return toolError(message, { code, retryable });
}

// A stored pending job may have finished or failed since. Probe it once: done
// replays the model, running replays a fresh pending envelope, failed forgets the
// entry so the same key retries, and an unreachable status check keeps the
// stored answer rather than starting a duplicate.
async function revalidateStored(stored, req) {
	const sc = stored?.structuredContent;
	if (!sc || sc.status !== 'pending' || !sc.jobId) return stored;
	const { result, job } = await collectJob({ job_id: sc.jobId, refine: sc.refine }, req);
	if (job.status === 'failed' || job.status === 'not_found') return null;
	if (job.status === 'unknown') return stored;
	return { content: result.content, structuredContent: { ...result.structuredContent, job_id: sc.jobId } };
}

/**
 * Give a generation handler an optional `idempotency_key`. Without a key the
 * handler runs exactly as before. With one, the call runs at most once per
 * (caller, key) across 24 hours and every repeat returns that outcome.
 */
function idempotent(tool, handler) {
	return async (args, auth, req, ctx = {}) => {
		const key = normalizeKey(args?.idempotency_key);
		if (!key) return handler(args, auth, req, ctx);
		const { idempotency_key: _omit, ...request } = args;
		const caller = auth?.caller || auth?.rateKey || 'anonymous';
		const outcome = await runOnce({
			caller,
			key,
			fingerprint: argsDigest({ tool, ...request }),
			run: () => handler(request, auth, req, ctx),
			shouldStore: (r) => !r?.isError,
			toStored: (r) => ({ content: r.content, structuredContent: r.structuredContent }),
			revalidate: (stored) => revalidateStored(stored, req),
		});
		if (outcome.state === 'conflict') {
			return idempotencyError(
				'idempotency_key_reused',
				'That idempotency_key was already used for a different request. Use a new key for a new request, or repeat the original arguments to collect the original job.',
				false,
			);
		}
		if (outcome.state === 'in_progress') {
			return idempotencyError(
				'idempotency_in_progress',
				'A call with this idempotency_key is still running. Wait a few seconds and call again with the same key to collect it.',
				true,
			);
		}
		const replayed = outcome.state === 'replayed';
		const source = replayed ? outcome.stored : outcome.value;
		const content = replayed
			? [{ type: 'text', text: "Replayed: this idempotency_key matched an earlier call, so this is that call's job, not a new generation." }, ...(source.content || [])]
			: source.content;
		return {
			...source,
			content,
			structuredContent: {
				...(source.structuredContent || {}),
				idempotency: { key, replayed },
			},
		};
	};
}

// ── definitions ─────────────────────────────────────────────────────────────

const GEN_ANNOTATIONS = {
	readOnlyHint: false, // tools create a new hosted asset
	destructiveHint: false, // they never modify or delete anything
	idempotentHint: false, // same prompt → a fresh, different mesh each call
	openWorldHint: true, // work runs against external model APIs
};

function widgetMeta(invoking, invoked) {
	return {
		'openai/outputTemplate': COMPONENT_URI,
		'openai/toolInvocation/invoking': invoking,
		'openai/toolInvocation/invoked': invoked,
		'openai/widgetAccessible': true,
	};
}

// look_at_model: the one tool in this server that hands the model back a
// PICTURE instead of a link.
//
// MCP content blocks can carry images, and a multimodal client renders them
// straight into the conversation, so the frames below are literally seen by the
// model that asked for them. That is the whole point: until now an agent that
// generated a 3D asset had no way to check its own work, because a .glb is
// opaque to it. With frames in hand it can answer "is the subject complete, is
// the back finished, did I get a teapot or a lump" and then fix it, which turns
// one-shot generation into a loop.
//
// Frames are capped at 512 px and four views by default: enough for a model to
// judge form and completeness, small enough not to flood the caller's context.
async function handleLookAtModel(args, _auth, req) {
	const base = originFromReq(req);
	const glbUrl = String(args?.glb_url || '').trim();
	if (!/^https:\/\//i.test(glbUrl)) {
		return toolError('glb_url must be a public https URL to a .glb file.');
	}

	let turntable;
	try {
		turntable = await renderTurntable({ glbUrl, views: args?.views, size: args?.size ?? 512 });
	} catch (err) {
		return toolError(String(err?.message || 'could not render this model').slice(0, 300));
	}

	const stats = await fetchGeometryStats(base, glbUrl);
	const notes = describeGeometry(stats);
	const shown = turntable.frames.map((f) => f.view).join(', ');
	const links = assetLinks({ base, glbUrl, kind: 'model' });
	const missing = turntable.failed.length ? ` Could not render: ${turntable.failed.map((f) => f.view).join(', ')}.` : '';

	// The text block frames what the model is about to look at, then every frame
	// follows as an image block, each announced by name so the model can talk
	// about "the back view" rather than "the third image".
	const content = [
		{
			type: 'text',
			text:
				`Rendered this model from ${turntable.frames.length} angle(s): ${shown}.${missing}\n` +
				`${assetLinksText(links)}\n` +
				(notes.length ? `Geometry: ${notes.join(' ')}\n` : '') +
				'Look at the frames below and judge the model: is the subject complete and recognisable, ' +
				'is the far side finished, is anything melted, fused, or missing? If it needs work, generate ' +
				'again with a prompt that names the specific fault.',
		},
	];
	for (const frame of turntable.frames) {
		content.push({ type: 'text', text: `View: ${frame.view} (theta ${frame.theta}, phi ${frame.phi})` });
		content.push({ type: 'image', data: frame.png.toString('base64'), mimeType: 'image/png' });
	}

	return {
		content,
		structuredContent: {
			ok: true,
			model_url: glbUrl,
			size: turntable.size,
			views: turntable.frames.map((f) => ({ view: f.view, theta: f.theta, phi: f.phi })),
			...(turntable.failed.length ? { missing_views: turntable.failed } : {}),
			...(stats ? { stats, notes } : {}),
			...links,
			ar_url: arLaunchUrl(base, glbUrl),
		},
	};
}

const DEFS = [
	{
		name: 'forge_free',
		title: 'Generate a 3D model from text',
		description:
			'Turn a text prompt into a textured, downloadable 3D model (GLB), free. Describe a single object, ' +
			'character, or creature; the studio generates an interactive model you can rotate, view, and download. ' +
			'Optional quality tier (draft, standard, high); high is slower and may fall back to standard under load. ' +
			'Renders inline in an interactive 3D viewer. Use this for a single object or creature from text; for a posable ' +
			'character call forge_avatar, and to change a model you already made call refine_model.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['prompt'],
			properties: {
				idempotency_key: IDEMPOTENCY_PROPERTY,
				prompt: {
					type: 'string',
					minLength: 3,
					maxLength: 1000,
					description: 'Description of the single object or character to model, e.g. "a friendly round robot mascot, glossy white plastic".',
				},
				tier: {
					type: 'string',
					enum: ['draft', 'standard', 'high'],
					description: 'Detail level: draft (fastest), standard (default), or high (best, slower; may fall back to standard under load).',
				},
			},
		},
		annotations: GEN_ANNOTATIONS,
		_meta: widgetMeta('Generating your 3D model…', 'Here is your 3D model'),
		handler: idempotent('forge_free', handleForgeFree),
	},
	{
		name: 'text_to_avatar',
		title: 'Generate a 3D avatar',
		description:
			'Generate a textured 3D avatar (GLB) from a text description or a reference image URL. Best for ' +
			'characters and figures. Renders inline in an interactive 3D viewer. Use this for a character that only needs ' +
			'to be viewed; when it must be posed or animated call forge_avatar instead.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				idempotency_key: IDEMPOTENCY_PROPERTY,
				prompt: { type: 'string', maxLength: 1000, description: 'Description of the avatar to generate.' },
				image_url: { type: 'string', format: 'uri', description: 'Optional http(s) URL to a reference image to reconstruct in 3D.' },
			},
		},
		annotations: GEN_ANNOTATIONS,
		_meta: widgetMeta('Generating your avatar…', 'Here is your avatar'),
		handler: idempotent('text_to_avatar', handleTextToAvatar),
	},
	{
		name: 'mesh_forge',
		title: 'Generate a 3D mesh (art-directed)',
		description:
			'Generate a textured 3D mesh (GLB) from a text prompt or a reference image URL. In text mode an AI ' +
			'art-director first refines your prompt into an optimized single-subject spec for higher mesh quality. ' +
			'Renders inline in an interactive 3D viewer. Use this for a single object or prop when mesh quality matters ' +
			'most; for characters call text_to_avatar or forge_avatar.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				idempotency_key: IDEMPOTENCY_PROPERTY,
				prompt: { type: 'string', maxLength: 1000, description: 'Description of the single object to model.' },
				image_url: { type: 'string', format: 'uri', description: 'Optional http(s) URL to a reference image to reconstruct directly.' },
			},
		},
		annotations: GEN_ANNOTATIONS,
		_meta: widgetMeta('Generating your 3D mesh…', 'Here is your 3D mesh'),
		handler: idempotent('mesh_forge', handleMeshForge),
	},
	{
		name: 'rig_mesh',
		title: 'Rig a 3D model for animation',
		description:
			'Auto-rig a static 3D model (GLB) into an animation-ready model: adds a humanoid skeleton and skin ' +
			'weights so it can be posed and animated. Provide the GLB URL of a model (e.g. one generated by the ' +
			'other tools). Renders the rigged result inline in an interactive 3D viewer. Use this when you already have a ' +
			'static model; to generate and rig a character in one step call forge_avatar instead.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['glb_url'],
			properties: {
				idempotency_key: IDEMPOTENCY_PROPERTY,
				glb_url: { type: 'string', format: 'uri', description: 'http(s) URL to the static GLB mesh to rig.' },
			},
		},
		annotations: GEN_ANNOTATIONS,
		_meta: widgetMeta('Rigging your model…', 'Here is your rigged model'),
		handler: idempotent('rig_mesh', handleRigMesh),
	},
	{
		name: 'forge_avatar',
		title: 'Generate a rigged, animation-ready avatar',
		description:
			'Generate a rigged, animation-ready 3D avatar (GLB) from a single text prompt or a reference image, ' +
			'in one step. Generates the mesh, then auto-rigs it with a humanoid skeleton so it is ready to pose and ' +
			'animate. Best for characters; objects are steered to the mesh generator. Renders inline in an ' +
			'interactive 3D viewer. Use this when the user wants a character they can pose or animate.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				idempotency_key: IDEMPOTENCY_PROPERTY,
				prompt: { type: 'string', maxLength: 1000, description: 'Description of the character/avatar to generate.' },
				image_url: { type: 'string', format: 'uri', description: 'Optional http(s) URL to a reference image to reconstruct in 3D.' },
				allow_non_humanoid: { type: 'boolean', description: 'Set true to rig a non-humanoid subject anyway (rigging assumes a humanoid figure).' },
			},
		},
		annotations: GEN_ANNOTATIONS,
		_meta: widgetMeta('Generating your rigged avatar…', 'Here is your rigged avatar'),
		handler: idempotent('forge_avatar', handleForgeAvatar),
	},
	{
		name: 'refine_model',
		title: 'Refine a 3D model by describing a change',
		description:
			'Iterate on a model you already generated: just describe the change in words ("make it metallic", ' +
			'"bigger helmet", "add wings"). The studio re-generates a new version anchored to the previous one, ' +
			'carrying its form and materials forward. Pass the previous model\'s glb_url and, when you have it, the ' +
			'prompt that made it (parent_prompt) so the change builds on it. Each refinement is recorded as a new ' +
			'version in a lineage you can revert to or branch from, and the returned lineage drives a version strip in ' +
			'the viewer. Renders the new version inline in the interactive 3D viewer. Use this instead of a fresh ' +
			'generation when the user wants to change a model they already have.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['glb_url', 'instruction'],
			properties: {
				idempotency_key: IDEMPOTENCY_PROPERTY,
				glb_url: { type: 'string', format: 'uri', description: 'http(s) URL of the model to refine (e.g. the glbUrl a previous generation returned).' },
				instruction: {
					type: 'string',
					minLength: 1,
					maxLength: 500,
					description: 'The change to make, in plain language: "make it metallic", "bigger helmet", "add a cape".',
				},
				parent_prompt: {
					type: 'string',
					maxLength: 1000,
					description: 'Optional: the prompt that produced the model being refined, so the change builds on it instead of starting over.',
				},
				reference_image_url: {
					type: 'string',
					format: 'uri',
					description: 'Optional http(s) image of the current model to anchor the re-generation (image→3D). Omit for text-guided refinement.',
				},
				parent_lineage: {
					type: 'array',
					description: 'Optional: the lineage array from a previous refine_model result, to extend the same version history.',
					items: { type: 'object', additionalProperties: true },
				},
				parent_index: {
					type: 'integer',
					minimum: 0,
					description: 'Optional: branch off an earlier version in parent_lineage (its index) instead of the latest.',
				},
			},
		},
		annotations: GEN_ANNOTATIONS,
		_meta: widgetMeta('Refining your 3D model…', 'Here is the refined model'),
		handler: idempotent('refine_model', handleRefineModel),
	},
	{
		name: 'check_job',
		title: 'Check a pending 3D generation',
		description:
			'Check on a 3D generation that returned status "pending" and collect the finished model. Pass the ' +
			'job_id from the pending result. While it is still rendering you get updated timing; call again after ' +
			'the suggested wait. Checking can save the completed model and restart failed work on another ' +
			'provider. When it is done the model renders inline in the interactive 3D viewer. Use this when the user is ' +
			'waiting to see the finished model; for quiet polling on a schedule call get_job instead.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['job_id'],
			properties: {
				job_id: {
					type: 'string',
					minLength: 8,
					maxLength: 4096,
					description: 'The job_id (or jobId) a pending generation returned.',
				},
				refine: {
					type: 'object',
					additionalProperties: true,
					description:
						'Optional: the refine object a pending refine_model result carried. Pass it back unchanged so the ' +
						'finished model joins that version history.',
					properties: {
						lineage: { type: 'array', items: { type: 'object', additionalProperties: true } },
						instruction: { type: 'string', maxLength: 500 },
						parentIndex: { type: 'integer', minimum: 0 },
						refKind: { type: 'string', enum: ['text', 'image'] },
					},
				},
			},
		},
		annotations: {
			readOnlyHint: false, // polling can persist a model and submit recovery jobs
			destructiveHint: false,
			idempotentHint: false, // later checks can advance recovery to another provider
			openWorldHint: true,
		},
		_meta: widgetMeta('Checking your 3D model…', 'Here is your 3D model'),
		handler: handleCheckJob,
	},
	{
		name: 'get_job',
		title: 'Get the status of a 3D job',
		description:
			'Machine-readable status of a generation that returned "pending". Returns status (queued, running, done, ' +
			'failed, not_found), progress (0 to 1, null when unknown), eta_seconds, and next_check_seconds while it runs; ' +
			'the asset links (viewer_url, glb_url, poster_png_url, embed_html) when done; and a plain error with a ' +
			'remedy when it failed. Safe to call on a schedule: it never starts work and is not counted against the ' +
			'generation quota. Use this to poll a pending job from code or a loop; call check_job with the same job_id ' +
			'when you want the finished model rendered in the inline viewer.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['job_id'],
			properties: {
				job_id: {
					type: 'string',
					minLength: 8,
					maxLength: 4096,
					description: 'The job_id (or jobId) a pending generation returned.',
				},
				refine: {
					type: 'object',
					additionalProperties: true,
					description: 'Optional: the refine object a pending refine_model result carried, passed back unchanged.',
				},
			},
		},
		annotations: {
			readOnlyHint: false, // the first check of a finished job saves the model
			destructiveHint: false,
			idempotentHint: false, // later checks can advance recovery to another provider
			openWorldHint: true,
		},
		_meta: widgetMeta('Checking your 3D job…', 'Here is the job status'),
		handler: handleGetJob,
	},
	{
		name: 'look_at_model',
		title: 'Look at a 3D model',
		description:
			'FREE. See a 3D model instead of just linking to it. Renders the GLB from several angles and returns ' +
			'the frames as images you can actually look at, plus its geometry (triangles, materials, textures) and ' +
			'a plain reading of what those numbers mean. Use it to check your own work right after generating: is ' +
			'the subject complete, is the back finished, is anything melted or fused? Then regenerate naming the ' +
			'fault you saw. Works on any public https .glb, not only ones made here.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['glb_url'],
			properties: {
				glb_url: {
					type: 'string',
					minLength: 12,
					maxLength: 2048,
					description: 'Public https URL of the .glb to look at.',
				},
				views: {
					type: 'array',
					maxItems: 6,
					items: { type: 'string', enum: ['front', 'three-quarter', 'side', 'back', 'top', 'bottom'] },
					description: 'Angles to render. Default: three-quarter, front, side, back.',
				},
				size: {
					type: 'integer',
					minimum: 128,
					maximum: 1024,
					description: 'Pixel size of each square frame. Default 512.',
				},
			},
		},
		annotations: {
			readOnlyHint: true, // renders a picture; changes nothing
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		},
		_meta: widgetMeta('Looking at your 3D model…', 'Here is what the model looks like'),
		handler: handleLookAtModel,
	},
];

// Schemas for tools/list — strip the handler (and any server-only field).
export const TOOL_CATALOG = DEFS.map(({ handler: _h, ...schema }) => schema);

const ajv = new Ajv({ allErrors: true, useDefaults: true, coerceTypes: true, strict: false });
addFormats(ajv);

export const TOOLS = Object.fromEntries(
	DEFS.map(({ name, handler, inputSchema }) => [name, { handler, validate: inputSchema ? ajv.compile(inputSchema) : null }]),
);

export const TOOL_NAMES = DEFS.map((d) => d.name);
