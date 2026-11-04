// Suggested replies for lens-sized clients (the /glass Meta Ray-Ban Display app).
//
// A four-key d-pad cannot type, so the wearer needs two or three short options
// to pick from after each agent turn. They come from the SAME completion as the
// reply, never a second model call: the system prompt asks the model to finish
// its answer with a marker line followed by the options, the streaming layer
// withholds that marker line from the chunks it forwards, and the done event
// carries the parsed options as a structured field.
//
// Opt-in per request (`suggestReplies`, an integer 0 to 3) so every other chat
// surface keeps byte-identical prompts, replies and prompt-cache prefixes.

export const SUGGEST_MARKER = '<<replies>>';
export const SUGGEST_MAX = 3;
export const SUGGEST_MAX_CHARS = 28;

/** Prompt suffix asking for `count` options after the reply, or '' for none. */
export function suggestionsInstruction(count) {
	const n = Math.min(SUGGEST_MAX, Math.max(0, Math.trunc(Number(count) || 0)));
	if (!n) return '';
	return [
		'The person is wearing smart glasses and answers with a four-way d-pad, so they cannot type.',
		`After your reply, add one final line that starts with ${SUGGEST_MARKER} followed by exactly ${n} short options they could say next, separated by " | ".`,
		`Each option is at most ${SUGGEST_MAX_CHARS} characters, written in the first person, with no numbering, no quotes and no trailing punctuation.`,
		'Never mention this line and never put it anywhere except the very end.',
	].join(' ');
}

function cleanOption(raw) {
	return String(raw)
		.replace(/^[\s"'`*\-\d.)]+/, '')
		.replace(/["'`*]+\s*$/, '')
		.replace(/[.!]+$/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, SUGGEST_MAX_CHARS)
		.trim();
}

/**
 * Split a finished completion into the spoken reply and the parsed options.
 * A completion without the marker (the model ignored the instruction) returns
 * the reply untouched and an empty list, so the client falls back to its own set.
 */
export function splitSuggestions(text, count = SUGGEST_MAX) {
	const raw = String(text ?? '');
	const at = raw.indexOf(SUGGEST_MARKER);
	if (at < 0) return { reply: raw, suggestions: [] };
	const limit = Math.min(SUGGEST_MAX, Math.max(0, Math.trunc(Number(count) || 0)));
	const seen = new Set();
	const suggestions = [];
	for (const part of raw.slice(at + SUGGEST_MARKER.length).split(/\s*\|\s*|\n/)) {
		const option = cleanOption(part);
		const key = option.toLowerCase();
		if (!option || seen.has(key)) continue;
		seen.add(key);
		suggestions.push(option);
		if (suggestions.length >= limit) break;
	}
	return { reply: raw.slice(0, at).trimEnd(), suggestions };
}

/**
 * Stateful filter for streamed text chunks. Forwards everything before the
 * marker, withholds the marker line, and holds back a trailing fragment that
 * could still turn into the marker so a half-seen "<<repl" never reaches the
 * client. `flush()` releases a held fragment once the stream ends without the
 * marker completing.
 */
export function createReplyFilter() {
	let pending = '';
	let sealed = false;
	return {
		push(chunk) {
			if (sealed) return '';
			pending += String(chunk ?? '');
			const at = pending.indexOf(SUGGEST_MARKER);
			if (at >= 0) {
				const out = pending.slice(0, at);
				pending = '';
				sealed = true;
				return out;
			}
			let hold = 0;
			for (let k = Math.min(pending.length, SUGGEST_MARKER.length - 1); k > 0; k--) {
				if (SUGGEST_MARKER.startsWith(pending.slice(pending.length - k))) {
					hold = k;
					break;
				}
			}
			const out = pending.slice(0, pending.length - hold);
			pending = pending.slice(pending.length - hold);
			return out;
		},
		flush() {
			if (sealed) return '';
			const out = pending;
			pending = '';
			return out;
		},
	};
}
