// NVIDIA Cosmos Reason judge: physical plausibility for generated 3D models.
//
// The Forge quality gate (forge-quality-gate.js) asks a general vision model one
// question about ONE front render: does this look like a good model? Many of
// the failures users throw away are physical rather than aesthetic: parts that
// float free of the body, limbs passing through each other, a figure that would
// topple, a model lying on its side, a paper-thin shell. NVIDIA Cosmos Reason is
// a vision-language model trained for physical common sense, so this module
// shows it the same model from four sides and asks for a structured physical
// verdict:
//
//   { plausible, issues: [fixed list], prompt_match: yes|partial|no, confidence }
//
// The model may reason before answering; that trace is stripped and never
// stored. Only the verdict fields above leave this module.
//
// Where it runs: self-hosted on Cloud Run (workers/model-cosmos-reason, vLLM on
// one L4, weights from NGC under the NVIDIA Open Model License). NVIDIA's hosted
// endpoint for Cosmos Reason 2 answers 410 Gone for our key (measured
// 2026-11-16), so there is no hosted lane to fall back to. Dormant until
// COSMOS_REASON_URL is set.
//
// How the gate uses it is a flag, FORGE_COSMOS_JUDGE (see cosmosJudgeMode):
//   off      never called.
//   shadow   called beside the current judge, both verdicts logged to
//            forge_judge_shadow, the shipped decision unchanged. Default once
//            COSMOS_REASON_URL is set.
//   veto     the current judge decides, except that a confident Cosmos
//            rejection naming one of FORGE_COSMOS_VETO_ISSUES fails the model.
//   tiebreak the current judge decides unless its score sits inside the
//            borderline band around the pass score, or it is unavailable; then
//            Cosmos decides.
//   primary  Cosmos decides whenever it answers; the current judge is the
//            fallback.
// Which mode ships is set by the eval (docs/nvidia/evals/), not by taste.
//
// Fail-open like the gate it sits beside: every failure returns
// { available: false, error } and the current judge's verdict stands.

import { parseJsonLoose } from './vision.js';
import { renderAvatarScene, SCENE_PRESETS } from './avatar-render.js';

function readEnv(name) {
	if (typeof process !== 'undefined' && process.env?.[name]) return process.env[name];
	return null;
}

