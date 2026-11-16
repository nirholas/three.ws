// i18n-quality: the measured quality bar every machine-translated batch must
// clear before it is written into a catalog.
//
// Four checks, all pure so the evaluation harness and the translate pipeline
// share exactly one definition of "good enough":
//
//   1. token integrity    every [[Tn]] sentinel (placeholder, HTML tag, entity,
//                         glossary term) comes back exactly once, none invented
//   2. markup integrity   after unmasking, the value renders the same tags
//   3. length sanity      the translation is not a truncation or a runaway
//   4. back-translation   translated back to English, the value still says what
//                         the source said (chrF against the source)
//
// A key that fails any check is re-queued for another attempt, and a key that
// never passes is left untranslated (the runtime shows English for a missing
// key). It is never written, because a written value counts as translated and
// would hide the failure from the parity check forever.

import { markupDrift } from './i18n-shared.mjs';

const TOKEN_RE = /\[\[T(\d+)\]\]/g;

// --- chrF ------------------------------------------------------------------
//
// chrF2 as computed by sacrebleu (character n-gram order 6, word order 0,
// beta 2, whitespace removed): per-order precision and recall from summed
// statistics, an F-beta per order, averaged over the orders that had n-grams on
// both sides. Scores are 0 to 100. Corpus scores sum the statistics across
// every segment before computing F, which is how sacrebleu reports a test set.

const CHRF_ORDER = 6;
const CHRF_BETA = 2;

function charNgrams(text, n) {
	const chars = Array.from(text.replace(/\s+/g, ''));
	const counts = new Map();
	for (let i = 0; i + n <= chars.length; i++) {
		const g = chars.slice(i, i + n).join('');
		counts.set(g, (counts.get(g) || 0) + 1);
	}
	return counts;
}

function segmentStats(hyp, ref) {
	const stats = [];
	for (let n = 1; n <= CHRF_ORDER; n++) {
		const h = charNgrams(String(hyp ?? ''), n);
		const r = charNgrams(String(ref ?? ''), n);
		let hypTotal = 0;
		let refTotal = 0;
		let match = 0;
		for (const c of h.values()) hypTotal += c;
		for (const [g, c] of r) {
			refTotal += c;
			match += Math.min(c, h.get(g) || 0);
		}
		stats.push([hypTotal, refTotal, match]);
	}
	return stats;
}

function fScore(stats) {
	const factor = CHRF_BETA ** 2;
	let score = 0;
	let effective = 0;
	for (const [hypTotal, refTotal, match] of stats) {
		if (hypTotal === 0 || refTotal === 0) continue;
		effective++;
		const prec = match / hypTotal;
		const rec = match / refTotal;
		const denom = factor * prec + rec;
		score += denom > 0 ? ((1 + factor) * prec * rec) / denom : 0;
	}
	return effective ? (100 * score) / effective : 0;
}

/** Sentence-level chrF2 of one hypothesis against one reference. */
export function chrF(hyp, ref) {
	return fScore(segmentStats(hyp, ref));
}

/** Corpus-level chrF2: statistics summed over every (hyp, ref) pair. */
export function corpusChrF(hyps, refs) {
	const total = Array.from({ length: CHRF_ORDER }, () => [0, 0, 0]);
	hyps.forEach((hyp, i) => {
		segmentStats(hyp, refs[i]).forEach((s, n) => {
			total[n][0] += s[0];
			total[n][1] += s[1];
			total[n][2] += s[2];
		});
	});
	return fScore(total);
}

// --- integrity -------------------------------------------------------------

/** The sorted multiset of [[Tn]] ids in a string, as a comparable signature. */
export function tokenSignature(text) {
	return Array.from(String(text ?? '').matchAll(TOKEN_RE), (m) => Number(m[1]))
		.sort((a, b) => a - b)
		.join(',');
}

/** True when the masked translation carries exactly the source's sentinels. */
export function tokensIntact(maskedSource, maskedOut) {
	return tokenSignature(maskedSource) === tokenSignature(maskedOut);
}

// Scripts written without spaces between words, plus the dense CJK scripts,
// legitimately come out far shorter in characters than the English source.
const COMPACT_LOCALES = new Set(['zh-CN', 'zh-TW', 'ja', 'ko', 'th', 'lo', 'km', 'my']);

