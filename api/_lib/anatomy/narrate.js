// Anatomy tour narration: one tour step, spoken.
//
//   narrateStep({ design, step }) → { text, source, model, voice, audioUrl, audio }
//
// For a featured design (hand-written, every fact sourced in
// docs/anatomy/rocket-engines-sources.md) the step's verified facts are sent to
// Grok, which turns them into a short spoken paragraph. The system prompt
// forbids adding facts, and a numeral guard backs it up: an answer that holds
// a number the input does not is discarded and the authored text is read
// instead. Any other saved design, and every design when GROK_API_KEY is not
// set, reads its authored step text. `source` says which happened ('grok' or
// 'authored'), so the page never credits Grok with text it did not write.
//
// Audio comes from the repo's free Edge TTS lane (api/_lib/voice-providers.js).
// Each narration (text and audio) is cached in object storage per design, step
// and content hash, so a step is written and synthesized once, then served from
// the CDN. Without object storage the clip rides back inline as base64.
//
// Spend: Grok calls record usage with client_id 'xai-anatomy' through
// llmComplete's track, and in the xai_usage ledger through recordLlmSpend.

import { env } from '../env.js';
import { sha256 } from '../crypto.js';
import { llmComplete, providerChain } from '../llm.js';
import { GROK_DEFAULT_MODEL } from '../chat-models.js';
import { synthesizeVoice } from '../voice-providers.js';
import { headObject, getObjectBuffer, objectStorageConfigured, putObject, publicUrl } from '../r2.js';
import { AnatomyError } from './service.js';

export const NARRATION_CLIENT_ID = 'xai-anatomy';
export const NARRATION_VOICE = 'en-US-AndrewMultilingualNeural';
// Bump when the prompt or guard changes so cached narrations are rewritten.
const PROMPT_VERSION = 'v1';
const MAX_WORDS = 110;
const GROK_TIMEOUT_MS = 25_000;
// Process-local cache in front of object storage: a popular tour step answers
// without even a HEAD request.
const memo = new Map();
const MEMO_MAX = 400;

export const NARRATION_SYSTEM_PROMPT = [
	'You narrate one step of an interactive engineering cutaway for a curious listener who is not an engineer.',
	'You are given verified facts. Turn them into a spoken paragraph of two to four sentences, at most 90 words.',
	'Use only the facts given. Do not add any fact, number, unit, name, date, comparison, history or claim that is not in the facts.',
	'Do not speculate, do not praise, do not mention companies or products unless the facts name them.',
	'If the facts are thin, say less rather than more. Plain sentences only: no markdown, no lists, no headings, no quotation marks around the whole answer.',
	'Never use the em dash or en dash characters. Answer with the narration text and nothing else.',
].join(' ');

/** The facts one step carries: its title, its body, and the parts it points at. PURE. */
export function stepFacts(spec, index) {
	const step = spec?.steps?.[index];
	if (!step) return null;
	const byId = new Map((spec.parts || []).map((p) => [p.id, p]));
	const parts = (step.focus || [])
		.map((id) => byId.get(id))
		.filter(Boolean)
		.map((p) => ({ name: p.name, description: p.description || '' }));
	return { title: step.title, body: step.body, parts };
}

/** The user message sent to Grok. PURE. */
export function narrationUserMessage(facts, designTitle) {
	const lines = [`Design: ${designTitle}`, `Step: ${facts.title}`, '', 'Verified facts:', facts.body];
	for (const p of facts.parts) {
		if (p.description) lines.push(`${p.name}: ${p.description}`);
	}
	lines.push('', 'Write the narration for this step.');
	return lines.join('\n');
}

const numberTokens = (text) =>
	(String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''));

/**
 * The numeral guard: every number in the answer must appear in the input.
 * Returns the list of numbers the answer invented (empty when it passes). PURE.
 */
export function inventedNumbers(answer, facts) {
	const allowed = new Set(numberTokens([facts.title, facts.body, ...facts.parts.map((p) => `${p.name} ${p.description}`)].join(' ')));
	return [...new Set(numberTokens(answer))].filter((n) => !allowed.has(n));
}