function numEnv(name, fallback) {
	const v = readEnv(name);
	const n = v == null || v === '' ? NaN : Number(v);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// The fixed issue vocabulary. The prompt offers exactly these tags and the
// normalizer drops anything else, so stored verdicts stay comparable across
// model versions and a disagreement can be filtered by class.
export const COSMOS_ISSUES = Object.freeze({
	floating_parts: 'pieces hover detached from the main body or the ground with nothing holding them',
	interpenetration: 'parts pass through each other or through the body (a hand inside a torso, a leg through a skirt)',
	unsupported: 'the object could not stand or rest as shown: it would tip over, or a load rests on nothing',
	wrong_orientation: 'the model is upside down, lying on its side, or tilted when it should stand upright',
	implausible_proportions: 'sizes of parts relative to each other are physically wrong (a tiny head on a huge body, a chair seat too thin to bear weight)',
	missing_parts: 'a part the object needs physically is absent or cut off (a table with no legs, a figure without feet)',
	duplicated_parts: 'a part appears more times than it should (extra limbs, two heads, doubled wheels)',
	fused_parts: 'separate parts are melted together into one mass (fingers fused, legs merged)',
	melted_blob: 'the geometry is a shapeless or melted lump with no readable structure',
	thin_shell: 'the model is a flat card, a hollow shell or a single surface instead of a solid volume',
});

export const COSMOS_ISSUE_KEYS = Object.freeze(Object.keys(COSMOS_ISSUES));

export const COSMOS_JUDGE_MODES = Object.freeze(['off', 'shadow', 'veto', 'tiebreak', 'primary']);

// The four judging views: front, right, back, left, slightly above eye level so
// the ground contact and the top of the model are both visible.
export const COSMOS_VIEWS = Object.freeze([
	{ name: 'front', theta: 0, phi: 75 },
	{ name: 'right', theta: 90, phi: 75 },
	{ name: 'back', theta: 180, phi: 75 },
	{ name: 'left', theta: 270, phi: 75 },
]);

export const COSMOS_JUDGE_DEFAULTS = Object.freeze({
	model: readEnv('COSMOS_REASON_MODEL') || 'nvidia/cosmos-reason2-8b',
	renderSize: numEnv('COSMOS_REASON_RENDER_SIZE', 448),
	timeoutMs: numEnv('COSMOS_REASON_TIMEOUT_MS', 45_000),
	// Cosmos Reason can think before answering. The eval measured both; the
	// default follows it (see docs/nvidia/evals/).
	reasoning: readEnv('COSMOS_REASON_THINK') === '1',
	// A rejection only counts as a veto at or above this confidence.
	vetoConfidence: numEnv('FORGE_COSMOS_VETO_CONFIDENCE', 0.7),
	// tiebreak mode: the current judge's score is "borderline" within this many
	// points of its pass score.
	tiebreakBand: numEnv('FORGE_COSMOS_TIEBREAK_BAND', 10),
	// shadow mode: how long the gate waits for Cosmos after the current judge
	// has answered, before it returns without the shadow verdict.
	shadowGraceMs: numEnv('FORGE_COSMOS_SHADOW_GRACE_MS', 6000),
});

export function cosmosJudgeConfigured() {
	return Boolean(readEnv('COSMOS_REASON_URL'));
}

// Resolve the active mode. Unset defaults to shadow when the worker is
// configured and off when it is not; an unknown value is treated as shadow so a
// typo can never silently change shipped decisions.
export function cosmosJudgeMode() {
	if (!cosmosJudgeConfigured()) return 'off';
	const raw = String(readEnv('FORGE_COSMOS_JUDGE') || 'shadow').trim().toLowerCase();
	return COSMOS_JUDGE_MODES.includes(raw) ? raw : 'shadow';
}

// Issues a confident Cosmos rejection may veto on (veto mode). Unset means the
// eval-selected default list below.
export const DEFAULT_VETO_ISSUES = Object.freeze(['floating_parts', 'melted_blob', 'thin_shell']);

export function cosmosVetoIssues() {
	const raw = readEnv('FORGE_COSMOS_VETO_ISSUES');
	if (!raw) return [...DEFAULT_VETO_ISSUES];
	return raw.split(',').map((s) => s.trim()).filter((s) => COSMOS_ISSUE_KEYS.includes(s));
}

export function buildCosmosJudgePrompt({ prompt, viewNames = COSMOS_VIEWS.map((v) => v.name), reasoning = false }) {
	const request = prompt ? `"${String(prompt).slice(0, 400)}"` : 'not provided';
	const issueLines = COSMOS_ISSUE_KEYS.map((k) => `  ${k}: ${COSMOS_ISSUES[k]}`);
	const format = reasoning
		? 'Think it through first inside <think></think>, then give ONLY the JSON object inside <answer></answer>.'
		: 'Reply with ONLY the JSON object, no other text.';
	return [
		`You are inspecting one AI-generated 3D model. The ${viewNames.length} images are renders of the SAME model from these sides, in order: ${viewNames.join(', ')}. Lighting and the plain gray backdrop are fixed by the renderer; ignore them, and ignore texture style and color.`,
		`The model was requested as: ${request}`,
		'',
		'Judge PHYSICAL plausibility: could this object exist and hold together in the real world as shown? Use all views; a defect visible from one side counts.',
		'Possible issues (use only these tags, only for issues actually present):',
		...issueLines,
		'',
		'Also judge whether it is the requested subject at all (prompt_match): "yes", "partial" (right kind of thing, a requested part clearly wrong or missing), or "no".',
		'A stylized, low-detail or game-ready model that is physically coherent is plausible. Mark plausible false only for real physical defects.',
		'',
		format,
		'{"plausible": true|false, "issues": ["<tag>", ...], "prompt_match": "yes"|"partial"|"no", "confidence": <0.0-1.0, how sure you are of "plausible">}',
	].join('\n');
}

// Strip any reasoning trace and return the answer text. Handles a closed
// <think>...</think> block, an <answer> wrapper, and an unclosed think block
// (truncated output) by taking whatever follows the last tag.
export function stripReasoning(text) {
	let t = String(text || '');
	const thinkEnd = t.lastIndexOf('</think>');
	if (thinkEnd >= 0) t = t.slice(thinkEnd + '</think>'.length);
	else if (/<think>/i.test(t)) t = t.replace(/<think>[\s\S]*$/i, '');
	const answer = t.match(/<answer>([\s\S]*?)(?:<\/answer>|$)/i);
	if (answer) t = answer[1];
	return t.trim();
}

function clamp01(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return null;
	return Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n));
}

