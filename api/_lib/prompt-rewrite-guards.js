// Guards for an LLM rewrite of a user's prompt (the Forge art director and the
// Enhance button). A rewrite is only worth forwarding when it is still about
// what the user asked for and is not the model declining to answer. Either
// failure is worse than no rewrite at all: the user's own words are always a
// valid prompt, so every guard here errs toward rejecting.
//
// Pure functions, no I/O. Shared by api/_mcp-studio/forge-client.js (and its
// gpt-forge clone, which re-exports from it) and api/forge-enhance.js.

// A reply that opens by declining, apologising or talking about itself is a
// refusal or a chat answer, never a prompt. Checked at the start, where every
// refusal observed from the chain begins.
const REFUSAL_OPENING =
	/^(?:i['’]?m\s+sorry|sorry\b|i\s+apologi[sz]e|unfortunately\b|as\s+an\s+ai\b|i\s+(?:can\s*not|cannot|can['’]?t|won['’]?t|will\s+not|am\s+(?:unable|not\s+able)|['’]?m\s+(?:unable|not\s+able)|do\s+not|don['’]?t)\b)/i;

// The same refusal tucked behind a preamble ("Here is the thing: I cannot help
// with that request."). Narrow on purpose: the verb has to be about helping,
// fulfilling or producing the request, so a brief that happens to say "cannot
// be seen" is not caught.
const REFUSAL_PHRASE =
	/\b(?:i\s+(?:can\s*not|cannot|can['’]?t|won['’]?t|will\s+not|am\s+unable\s+to|am\s+not\s+able\s+to)\s+(?:help|assist|comply|create|generate|produce|provide|fulfil+|write|do\s+that|make\s+that)|as\s+an\s+ai(?:\s+language)?\s+model|against\s+(?:my|our)\s+(?:content\s+)?polic(?:y|ies)|violates?\s+(?:my|our|the)\s+(?:content\s+|usage\s+)?polic(?:y|ies))\b/i;

/** True when the reply is the model declining or apologising instead of rewriting. */
export function isRefusal(text) {
	const t = String(text ?? '').trim().replace(/^["'“‘]+/, '');
	if (!t) return false;
	return REFUSAL_OPENING.test(t) || REFUSAL_PHRASE.test(t);
}

// Words that carry no subject. A prompt made only of these ("a big one") gives
// the on-topic check nothing to hold on to, so it is skipped rather than
// guessed at.
const STOPWORDS = new Set(
	(
		'the and for with from into onto that this these those its his her their our your you are was were ' +
		'has have had not but all any some one two three very more most much many such than then too also ' +
		'just like make made model models render rendering create generate show give want need please ' +
		'small big large tiny huge little giant old new nice cool good best real realistic photoreal ' +
		'photorealistic style styled detailed high quality object thing item asset version kind type ' +
		'what which who whom whose where when why how about over under above below between'
	).split(' '),
);

// Reduce a word to a prefix that survives plurals and common suffixes, so
// "puppies" still finds "puppy" and "carved" finds "carving".
function stem(word) {
	let w = word;
	for (const suffix of ['ies', 'ing', 'es', 'ed', 's']) {
		if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
			w = w.slice(0, -suffix.length);
			break;
		}
	}
	return w;
}

/** The subject-bearing words of a prompt, lowercased and stemmed. */
export function contentStems(text) {
	const words = String(text ?? '')
		.toLowerCase()
		.split(/[^a-z]+/)
		.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
	return [...new Set(words.map(stem))];
}

/**
 * True when a rewrite no longer mentions anything the user asked for: none of
 * the prompt's subject words (stemmed) appears in it. The director is told to
 * keep the user's subject, so a rewrite that drops every one of their words
 * has wandered off (a canned example, an answer to a different request).
 *
 * Only judged when it can be judged fairly: a prompt written outside the Latin
 * alphabet (the director may legitimately translate it) or with no subject
 * words at all is never called off-topic.
 */
export function isOffTopic(rewrite, rawPrompt) {
	const raw = String(rawPrompt ?? '');
	// Letters outside basic Latin (accents, CJK, Cyrillic, Arabic): a faithful
	// rewrite may be an English translation sharing no word with the original.
	if (/[^\x00-\x7f]/.test(raw)) return false;
	const stems = contentStems(raw);
	if (!stems.length) return false;
	const hay = String(rewrite ?? '').toLowerCase();
	return !stems.some((s) => new RegExp(`\\b${s}`).test(hay));
}
