// Pre-publication content screen for models that are about to appear on a PUBLIC
// three.ws page (gallery, feeds, search, sitemaps, /m/:id indexing).
//
// What this is, and is not
// ────────────────────────
// It is a gate on LISTING. Nothing a person generates is refused or filtered
// here: owner directive 2026-08-07 (see publish-safety.js) says no surface
// screens what a user may ASK for, and that stands. A model stays viewable by its
// maker and shareable by link either way. What this decides is whether three.ws
// puts its own name and its own indexing behind the model as public content.
//
// Fail-closed, unlike publish-safety.js
// ─────────────────────────────────────
// publish-safety.js fails OPEN because blocking an upload on a classifier outage
// is worse than a missed screen for the Sketchfab showcase. A public listing is
// the opposite trade: a model that cannot be screened stays unlisted until it
// can be. screenCreation therefore returns one of three verdicts:
//
//   clear       every available signal ran, parsed, and came back clean
//   blocked     a signal returned a parsed "unsafe" verdict
//   undecided   a signal could not answer (outage, timeout, unparseable, no key)
//
// The caller maps undecided to "keep waiting, retry, escalate to a human after
// a deadline". It never maps undecided to clear.
//
// Signals
//   text   NemoGuard content safety on the prompt (publish-safety.js)
//   image  the platform vision chain on the preview render, asked for a strict
//          boolean rubric. A lane whose reply is not the full rubric fails that
//          lane and the chain moves on (the `accept` hook), so a chatty model
//          cannot produce a false "clear" by omission.
//
// Minors: any sexualised depiction of a child or childlike figure is blocked and
// flagged `csam: true`. The caller preserves the evidence and escalates; this
// module never deletes anything.

import { classifyPublishSafety, publishSafetyConfig } from './publish-safety.js';
import { describeImage, parseJsonLoose, visionConfigured } from './vision.js';

export const SAFETY_STATUSES = ['pending', 'clear', 'held', 'blocked'];

/** Rubric keys, in the order the model is asked for them. All are required. */
export const IMAGE_RUBRIC = Object.freeze([
	'sexual_explicit',
	'sexual_minors',
	'graphic_violence',
	'hate_symbols',
	'self_harm',
]);

const IMAGE_PROMPT = `You are a trust and safety reviewer for a public gallery of 3D models. You are shown one render of a user-generated 3D model. Judge only what is visible.

Answer with ONE JSON object and nothing else, with exactly these boolean keys:
- "sexual_explicit": nudity, exposed genitals or nipples, or an explicit sexual pose or act. Includes stylised, cartoon, anime and 3D-rendered figures. Swimwear, ordinary clothing and anatomy-neutral mannequins are false.
- "sexual_minors": ANY sexualised depiction of a child, a childlike figure, or a character with childlike features, however stylised. Ordinary non-sexual children's characters are false.
- "graphic_violence": gore, dismemberment, exposed viscera, or graphic injury. Stylised weapons, armour and non-graphic combat are false.
- "hate_symbols": a swastika, SS runes, KKK imagery, or another unambiguous hate symbol used as such.
- "self_harm": depicts or promotes suicide or self-injury.

When unsure whether something crosses a line, answer true. Example reply: {"sexual_explicit":false,"sexual_minors":false,"graphic_violence":false,"hate_symbols":false,"self_harm":false}`;

/**
 * Validate one vision reply against the rubric. Throws (so the vision chain
 * treats the lane as failed and tries the next) unless EVERY key is a boolean.
 * @param {string} text
 * @returns {Record<string, boolean>}
 */
export function parseImageRubric(text) {
	const parsed = parseJsonLoose(text);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('rubric reply is not a JSON object');
	}
	const out = {};
	for (const key of IMAGE_RUBRIC) {
		if (typeof parsed[key] !== 'boolean') throw new Error(`rubric key ${key} missing or not boolean`);
		out[key] = parsed[key];
	}
	return out;
}

/** Absolute https URL for the vision provider to fetch, or null. */
export function absolutePreviewUrl(url, origin = 'https://three.ws') {
	if (typeof url !== 'string' || !url.trim()) return null;
	const raw = url.trim();
	if (raw.startsWith('//')) return `https:${raw}`;
	if (raw.startsWith('/')) return `${origin}${raw}`;
	return /^https:\/\//i.test(raw) ? raw : null;
}

