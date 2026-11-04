// Copy lint for @trythreews posts. The account should read like the people who
// build three.ws wrote it, so the checks reject the tells that make a feed look
// machine-generated: launch-deck openers, hype vocabulary, hashtags, emoji,
// shouting, and a post that repeats an earlier one.

// What X turns into a t.co link: anything with a scheme, and any bare domain
// on a common TLD, with or without a path. Bare domains matter: X linked the
// brand name "three.ws" inside the first pipeline test post, which cost 23
// weighted characters and a second link the one-link rule never saw.
const TLDS = 'com|net|org|io|ai|ws|dev|app|co|xyz|gg|so|sh|fun|me|tv|us|uk|de|gl|ly|to|fm|cc|info|tech|site|online|cloud|link|news|blog';
export const URL_PATTERN = String.raw`https?:\/\/[^\s]+|(?<![@\w.-])(?:[a-z0-9-]+\.)+(?:${TLDS})\b(?:\/[^\s]*)?`;
export const urlRe = (flags = '') => new RegExp(URL_PATTERN, flags);
export const urlsIn = (value) => String(value || '').match(urlRe('gi')) || [];

export const hasUrl = (value) => urlRe('i').test(String(value || ''));

// X counts every URL as 23 characters (t.co wrapping) and each astral code
// point (emoji, some CJK) as 2.
export const weightedLength = (value) =>
	[...String(value || '').replace(urlRe('gi'), 'x'.repeat(23))].reduce(
		(total, char) => total + (char.codePointAt(0) > 0xffff ? 2 : 1),
		0,
	);

export function normalizeCopy(value) {
	return String(value || '')
		.toLowerCase()
		.replace(urlRe('gi'), ' url ')
		.replace(/\$([a-z0-9]+)/g, '$1')
		.replace(/[^a-z0-9@]+/g, ' ')
		.trim();
}

export function tokenNgrams(value, size = 3) {
	const tokens = normalizeCopy(value).split(/\s+/).filter(Boolean);
	if (tokens.length < size) return new Set(tokens.length ? [tokens.join(' ')] : []);
	const grams = new Set();
	for (let index = 0; index <= tokens.length - size; index++) {
		grams.add(tokens.slice(index, index + size).join(' '));
	}
	return grams;
}

export function jaccard(left, right) {
	if (!left.size && !right.size) return 1;
	let intersection = 0;
	for (const item of left) if (right.has(item)) intersection++;
	return intersection / (left.size + right.size - intersection);
}

export function copySimilarity(left, right) {
	return jaccard(tokenNgrams(left), tokenNgrams(right));
}

export const BANNED_OPENINGS = [
	/^introducing\b/i,
	/^we(?:'re| are) (?:excited|thrilled|proud|happy)/i,
	/^say hello to\b/i,
	/^meet the new\b/i,
	/^big news\b/i,
	/^today we(?:'re| are) launching\b/i,
	/^ever wondered\b/i,
	/^what if you could\b/i,
	/^imagine a world\b/i,
	/^a thread\b/i,
	/^thread\b/i,
];

export const BANNED_PHRASES = [
	/\bgame[- ]chang(?:er|ing)\b/i,
	/\brevolutionary\b/i,
	/\bseamless(?:ly)?\b/i,
	/\bunlock the power\b/i,
	/\bnext level\b/i,
	/\bthe future of \w+ is here\b/i,
	/\band the best part\b/i,
	/\blet that sink in\b/i,
	/\bhere'?s the kicker\b/i,
	/\bsupercharge\b/i,
	/\bdelve\b/i,
	/\bin today'?s fast[- ]paced\b/i,
	/\bbuckle up\b/i,
	/\bstay tuned\b/i,
];

// X cuts a post off at 280 weighted characters for a standard account and lets
// a Premium account write up to 25,000. @trythreews is Premium, and its head
// posts over 280 measured about twice the likes of the ones under it (140
// against 76, head posts since August 2026), so the wall is a queue setting
// (`quality.maximumLength`) and not a constant. Anything below 280 is ignored:
// a queue cannot make the limit stricter than X does.
export const STANDARD_MAX_LENGTH = 280;
export const PREMIUM_MAX_LENGTH = 25_000;
export function maxLengthOf(quality) {
	const wanted = Number(quality?.maximumLength);
	return Number.isFinite(wanted) && wanted > STANDARD_MAX_LENGTH ? Math.min(Math.floor(wanted), PREMIUM_MAX_LENGTH) : STANDARD_MAX_LENGTH;
}

// Acronyms and tickers that are legitimately written in capitals.
const ALLCAPS_TERMS = new Set(['THREE', 'HTTP', 'HTTPS', 'JSON', 'GLTF', 'HTML', 'WEBP', 'NVIDIA', 'OAUTH', 'MCP', 'GPU', 'GPUS']);

// `minimum` applies to the head of a post; replies may be short. `requireUrl`
// is false for parts whose item carries its link somewhere else (a reply, or a
// quoted Article).
export function copyProblems(text, { minimum = 100, maximum = STANDARD_MAX_LENGTH, requireUrl = true } = {}) {
	const problems = [];
	const copy = String(text || '').trim();
	const weight = weightedLength(copy);
	if (!copy) problems.push('copy is empty');
	if (weight < minimum) problems.push(`copy is ${weight} weighted characters; minimum is ${minimum}`);
	if (weight > maximum) problems.push(`copy is ${weight} weighted characters; maximum is ${maximum}`);
	if (/(^|\s)#\w/.test(copy)) problems.push('hashtags are outside the @trythreews voice');
	if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(copy)) problems.push('emoji are outside the @trythreews voice');
	if (/[\u2013\u2014]/.test(copy)) problems.push('en-dashes and em-dashes are banned');
	if (/!{2,}|(?:!.*){3,}/s.test(copy)) problems.push('stacked exclamation marks read as automated hype');
	// A capitalised word followed by an extension is a file name (SKILL.md,
	// README.md), which the copy has to spell the way the file is spelled.
	if ((copy.match(/\b[A-Z]{4,}\b(?!\.[a-z0-9]{1,5}\b)/g) || []).filter((word) => !ALLCAPS_TERMS.has(word)).length > 1) {
		problems.push('more than one all-caps word reads as shouting');
	}
	// X rejects a post carrying more than one cashtag outright (403, "Posts are
	// limited to a maximum of one cashtag"), which the publisher cannot retry
	// around, so a second $SYMBOL has to fail review instead of a publish.
	const cashtags = [...new Set(copy.match(/\$[A-Za-z][A-Za-z0-9]{0,15}\b/g) || [])];
	const cashtagCount = (copy.match(/\$[A-Za-z][A-Za-z0-9]{0,15}\b/g) || []).length;
	if (cashtagCount > 1) {
		problems.push(`${cashtagCount} cashtags (${cashtags.join(', ')}); X allows one per post, so keep the first and write the rest in plain words`);
	}
	if (requireUrl && !hasUrl(copy)) problems.push('copy must link to its evidence or product surface');
	for (const pattern of BANNED_OPENINGS) if (pattern.test(copy)) problems.push(`banned opening: ${pattern.source}`);
	for (const pattern of BANNED_PHRASES) if (pattern.test(copy)) problems.push(`banned phrase: ${pattern.source}`);
	return problems;
}
