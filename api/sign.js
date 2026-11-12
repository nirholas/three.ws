/**
 * /api/sign — text → American Sign Language, as a retargetable animation clip.
 *
 *   GET  /api/sign
 *     → the descriptor: parameters, limits, and the full lexical vocabulary
 *       with each sign's gloss. Call this to discover what will sign vs spell.
 *
 *   GET  /api/sign?text=happy+to+meet+you[&hand=left][&speed=0.75][&format=timeline][&lang=ase]
 *   POST /api/sign  { text, hand, speed, max_seconds, format, lang }
 *     → { text, duration, words, signed, spelled, timeline, clip, viewer }
 *
 * `lang` picks a sign language pack (src/sign-packs/). Without it the answer is
 * exactly the ASL answer it has always been. With it the answer also carries
 * `lang` and `review: { approved, total }`, and for a pack that is not native
 * only signs approved by fluent reviewers are performed: any other word comes
 * back as `signed: false, unsupported: true` and is never fingerspelled in the
 * ASL alphabet. An unknown pack, or one with no approved sign, answers
 * 400 unsupported_language with the packs that are available.
 *
 * This is the writing half of the signing stack; /api/asl-recognition is the
 * reading half. The compiler (src/sign-speech.js) is the same one the browser
 * runs, and it is platform-free by design — no three.js, no DOM — so the server
 * produces a byte-identical clip to the one /sign-language plays. `clip` is a
 * three.js AnimationClip document keyed to the canonical skeleton: load it
 * alongside any rigged humanoid, retarget it (src/animation-retarget.js, or
 * @three-ws/retarget), and play. Nothing here needs an account or a key.
 *
 * `timeline` is the part a UI wants: one entry per word with the seconds it
 * occupies, whether it was signed or spelled, the sign's gloss, and for a
 * spelled word where every letter lands. That is enough to caption an utterance
 * in sync without re-deriving the cadence it was compiled from.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { env } from './_lib/env.js';
import { compileUtterance, scaledTiming, utteranceWords } from '../src/sign-speech.js';
import { SIGNS, signLookup } from '../src/sign-dictionary.js';
import { DEFAULT_PACK_ID, getPack, servablePack, servablePacks } from '../src/sign-packs/index.js';

// Long enough for a paragraph, short enough that one call stays a few tens of
// milliseconds of CPU. Past this the caller should split the text themselves,
// which is also what produces watchable signing.
const MAX_TEXT_CHARS = 600;
const MAX_BODY_BYTES = 16_000;

// Clip coordinates are quaternion components and seconds; five decimals is well
// under a millimetre at arm's length and halves the payload before gzip.
const PRECISION = 1e5;

const SPEED_RANGE = { min: 0.25, max: 1.5 };
const SECONDS_RANGE = { min: 1, max: 60, default: 45 };

function round(n) {
	return Math.round(n * PRECISION) / PRECISION;
}

/** Round every number in a compiled clip document, in place. */
function compactClip(clip) {
	return {
		name: clip.name,
		duration: round(clip.duration),
		blendMode: clip.blendMode,
		tracks: clip.tracks.map((t) => ({
			type: t.type,
			name: t.name,
			times: t.times.map(round),
			values: t.values.map(round),
		})),
	};
}