function asBool(v) {
	if (v === true || v === false) return v;
	const s = String(v ?? '').trim().toLowerCase();
	if (['true', 'yes', '1'].includes(s)) return true;
	if (['false', 'no', '0'].includes(s)) return false;
	return null;
}

// Turn a raw reply into the stored verdict. Throws when the reply carries no
// usable plausible flag, so the caller records it as unavailable instead of
// inventing a decision.
export function normalizeCosmosVerdict(raw) {
	const plausible = asBool(raw?.plausible);
	if (plausible === null) {
		throw Object.assign(new Error('cosmos verdict has no plausible flag'), { code: 'cosmos_bad_verdict' });
	}
	const issues = Array.isArray(raw?.issues)
		? [...new Set(raw.issues.map((s) => String(s).trim().toLowerCase().replace(/[\s-]+/g, '_')))].filter((s) => COSMOS_ISSUE_KEYS.includes(s))
		: [];
	const pm = String(raw?.prompt_match ?? '').trim().toLowerCase();
	const promptMatch = ['yes', 'partial', 'no'].includes(pm) ? pm : null;
	const confidence = clamp01(raw?.confidence);
	return {
		plausible,
		issues,
		prompt_match: promptMatch,
		confidence,
		// The gate-level decision this verdict implies: physically plausible and
		// recognizably the requested subject.
		pass: plausible && promptMatch !== 'no',
	};
}

function workerBase() {
	return String(readEnv('COSMOS_REASON_URL') || '').replace(/\/+$/, '').replace(/\/v1$/, '');
}

function workerKey() {
	return readEnv('COSMOS_REASON_KEY') || readEnv('GCP_RECONSTRUCTION_KEY') || '';
}

