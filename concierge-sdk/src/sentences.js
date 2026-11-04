/**
 * Split streamed text into complete sentences for the voice channel.
 *
 * A period only ends a sentence when whitespace follows it, so a URL such as
 * https://three.ws/x is never cut at its dots, including when a chunk boundary
 * lands right after one ("https://three." then "ws/x"). Newlines always end a
 * sentence. Text after the last terminator is returned as `rest`.
 */
export function drainSentences(buffer) {
	const sentences = [];
	const re = /[^\n]*?(?:[.!?]+["')\]]?(?=\s)|\n)\s*/g;
	let consumed = 0;
	let m;
	while ((m = re.exec(buffer)) !== null) {
		const s = m[0].trim();
		if (s) sentences.push(s);
		consumed = re.lastIndex;
		if (m[0] === '') re.lastIndex++;
	}
	return { sentences, rest: buffer.slice(consumed) };
}