/**
 * Is a translation's length plausible for its source?
 *
 * Measured on the visible text with sentinels removed, so a string that is
 * mostly a brand name or a placeholder is judged on its words. Very short
 * sources (a label of a word or two) are exempt: "OK" becoming "Aceptar" is a
 * 3.5x ratio and perfectly correct.
 */
export function lengthSane(source, out, code) {
	const strip = (s) => String(s ?? '').replace(TOKEN_RE, '').replace(/\s+/g, ' ').trim();
	const s = Array.from(strip(source)).length;
	const o = Array.from(strip(out)).length;
	if (s === 0) return true;
	if (o === 0) return false;
	if (s < 12) return o <= 60;
	const ratio = o / s;
	const min = COMPACT_LOCALES.has(code) ? 0.15 : 0.35;
	return ratio >= min && ratio <= 3.2;
}

// A model that gives up hands the English back. For a real sentence that is a
// failure even when every token survived: the key would be written, counted as
// translated, and render in English forever. Short labels are exempt because
// many are identical across languages ("OK", "Email", "API"), and so is code:
// when the original source is passed, words inside <code>/<pre> blocks, tags,
// entities and URLs do not count, since a code sample must come back unchanged.
function proseWords(text) {
	return (
		String(text ?? '')
			.replace(/<(code|pre|kbd|samp)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&[#a-zA-Z0-9]+;/g, ' ')
			.replace(/https?:\/\/\S+/g, ' ')
			.replace(TOKEN_RE, ' ')
			.match(/[A-Za-z]{2,}/g) || []
	);
}

export function isEcho(maskedSource, maskedOut, source = maskedSource) {
	if (proseWords(source).length < 4) return false;
	const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
	return norm(maskedSource) === norm(maskedOut);
}

// --- the gate --------------------------------------------------------------

/** Defaults for the back-translation part of the gate. */
export const BACK_TRANSLATION = {
	// Per key: back-translations of a sentence vary in wording, so this floor
	// only catches a value whose meaning has gone (wrong sense, hallucination,
	// another language entirely). Measured on the 2026-11-16 evaluation: good
	// translations sit at a median chrF in the 60s, garbage below 20.
	minKeyChrF: 25,
	// Sources shorter than this are not scored per key: chrF on one or two
	// words swings on a synonym ("Start" back as "Begin").
	minScoredChars: 24,
	// Per batch: the mean over every scored key. A batch whose average sits
	// below this was translated by a model that is struggling with the
	// language, and all of it goes back to the queue.
	minBatchChrF: 40,
	// The batch mean only applies from this many scored keys. On the two or
	// three keys a re-queued round sends, one loose paraphrase is the whole
	// mean, and the per-key floor already judges each of them.
	minBatchKeys: 5,
};

/**
 * Check one translated batch. Pure: every input is passed in.
 *
 * @param {object} p
 * @param {string} p.code               target locale code
 * @param {Record<string,string>} p.masked   key -> masked English source
 * @param {Record<string,string>} p.sources  key -> original English source
 * @param {Record<string,unknown>} p.out     key -> masked model output
 * @param {(key: string, masked: string) => string} p.unmask restore a value
 * @param {Record<string,string>|null} [p.back] key -> masked back-translation
 * @param {object} [p.bar]              override BACK_TRANSLATION thresholds
 * @returns {{ passed: Record<string,string>, failed: Record<string,string[]>, batchChrF: number|null }}
 *   passed maps key -> unmasked translation ready to write; failed maps key ->
 *   the reasons it was rejected.
 */
export function gateBatch({ code, masked, sources, out, unmask, back = null, bar = {} }) {
	const b = { ...BACK_TRANSLATION, ...bar };
	const passed = {};
	const failed = {};
	const reject = (k, reason) => (failed[k] ||= []).push(reason);

	for (const k of Object.keys(masked)) {
		const m = masked[k];
		const v = out?.[k];
		if (typeof v !== 'string') {
			reject(k, 'missing from reply');
			continue;
		}
		if (!v.trim() && String(m).trim()) {
			reject(k, 'empty value');
			continue;
		}
		if (!tokensIntact(m, v)) reject(k, `token drift ${tokenSignature(m) || '∅'} -> ${tokenSignature(v) || '∅'}`);
		const value = unmask(k, v);
		if (markupDrift(sources[k], value)) reject(k, 'markup drift');
		if (!lengthSane(m, v, code)) reject(k, 'length out of range');
		if (isEcho(m, v, sources[k])) reject(k, 'untranslated echo');
		if (!failed[k]) passed[k] = value;
	}

	let batchChrF = null;
	if (back) {
		const scored = [];
		for (const k of Object.keys(passed)) {
			const src = String(masked[k]).replace(TOKEN_RE, ' ');
			if (src.replace(/\s+/g, '').length < b.minScoredChars) continue;
			const bt = back[k];
			// A value the back-translation reply dropped was never judged, so it
			// is re-queued as unverified rather than scored 0, which would also
			// sink every key in the batch mean.
			if (typeof bt !== 'string' || !bt.trim()) {
				delete passed[k];
				reject(k, 'back-translation missing');
				continue;
			}
			scored.push([k, chrF(bt.replace(TOKEN_RE, ' '), src)]);
		}
		if (scored.length) {
			batchChrF = scored.reduce((s, [, x]) => s + x, 0) / scored.length;
			for (const [k, score] of scored) {
				if (score < b.minKeyChrF) {
					delete passed[k];
					reject(k, `back-translation chrF ${score.toFixed(1)} < ${b.minKeyChrF}`);
				}
			}
			if (scored.length >= b.minBatchKeys && batchChrF < b.minBatchChrF) {
				for (const k of Object.keys(passed)) {
					delete passed[k];
					reject(k, `batch back-translation chrF ${batchChrF.toFixed(1)} < ${b.minBatchChrF}`);
				}
			}
		}
	}
	return { passed, failed, batchChrF };
}

// --- re-queue --------------------------------------------------------------

/**
 * Translate a set of keys until each passes the gate or runs out of attempts.
 *
 * `attempt(keys)` performs one translate + gate round and resolves to
 * `{ passed, failed }` (the gateBatch shape). Keys that fail go back in the
 * queue for the next round; after `maxRounds` the survivors are returned as
 * `rejected` and the caller must not write them.
 */
export async function translateWithRequeue(keys, attempt, { maxRounds = 3, onRound } = {}) {
	const accepted = {};
	let queue = [...keys];
	let lastReasons = {};
	for (let round = 1; round <= maxRounds && queue.length; round++) {
		const { passed, failed } = await attempt(queue, round);
		Object.assign(accepted, passed);
		lastReasons = failed;
		queue = queue.filter((k) => !(k in accepted));
		onRound?.({ round, passed: Object.keys(passed).length, requeued: queue.length });
	}
	const rejected = {};
	for (const k of queue) rejected[k] = lastReasons[k] || ['no passing translation'];
	return { accepted, rejected };
}

// --- backoff ---------------------------------------------------------------

/**
 * Delay before retry `attempt` (0-based) of a rate-limited request: the
 * server's Retry-After when it sent one, otherwise exponential from `baseMs`
 * with full jitter, capped at `capMs`. `random` is injectable for tests.
 */
export function backoffDelay(attempt, { retryAfterSec = 0, baseMs = 2000, capMs = 60_000, random = Math.random } = {}) {
	if (retryAfterSec > 0) return Math.min(retryAfterSec * 1000, capMs * 5);
	const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
	return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

// --- resume ----------------------------------------------------------------

/**
 * Run `fn` and, when it fails with an error `isResumable` accepts (a spent
 * free-tier quota, a gateway outage), sleep `waitMs` and run it again, up to
 * `maxResumes` times. The translate pipeline persists after every chunk and
 * only ever asks for missing keys, so each resume continues where the last
 * attempt stopped instead of starting over. Anything else rethrows at once.
 */
export async function runWithResume(fn, { waitMs, maxResumes, isResumable, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onWait } = {}) {
	for (let resumes = 0; ; resumes++) {
		try {
			return await fn(resumes);
		} catch (err) {
			if (!waitMs || resumes >= maxResumes || !isResumable(err)) throw err;
			onWait?.({ resumes: resumes + 1, waitMs, err });
			await sleep(waitMs);
		}
	}
}