// One chat completion against the self-hosted worker. Returns the answer text
// with the reasoning stripped, plus token usage.
export async function callCosmosReason({ images, prompt, reasoning = COSMOS_JUDGE_DEFAULTS.reasoning, timeoutMs = COSMOS_JUDGE_DEFAULTS.timeoutMs, fetchImpl = fetch }) {
	const base = workerBase();
	if (!base) throw Object.assign(new Error('COSMOS_REASON_URL unset'), { code: 'unconfigured' });
	const content = [
		...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType || 'image/png'};base64,${img.base64}` } })),
		{ type: 'text', text: buildCosmosJudgePrompt({ prompt, viewNames: images.map((i) => i.name || 'view'), reasoning }) },
	];
	const res = await fetchImpl(`${base}/v1/chat/completions`, {
		method: 'POST',
		headers: { authorization: `Bearer ${workerKey()}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			model: COSMOS_JUDGE_DEFAULTS.model,
			messages: [
				{ role: 'system', content: 'You are a helpful assistant.' },
				{ role: 'user', content },
			],
			temperature: 0,
			max_tokens: reasoning ? 2048 : 300,
		}),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw Object.assign(new Error(`cosmos ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
	}
	const data = await res.json();
	const text = data?.choices?.[0]?.message?.content || '';
	if (!text.trim()) throw Object.assign(new Error('cosmos returned no text'), { code: 'cosmos_empty' });
	return { answer: stripReasoning(text), usage: data?.usage || null };
}

// Render the judging views of a GLB. Returns [{ name, theta, base64, mimeType, png }].
export async function renderCosmosViews(glbUrl, { size = COSMOS_JUDGE_DEFAULTS.renderSize, views = COSMOS_VIEWS, render = renderAvatarScene } = {}) {
	const out = [];
	for (const v of views) {
		const { png } = await render({
			glbUrl,
			width: size,
			height: size,
			background: '#6a6d75',
			scenePreset: SCENE_PRESETS['full-body'],
			cameraOrbit: { theta: v.theta, phi: v.phi, radius: null },
		});
		const buf = Buffer.from(png);
		out.push({ name: v.name, theta: v.theta, base64: buf.toString('base64'), mimeType: 'image/png', png: buf });
	}
	return out;
}

/**
 * Judge one generated model. Never throws.
 *
 * @param {object} opts
 * @param {string} [opts.glbUrl]   public GLB URL (rendered here when views are not supplied)
 * @param {Array}  [opts.views]    pre-rendered views from renderCosmosViews
 * @param {string} [opts.prompt]   the generation prompt
 * @returns {Promise<object>} { available, plausible, issues, prompt_match, confidence, pass, model, latency_ms, views } or { available:false, error }
 */
export async function judgeWithCosmos({ glbUrl = null, views = null, prompt = null, reasoning = COSMOS_JUDGE_DEFAULTS.reasoning, timeoutMs = COSMOS_JUDGE_DEFAULTS.timeoutMs, fetchImpl = fetch, render } = {}) {
	if (!cosmosJudgeConfigured()) return { available: false, error: 'COSMOS_REASON_URL unset' };
	let imgs = views;
	try {
		if (!imgs) {
			if (!glbUrl) return { available: false, error: 'no glbUrl or views supplied' };
			imgs = await renderCosmosViews(glbUrl, render ? { render } : {});
		}
	} catch (e) {
		return { available: false, error: `render failed: ${e?.message || e}` };
	}
	const t0 = Date.now();
	try {
		const { answer, usage } = await callCosmosReason({ images: imgs, prompt, reasoning, timeoutMs, fetchImpl });
		const verdict = normalizeCosmosVerdict(parseJsonLoose(answer));
		return {
			available: true,
			...verdict,
			model: COSMOS_JUDGE_DEFAULTS.model,
			reasoning,
			latency_ms: Date.now() - t0,
			views: imgs.length,
			tokens: usage ? { input: usage.prompt_tokens ?? null, output: usage.completion_tokens ?? null } : null,
		};
	} catch (e) {
		return { available: false, error: String(e?.message || e).slice(0, 300), latency_ms: Date.now() - t0 };
	}
}

/**
 * Apply the active mode to the current judge's verdict and the Cosmos verdict.
 * Returns { verdict, applied } where applied names which judge decided
 * ('current' | 'cosmos'). The returned verdict is the current one, with pass
 * (and reason) overridden only when Cosmos decided.
 */
export function combineJudgeVerdicts(current, cosmos, {
	mode = cosmosJudgeMode(),
	passScore = 60,
	band = COSMOS_JUDGE_DEFAULTS.tiebreakBand,
	vetoIssues = cosmosVetoIssues(),
	vetoConfidence = COSMOS_JUDGE_DEFAULTS.vetoConfidence,
} = {}) {
	const keep = { verdict: current, applied: 'current' };
	if (!cosmos?.available || mode === 'off' || mode === 'shadow') return keep;

	const byCosmos = (why) => ({
		applied: 'cosmos',
		verdict: {
			...current,
			pass: cosmos.pass,
			qa_available: true,
			reason: cosmos.pass ? `cosmos-reason: physically plausible (${why})` : `cosmos-reason: ${cosmos.issues.join(', ') || 'not plausible'} (${why})`,
			defects: [...new Set([...(current?.defects || []), ...cosmos.issues])],
			judge: 'cosmos-reason',
		},
	});

	if (mode === 'primary') return byCosmos('primary');

	if (mode === 'veto') {
		const hit = cosmos.issues.filter((i) => vetoIssues.includes(i));
		if (current?.pass !== false && !cosmos.pass && hit.length && (cosmos.confidence ?? 0) >= vetoConfidence) {
			return byCosmos(`veto on ${hit.join(', ')}`);
		}
		return keep;
	}

	if (mode === 'tiebreak') {
		if (!current || current.qa_available === false) return byCosmos('current judge unavailable');
		const score = Number(current.score);
		if (!Number.isFinite(score) || Math.abs(score - passScore) <= band) return byCosmos('borderline current score');
		return keep;
	}
	return keep;
}