/**
 * Screen one preview render. Never throws.
 * @returns {Promise<{ checked: boolean, flagged: boolean, categories: string[], model?: string, error?: string }>}
 */
export async function screenImage(imageUrl, { timeoutMs = 25_000, describe = describeImage, configured = visionConfigured } = {}) {
	const url = absolutePreviewUrl(imageUrl);
	if (!url) return { checked: false, flagged: false, categories: [], error: 'no_image_url' };
	if (!configured()) return { checked: false, flagged: false, categories: [], error: 'vision_unconfigured' };
	try {
		const out = await describe({
			prompt: IMAGE_PROMPT,
			imageUrl: url,
			maxTokens: 160,
			timeoutMs,
			deadlineMs: timeoutMs + 5000,
			accept: parseImageRubric,
			track: { tool: 'api/_lib/content-safety' },
		});
		const rubric = out.accepted;
		const categories = IMAGE_RUBRIC.filter((k) => rubric[k] === true);
		return { checked: true, flagged: categories.length > 0, categories, model: out.model };
	} catch (err) {
		return { checked: false, flagged: false, categories: [], error: String(err?.message || err).slice(0, 200) };
	}
}

/**
 * Screen the prompt text with NemoGuard. Never throws. Empty text is not a
 * signal: a model with no prompt is judged on its image alone.
 * @returns {Promise<{ checked: boolean, flagged: boolean, categories: string[], skipped?: boolean, error?: string, model?: string }>}
 */
export async function screenText(text, { classify = classifyPublishSafety, config = publishSafetyConfig } = {}) {
	const content = String(text ?? '').trim();
	if (!content) return { checked: true, flagged: false, categories: [], skipped: true };
	const cfg = config();
	if (!cfg.enabled || !cfg.key) return { checked: false, flagged: false, categories: [], error: 'text_classifier_unconfigured' };
	const out = await classify(content, { config: cfg });
	return {
		checked: out.checked === true,
		flagged: out.flagged === true,
		categories: Array.isArray(out.categories) ? out.categories : [],
		model: out.model,
		...(out.error ? { error: out.error } : {}),
	};
}

/**
 * Combine the signals into one verdict. Pure, so the fail-closed rule is
 * unit-tested without a network.
 * @param {{ text: object, image: object | null }} signals image is null when the
 *        model has no preview render to judge (text decides alone).
 * @returns {{ verdict: 'clear' | 'blocked' | 'undecided', categories: string[], csam: boolean, reasons: string[] }}
 */
export function combineSignals({ text, image }) {
	const parts = [text, image].filter(Boolean);
	const categories = [...new Set(parts.flatMap((p) => (p.flagged ? p.categories : [])))];
	const csam =
		categories.includes('sexual_minors') || categories.some((c) => /minor|child/i.test(c) && c !== 'sexual_minors');
	if (parts.some((p) => p.flagged)) {
		return { verdict: 'blocked', categories: categories.length ? categories : ['unspecified'], csam, reasons: [] };
	}
	const unanswered = parts.filter((p) => !p.checked);
	if (unanswered.length) {
		return { verdict: 'undecided', categories: [], csam: false, reasons: unanswered.map((p) => p.error || 'unchecked') };
	}
	return { verdict: 'clear', categories: [], csam: false, reasons: [] };
}

/**
 * Screen a creation for public listing.
 * @param {{ prompt?: string | null, previewImageUrl?: string | null }} creation
 * @param {object} [deps] test seams: screenTextFn, screenImageFn
 */
export async function screenCreation({ prompt, previewImageUrl }, deps = {}) {
	const textFn = deps.screenTextFn || screenText;
	const imageFn = deps.screenImageFn || screenImage;
	const hasImage = absolutePreviewUrl(previewImageUrl) !== null;
	const [text, image] = await Promise.all([textFn(prompt), hasImage ? imageFn(previewImageUrl) : Promise.resolve(null)]);
	const combined = combineSignals({ text, image });
	const models = [text?.model, image?.model].filter(Boolean);
	return { ...combined, models, signals: { text, image } };
}