function clampNumber(raw, { min, max, fallback }) {
	const n = Number(raw);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

/** The one place request params turn into compiler options. */
function readParams(source) {
	const text = String(source.text ?? '').slice(0, MAX_TEXT_CHARS);
	const hand = String(source.hand ?? '').toLowerCase() === 'left' ? 'Left' : 'Right';
	const speed = clampNumber(source.speed, { ...SPEED_RANGE, fallback: 1 });
	const maxSeconds = clampNumber(source.max_seconds ?? source.maxSeconds, {
		min: SECONDS_RANGE.min,
		max: SECONDS_RANGE.max,
		fallback: SECONDS_RANGE.default,
	});
	const format = String(source.format ?? 'clip').toLowerCase() === 'timeline' ? 'timeline' : 'clip';
	const rawLang = source.lang ?? source.language;
	const lang = rawLang == null || String(rawLang).trim() === '' ? null : String(rawLang).trim().slice(0, 35);
	return { text, hand, speed, maxSeconds, format, lang };
}

/** The packs a caller may ask for: at least one approved sign each. */
function availableLanguages() {
	return servablePacks().map((p) => ({
		lang: p.id,
		name: p.name,
		approved: p.review.approved,
		total: p.review.total,
	}));
}

/**
 * The servable pack for a requested `lang`, or null when that language is
 * unknown or has nothing approved yet.
 * @param {string} lang
 */
function resolveLanguage(lang) {
	const pack = getPack(lang);
	if (!pack) return null;
	const view = servablePack(pack);
	return view.review.approved > 0 ? view : null;
}

function descriptor(origin) {
	const vocabulary = Object.entries(SIGNS)
		.map(([word, sign]) => ({ word, gloss: sign.gloss }))
		.sort((a, b) => a.word.localeCompare(b.word));
	return {
		service: 'three.ws sign',
		summary:
			'Compile English text into one continuous American Sign Language animation clip. ' +
			'Words in the vocabulary are signed; everything else is fingerspelled letter by letter.',
		usage: {
			compile: `${origin}/api/sign?text=happy+to+meet+you`,
			timeline_only: `${origin}/api/sign?text=happy+to+meet+you&format=timeline`,
			left_handed: `${origin}/api/sign?text=hello&hand=left`,
			post: `POST ${origin}/api/sign  {"text":"hello","speed":0.75}`,
		},
		parameters: {
			text: `required to compile. Letters, digits and spaces survive; punctuation is dropped. Up to ${MAX_TEXT_CHARS} characters.`,
			hand: 'right (default) or left. The whole sign mirrors, not just the hand.',
			speed: `${SPEED_RANGE.min}-${SPEED_RANGE.max}, default 1. Below 1 is a signer taking longer over the same signs.`,
			max_seconds: `${SECONDS_RANGE.min}-${SECONDS_RANGE.max}, default ${SECONDS_RANGE.default}. Longer text is truncated at a word boundary and flagged.`,
			format: 'clip (default) returns the animation clip plus the timeline; timeline returns only the timeline, which is small and free of clip data.',
			lang: `sign language pack, default ${DEFAULT_PACK_ID} (American Sign Language). See languages for what is available; a pack other than ASL performs only signs approved by fluent reviewers and reports every other word as unsupported.`,
		},
		languages: availableLanguages(),
		clip_format: {
			description:
				'A three.js AnimationClip document keyed to the canonical humanoid skeleton, rotation lanes only. Retarget it onto any rigged humanoid, then play it.',
			retarget: 'https://www.npmjs.com/package/@three-ws/retarget',
			engine: 'https://www.npmjs.com/package/@three-ws/sign-language',
		},
		vocabulary_size: vocabulary.length,
		vocabulary,
		reading_direction: `${origin}/api/asl-recognition`,
		docs: `${origin}/docs/sign-language`,
		watch: `${origin}/sign-language`,
		scope:
			'Citation-form signs in English word order (signed English), not ASL grammar. It makes an avatar legible to signers; it does not replace an interpreter.',
	};
}

/**
 * @param {ReturnType<typeof readParams>} params
 * @param {string} origin
 * @param {object|null} [pack]  servable pack when the caller named a language;
 *   null keeps the historical ASL response shape exactly.
 */
function compile(params, origin, packArg = null) {
	const pack = packArg ? servablePack(packArg) : null;
	const { text, hand, speed, maxSeconds, format } = params;
	// Fingerspelling exists only for the ASL manual alphabet. A pack without it
	// reports unspellable words as unsupported rather than borrowing ASL letters.
	const spell = !pack || pack.alphabet === 'asl-manual';
	const result = compileUtterance(text, {
		signs: signLookup({ dominant: hand, rate: speed, ...(pack ? { pack } : {}) }),
		timing: speed === 1 ? undefined : scaledTiming(speed),
		maxSeconds,
		dominant: hand,
		...(pack ? { pack, spell } : {}),
	});

	const timeline = result.segments.map((s) => ({
		word: s.word,
		signed: s.signed,
		gloss: s.gloss,
		start: round(s.start),
		end: round(s.end),
		letters: s.letters?.map((l) => ({ letter: l.letter, start: round(l.start), end: round(l.end) })) ?? null,
		...(s.unsupported ? { unsupported: true } : {}),
	}));
	const langQuery = pack && pack.id !== DEFAULT_PACK_ID ? `&lang=${encodeURIComponent(pack.id)}` : '';

	const body = {
		text,
		duration: round(result.clip.duration),
		words: result.words,
		signed: result.signed,
		spelled: result.spelled,
		truncated: result.truncated,
		hand: hand.toLowerCase(),
		speed,
		timeline,
		viewer: `${origin}/sign-language?say=${encodeURIComponent(text)}${langQuery}`,
	};
	if (pack) {
		body.lang = pack.id;
		body.review = { approved: pack.review.approved, total: pack.review.total };
		if (result.unsupported) body.unsupported = result.unsupported;
	}
	if (format === 'clip') body.clip = compactClip(result.clip);
	return body;
}

// Deterministic output: the same text, hand and speed always compile to the same
// clip, so it caches hard at the edge and the compile only ever runs once.
const CACHE_HEADERS = {
	'cache-control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
};

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const origin = env.APP_ORIGIN.replace(/\/$/, '');

	let source;
	if (req.method === 'GET') {
		const url = new URL(req.url, 'http://localhost');
		source = Object.fromEntries(url.searchParams);
		// A bare GET is the discovery call: what this does, and what it can sign.
		if (!String(source.text ?? '').trim()) return json(res, 200, descriptor(origin), CACHE_HEADERS);
	} else {
		const body = await readJson(req, MAX_BODY_BYTES).catch(() => null);
		if (!body || typeof body !== 'object') {
			return json(res, 400, {
				error: 'bad_request',
				message: 'Body must be JSON: { "text": "happy to meet you" }.',
			});
		}
		source = body;
	}

	const params = readParams(source);
	if (!params.text.trim()) {
		return json(res, 400, {
			error: 'missing_text',
			message: 'Pass text to sign, for example { "text": "happy to meet you" }.',
		});
	}
	if (!utteranceWords(params.text).length) {
		return json(res, 400, {
			error: 'unsignable_text',
			message:
				'That text has nothing signable in it. Fingerspelling covers A-Z and 0-9; punctuation and other scripts are dropped.',
		});
	}

	let pack = null;
	if (params.lang) {
		pack = resolveLanguage(params.lang);
		if (!pack) {
			return json(res, 400, {
				error: 'unsupported_language',
				message: `No sign language pack "${params.lang}" with reviewed signs is available. Languages ship only after fluent signers approve them.`,
				available: availableLanguages(),
			});
		}
	}

	const rl = await limits.signCompileIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'Sign compile limit reached. Try again shortly.');

	return json(res, 200, compile(params, origin, pack), CACHE_HEADERS);
});

export { descriptor, compile, readParams, resolveLanguage, availableLanguages, MAX_TEXT_CHARS };
