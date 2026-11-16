// i18n-nvidia: per-language model routing for the NVIDIA translation lane.
//
// NVIDIA serves several models on one NIM key that can translate: the
// translation-specialized Riva Translate instruct model and the general
// Nemotron chat models. Which one is best depends on the language, so the
// choice is measured, not guessed: `scripts/nvidia-translation-eval.mjs` scores
// every candidate on a FLORES-200 devtest sample per configured locale and
// writes the winner (or "no model passes the bar") to i18n-nvidia-routes.json,
// which the translate pipeline reads here.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROUTES_PATH = fileURLToPath(new URL('./i18n-nvidia-routes.json', import.meta.url));

/** NVIDIA models the evaluation scores for translation, in tie-break order. */
export const NVIDIA_TRANSLATION_CANDIDATES = [
	// Translation-specialized and the smallest, so it wins any tie on speed.
	'nvidia/riva-translate-4b-instruct-v2',
	'nvidia/nemotron-3.5-lightning-30b-a3b',
	// The lane's long-standing default (see PROVIDER_DEFAULT_MODEL).
	'nvidia/nemotron-3-ultra-550b-a55b',
];

export const NVIDIA_DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';

// Riva Translate has an 8,192-token context window shared by prompt and reply,
// so asking it for 8,192 output tokens is a 400 on every request. A full chunk
// (about 1,200 source tokens plus the prompt) fits comfortably under 4,096.
export function nvidiaMaxTokens(model) {
	return /riva-translate/i.test(model) ? 4096 : 8192;
}

// Nemotron models reason by default; the switch that turns it off is a chat
// template kwarg the Riva Translate template does not take.
export function nvidiaRequestExtras(model) {
	return /nemotron/i.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {};
}

/**
 * The language name a prompt should use: the English name the models were
 * trained to follow, with the native name alongside so the script is
 * unambiguous ("Serbian (Српски)" asks for Cyrillic, not Latin).
 */
export function promptLanguageName(code, nativeName) {
	let english = '';
	try {
		english = new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || '';
	} catch {
		english = '';
	}
	if (english && english !== code && nativeName && nativeName !== english) return `${english} (${nativeName})`;
	return english && english !== code ? english : nativeName || code;
}

/** The translation prompt every backend receives. */
export function buildTranslatePrompt(langName, payload, reference = '') {
	return [
		`You are a professional software localizer translating UI and marketing copy from English to ${langName}.`,
		reference || '',
		'',
		'Rules:',
		`- Translate every VALUE in the JSON below into ${langName}. Keep every KEY exactly as-is.`,
		'- Each KEY names the page and UI element the value belongs to (page.element). Use it as context to pick the right sense of short or ambiguous labels: on a 3D-printing page, "Finish" is the surface finish of a print, not "complete".',
		'- Return ONLY a single JSON object with the same keys. No prose, no markdown, no code fences.',
		'- Some values contain protected tokens written as [[T0]], [[T1]], and so on. They stand in for brand names, code, and placeholders. Copy each token VERBATIM into a natural position for the target language. Never translate a token, change its number, add one, or drop one.',
		'- Preserve meaning and tone. Do not add explanations.',
		'',
		'JSON to translate:',
		JSON.stringify(payload),
	]
		.filter(Boolean)
		.join('\n');
}

export const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * One chat completion on the NVIDIA NIM endpoint. Throws an Error carrying
 * `status` and `retryAfter` (seconds) on an HTTP failure so callers can back
 * off on a 429 the same way the rest of the pipeline does.
 */
export async function nvidiaChat({ model, prompt, key, temperature = 0.2, topP = 0.9, timeoutMs = 180_000, fetchImpl = fetch }) {
	const res = await fetchImpl(NVIDIA_CHAT_URL, {
		signal: AbortSignal.timeout(timeoutMs),
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
		body: JSON.stringify({
			model,
			temperature,
			top_p: topP,
			max_tokens: nvidiaMaxTokens(model),
			messages: [{ role: 'user', content: prompt }],
			...nvidiaRequestExtras(model),
		}),
	});
	if (!res.ok) {
		const body = await res.text();
		throw Object.assign(new Error(`nvidia ${res.status}: ${body.slice(0, 300)}`), {
			status: res.status,
			retryAfter: Number(res.headers.get('retry-after')) || 0,
		});
	}
	const data = await res.json();
	return data?.choices?.[0]?.message?.content || '';
}

/** Read the committed routing table, or an empty one before the first eval. */
export function loadNvidiaRoutes(path = ROUTES_PATH) {
	if (!existsSync(path)) return { locales: {} };
	const parsed = JSON.parse(readFileSync(path, 'utf8'));
	return { ...parsed, locales: parsed.locales || {} };
}

/**
 * The model the NVIDIA lane uses for a locale.
 *
 * `eligible` is false when the evaluation found no NVIDIA model that clears
 * the bar for that language: the lane then refuses the locale (the run skips
 * it on this lane and leaves it to another provider or untranslated), rather
 * than writing translations it already measured as below standard. A locale
 * the evaluation never scored keeps the lane default and stays eligible, so a
 * newly added locale is not silently dropped.
 */
export function resolveNvidiaModel(code, routes, { pinned = '' } = {}) {
	if (pinned) return { model: pinned, eligible: true, source: 'pinned' };
	const r = routes?.locales?.[code];
	if (!r) return { model: NVIDIA_DEFAULT_MODEL, eligible: true, source: 'default' };
	if (!r.model) return { model: null, eligible: false, source: 'eval' };
	return { model: r.model, eligible: r.eligible !== false, source: 'eval' };
}