/** Tidy a model answer into speakable text, or '' when it is unusable. PURE. */
export function cleanNarration(raw) {
	let text = String(raw || '')
		.replace(/^["'\s]+|["'\s]+$/g, '')
		.replace(/[*_#`>]/g, '')
		.replace(/\s*[\u2013\u2014]\s*/g, ', ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) return '';
	const words = text.split(' ');
	if (words.length > MAX_WORDS) {
		const cut = words.slice(0, MAX_WORDS).join(' ');
		const end = cut.lastIndexOf('. ');
		text = end > 40 ? cut.slice(0, end + 1) : '';
	}
	return text;
}

/** The authored text, as it is read when Grok is not used. PURE. */
export function authoredNarration(facts) {
	return `${facts.title}. ${facts.body}`.replace(/\s*[\u2013\u2014]\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

function grokChain() {
	if (!env.GROK_API_KEY) return null;
	const grok = providerChain({ grokKey: env.GROK_API_KEY, grokModel: GROK_DEFAULT_MODEL }).find((p) => p.name === 'grok');
	return grok ? [grok] : null;
}

/**
 * Ask Grok for the narration. Returns { text, model } or null when Grok is not
 * configured, failed, or broke the guard (the reason is logged).
 */
export async function grokNarration({ facts, designTitle, step, designId, complete = llmComplete, chain = grokChain() }) {
	if (!chain) return null;
	try {
		const out = await complete({
			system: NARRATION_SYSTEM_PROMPT,
			user: narrationUserMessage(facts, designTitle),
			maxTokens: 400,
			timeoutMs: GROK_TIMEOUT_MS,
			chain,
			track: { clientId: NARRATION_CLIENT_ID, tool: 'anatomy_narrate' },
		});
		const text = cleanNarration(out?.text);
		if (!text) {
			console.warn(`[anatomy/narrate] grok answer unusable for ${designId} step ${step}`);
			return null;
		}
		const invented = inventedNumbers(text, facts);
		if (invented.length) {
			console.warn(`[anatomy/narrate] guard rejected grok answer for ${designId} step ${step}: invented ${invented.join(', ')}`);
			return null;
		}
		return { text, model: out.model || GROK_DEFAULT_MODEL };
	} catch (err) {
		console.warn(`[anatomy/narrate] grok failed for ${designId} step ${step}: ${err?.status || ''} ${err?.message}`);
		return null;
	}
}

function remember(key, value) {
	if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
	memo.set(key, value);
	return value;
}

async function cacheKeys({ designId, step, facts, source }) {
	const hash = (await sha256([PROMPT_VERSION, source, source === 'grok' ? GROK_DEFAULT_MODEL : '', NARRATION_VOICE, JSON.stringify(facts)].join('\x00'))).slice(0, 24);
	const base = `anatomy/narration/${designId}/${step}-${source}-${hash}`;
	return { json: `${base}.json`, audio: `${base}.mp3` };
}

async function readCached(keys) {
	if (memo.has(keys.json)) return memo.get(keys.json);
	if (!objectStorageConfigured()) return null;
	const head = await headObject(keys.json).catch(() => null);
	if (!head) return null;
	try {
		const cached = JSON.parse((await getObjectBuffer(keys.json)).toString('utf8'));
		return remember(keys.json, { ...cached, audioUrl: publicUrl(keys.audio), audio: null });
	} catch {
		return null;
	}
}

async function synthesize(text) {
	try {
		return await synthesizeVoice({ provider: 'edge', voiceId: NARRATION_VOICE, text });
	} catch (err) {
		throw new AnatomyError('narration_audio_failed', 'The voice lane did not answer. The narration text is shown instead; try again in a minute.', 502, String(err?.message || '').slice(0, 200));
	}
}

async function store(keys, record, clip) {
	if (!objectStorageConfigured()) return { ...record, audioUrl: null, audio: { base64: clip.audio.toString('base64'), contentType: clip.contentType } };
	try {
		await putObject({ key: keys.audio, body: clip.audio, contentType: clip.contentType, metadata: { 'created-at': new Date().toISOString() } });
		await putObject({ key: keys.json, body: Buffer.from(JSON.stringify(record)), contentType: 'application/json' });
		return remember(keys.json, { ...record, audioUrl: publicUrl(keys.audio), audio: null });
	} catch (err) {
		console.warn('[anatomy/narrate] storage write failed, answering inline:', err?.message);
		return { ...record, audioUrl: null, audio: { base64: clip.audio.toString('base64'), contentType: clip.contentType } };
	}
}

/**
 * Narrate one step of a design. `verified` designs (the featured registry) go
 * through Grok when it is configured; everything else reads authored text.
 * `onMiss` runs before any upstream work (the caller rate limits there).
 */
export async function narrateStep({ design, step, verified, onMiss = async () => {} }) {
	const index = Number(step);
	const facts = Number.isInteger(index) ? stepFacts(design.spec, index) : null;
	if (!facts) throw new AnatomyError('invalid_step', 'That tour step does not exist.', 400);

	const wantGrok = verified && Boolean(env.GROK_API_KEY);
	if (wantGrok) {
		const keys = await cacheKeys({ designId: design.id, step: index, facts, source: 'grok' });
		const hit = await readCached(keys);
		if (hit) return { ...hit, cached: true };
		await onMiss();
		const grok = await grokNarration({ facts, designTitle: design.title, step: index, designId: design.id });
		if (grok) {
			const clip = await synthesize(grok.text);
			const record = { step: index, text: grok.text, source: 'grok', model: grok.model, voice: NARRATION_VOICE };
			return { ...(await store(keys, record, clip)), cached: false };
		}
	}

	const keys = await cacheKeys({ designId: design.id, step: index, facts, source: 'authored' });
	const hit = await readCached(keys);
	if (hit) return { ...hit, cached: true };
	if (!wantGrok) await onMiss();
	const text = authoredNarration(facts);
	const clip = await synthesize(text);
	const record = { step: index, text, source: 'authored', model: null, voice: NARRATION_VOICE };
	return { ...(await store(keys, record, clip)), cached: false };
}
