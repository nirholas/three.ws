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

/**
 * The translation prompt every backend receives. `fromName` is English for a
 * forward pass and the target language for the quality gate's back-translation.
 */
export function buildTranslatePrompt(langName, payload, reference = '', fromName = 'English') {
	return [
		`You are a professional software localizer translating UI and marketing copy from ${fromName} to ${langName}.`,
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

// --- request modes -----------------------------------------------------------
//
// Nemotron follows the JSON contract every other backend uses. Riva Translate
// does not: measured 2026-11-16, it translates a JSON payload as running prose
// (structure gone past about 10 entries) and leaves inner quotes unescaped, so
// half its replies never parse. Its native shape is text in, text out, and it
// keeps inline tags, so it gets each value wrapped in a numbered <sN> tag
// instead, at most 10 per request (20 dropped segments on Japanese and German).
// A system prompt made it answer in the wrong language (German request,
// Romanian reply), so the instruction stays in the user turn.

export const SEGMENT_BATCH_MAX = 10;

export function nvidiaRequestMode(model) {
	return /riva-translate/i.test(model) ? 'segments' : 'json';
}

/** Largest number of keys one request may carry for this model. */
export function nvidiaMaxKeysPerChunk(model) {
	return nvidiaRequestMode(model) === 'segments' ? SEGMENT_BATCH_MAX : Infinity;
}

/**
 * The tagged-segment prompt. Values are addressed by position, so a key never
 * reaches the model (it would translate it). The instruction is one line and
 * nothing else: Riva reads every further line of instructions as text to
 * translate, renders them, and stops before the segments.
 */
export function buildSegmentPrompt(langName, payload, fromName = 'English') {
	const keys = Object.keys(payload);
	const body = keys.map((k, i) => `<s${i}>${payload[k]}</s${i}>`).join('\n');
	return `Translate the following text from ${fromName} to ${langName}:\n${body}`;
}

/** Map a tagged reply back onto the payload's keys; absent segments stay absent. */
export function parseSegmentReply(raw, keys) {
	const out = {};
	for (const m of String(raw ?? '').matchAll(/<s(\d+)>([\s\S]*?)<\/s\1>/g)) {
		const k = keys[Number(m[1])];
		if (k !== undefined && !(k in out)) out[k] = m[2].trim();
	}
	return out;
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

function parseJsonReply(raw) {
	const text = String(raw ?? '')
		.replace(/^\s*```(?:json)?/i, '')
		.replace(/```\s*$/, '')
		.trim();
	try {
		return JSON.parse(text);
	} catch {
		const s = text.indexOf('{');
		const e = text.lastIndexOf('}');
		if (s === -1 || e <= s) throw new Error('no JSON object in response');
		return JSON.parse(text.slice(s, e + 1).replace(/,\s*([}\]])/g, '$1'));
	}
}

/**
 * Translate one payload (key -> English value) with an NVIDIA model, in the
 * request mode that model needs. Resolves to key -> translated value; a key
 * the model dropped is simply absent, for the quality gate to re-queue.
 * `parseJSON` lets the pipeline pass its more forgiving JSON5-backed parser.
 */
export async function nvidiaTranslate({ model, langName, payload, reference = '', fromName = 'English', key, temperature, topP, timeoutMs, fetchImpl, parseJSON = parseJsonReply }) {
	const keys = Object.keys(payload);
	if (nvidiaRequestMode(model) === 'segments') {
		const raw = await nvidiaChat({ model, prompt: buildSegmentPrompt(langName, payload, fromName), key, temperature, topP, timeoutMs, fetchImpl });
		const out = parseSegmentReply(raw, keys);
		if (!Object.keys(out).length) throw new Error('no tagged segments in response');
		return out;
	}
	const raw = await nvidiaChat({ model, prompt: buildTranslatePrompt(langName, payload, reference, fromName), key, temperature, topP, timeoutMs, fetchImpl });
	const parsed = parseJSON(raw);
	if (!parsed || typeof parsed !== 'object') throw new Error('non-object response');
	return parsed;
}
