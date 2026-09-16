const URL_RE = /(?:https?:\/\/|\b(?:www\.)?three\.ws\/)[^\s]+/gi;

export const weightedLength = (value) =>
	[...String(value || '').replace(URL_RE, 'x'.repeat(23))].reduce(
		(total, char) => total + (char.codePointAt(0) > 0xffff ? 2 : 1),
		0,
	);

export function normalizeCopy(value) {
	return String(value || '')
		.toLowerCase()
		.replace(URL_RE, ' url ')
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
];

export function copyProblems(text, { minimum = 100, maximum = 280 } = {}) {
	const problems = [];
	const copy = String(text || '').trim();
	const weight = weightedLength(copy);
	if (!copy) problems.push('copy is empty');
	if (weight < minimum) problems.push(`copy is ${weight} weighted characters; minimum is ${minimum}`);
	if (weight > maximum) problems.push(`copy is ${weight} weighted characters; maximum is ${maximum}`);
	if (/#\w/.test(copy)) problems.push('hashtags are outside the @trythreews voice');
	if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(copy)) problems.push('emoji are outside the @trythreews voice');
	if (/[\u2013\u2014]/.test(copy)) problems.push('en-dashes and em-dashes are banned');
	if (!URL_RE.test(copy)) problems.push('copy must link to its evidence or product surface');
	URL_RE.lastIndex = 0;
	for (const pattern of BANNED_OPENINGS) if (pattern.test(copy)) problems.push(`banned opening: ${pattern.source}`);
	for (const pattern of BANNED_PHRASES) if (pattern.test(copy)) problems.push(`banned phrase: ${pattern.source}`);
	return problems;
}

