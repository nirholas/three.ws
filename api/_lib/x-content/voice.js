// The tells that make a feed read as machine-written, beyond the vocabulary
// quality.js and editorial.js already ban.
//
// The account's own feed (owner, 2026-11-15: "people could tell they're AI
// generated posts and they all looked the same") showed three kinds:
//
//   constructions   sentence shapes a language model reaches for: the contrast
//                   reframe ("It is not an image. It is a ..."), the negation
//                   stack ("No sign-up. No key."), the teaser colon ("The
//                   result:"), the closer that summarises ("That is the whole
//                   thing")
//   house tics      phrases this account itself has worn out. Each one was fine
//                   once; "a Labs experiment" and "no model file behind it" in
//                   post after post is what a reader recognises. They are found
//                   from the posted copy, not from a list, so a new tic is caught
//                   the second time it ships
//   one shape       every head the same length with the same two-paragraph
//                   layout and the same kind of opener. shapeOf() describes a head
//                   so the ranking (priority.js) can refuse to run one shape twice
//
// Pure and offline: it runs in the CLI and in the production cron alike.

import { urlRe } from './quality.js';

// Each entry: [pattern, what the reader hears, severity].
export const AI_CONSTRUCTIONS = [
	[/\b(?:is|are|was|were)(?:n['’]t| not) (?:just |only |simply |merely )?(?:a|an|the|another|your)\b[^.!?\n]{0,80}[.!?;,]\s*(?:It|They|This|That)(?:['’]s| is| are| was)\b/i, 'contrast reframe ("it is not X. It is Y"); say what it is', 'blocking'],
	[/\bnot (?:just|only|merely) (?:a|an|the)?\s?[\w-]+(?: [\w-]+){0,4},? (?:but|it['’]s|it is)\b/i, '"not just X, but Y" reframe; say what it is', 'blocking'],
	[/(?:^|[.!?]\s+)No [\w-]+(?: [\w-]+){0,3}\.\s+No [\w-]+/, 'negation stack ("No X. No Y."); name what it does instead', 'blocking'],
	[/\bno [\w-]+(?: [\w-]+)?, no [\w-]+(?: [\w-]+)?,? (?:and |or )?no [\w-]+/i, 'three-part negation list; name what it does instead', 'blocking'],
	[/\bhere['’]s (?:the thing|the kicker|the catch|how|what|why|where)\b/i, '"here\'s how/what/why" teaser', 'blocking'],
	[/\b(?:the (?:result|catch|twist|secret|trick|answer|best part|kicker|magic))\s*[?:]/i, 'teaser colon; state the result in the sentence', 'blocking'],
	[/\b(?:turns out|plot twist|spoiler|the twist is|guess what)\b/i, 'reveal phrasing', 'blocking'],
	[/\b(?:that['’]s|that is) (?:it|all|the whole (?:\w+ ?){1,3})\.?\s*$/i, 'summarising closer ("that is the whole thing")', 'blocking'],
	[/(?:^|\n)\s*(?:that is|that['’]s) the whole\b/i, 'summarising closer ("that is the whole thing")', 'blocking'],
	[/\b(?:in (?:a|one) (?:word|sentence))\s*[:,]/i, '"in one word:" set-up', 'blocking'],
	[/\bwithout (?:the|any) (?:hassle|headache|friction|complexity|fuss)\b/i, 'friction cliche; name the step that is gone', 'major'],
	[/\b(?:simple|fast|free|open),\s+(?:simple|fast|free|open|easy),?\s+(?:and\s+)?(?:simple|fast|free|open|easy)\b/i, 'adjective triplet', 'major'],
	[/\b(?:whether you['’]re|from \w+ to \w+, )/i, '"whether you\'re a X or a Y" audience sweep', 'major'],
];

export function constructionProblems(text) {
	const prose = String(text || '').replace(urlRe('gi'), ' ');
	const found = [];
	for (const [pattern, message, severity] of AI_CONSTRUCTIONS) {
		const hit = prose.match(pattern)?.[0];
		if (hit) found.push({ rule: 'voice', severity, message: `${message}: "${hit.trim().slice(0, 60)}"` });
	}
	return found;
}

// --- house tics -------------------------------------------------------------

// Words that carry no voice on their own. A 4-gram made only of these and the
// brand is not a tic: "on three.ws you can" is grammar.
const GLUE = new Set(
	'a an the and or but of to in on at by for with from into onto it its it is is are was be this that these those your you we our they their them one two each any as so if then than not no nothing when what which who how three ws three.ws url there here can do does did has have had will would'.split(' '),
);

const words = (text) =>
	String(text || '')
		.toLowerCase()
		.replace(urlRe('gi'), ' url ')
		.replace(/[^a-z0-9$'’ ]+/g, ' ')
		.split(/\s+/)
		.filter(Boolean);

function grams(text, size) {
	const list = words(text);
	const out = new Set();
	for (let index = 0; index + size <= list.length; index++) {
		const gram = list.slice(index, index + size);
		if (gram.every((word) => GLUE.has(word) || /^\d+$/.test(word))) continue;
		// A gram must carry at least two content words to be a phrase a reader remembers.
		if (gram.filter((word) => !GLUE.has(word)).length < 2) continue;
		out.add(gram.join(' '));
	}
	return out;
}

// Phrases that appear in at least `minPosts` of the given posts. `posts` is
// the posted copy, newest last; only the last `recent` are read, because a
// phrase retired months ago is not one the reader still hears.
export function houseTics(posts, { size = 4, minPosts = 2, recent = 40 } = {}) {
	const counts = new Map();
	for (const text of posts.slice(-recent)) {
		for (const gram of grams(text, size)) counts.set(gram, (counts.get(gram) || 0) + 1);
	}
	return new Set([...counts].filter(([, count]) => count >= minPosts).map(([gram]) => gram));
}

export function ticProblems(text, tics) {
	if (!tics?.size) return [];
	const hits = [...grams(text, 4)].filter((gram) => tics.has(gram));
	return hits.length ? [{ rule: 'voice', severity: 'blocking', message: `reuses phrasing the account has already posted more than once: "${hits.slice(0, 3).join('", "')}"; write it fresh` }] : [];
}

// --- shape ------------------------------------------------------------------

export const LENGTH_SHAPES = [
	{ key: 'short', max: 140 },
	{ key: 'medium', max: 320 },
	{ key: 'long', max: 700 },
	{ key: 'longform', max: Infinity },
];

// How a head opens, as a reader sees the first words.
export function openerOf(text) {
	const first = String(text || '').trim().split(/\n/)[0];
	if (/^["“]/.test(first)) return 'quote';
	if (/^[$]?\d/.test(first)) return 'number';
	if (/^(?:I|I['’]m|I['’]ve|We|We['’]ve|We['’]re|Our)\b/.test(first)) return 'first-person';
	if (/^(?:Open|Paste|Drop|Pick|Type|Load|Put|Send|Try|Run|Install|Add|Ask|Upload|Copy|Point|Hand|Give|Make|Build|Turn)\b/.test(first)) return 'imperative';
	if (/^(?:const|import|npx|npm|curl|<|\$ )/.test(first) || /^```/.test(first)) return 'code';
	if (/\?$/.test(first.split(/(?<=[.!?])\s/)[0] || '')) return 'question';
	return 'statement';
}

export function shapeOf(item) {
	if (!item) return null;
	if (item.kind === 'article') return 'article';
	const text = String(item.posts?.[0]?.text || '');
	const length = [...text.replace(urlRe('gi'), 'x'.repeat(23))].length;
	const bucket = LENGTH_SHAPES.find((row) => length <= row.max).key;
	const paragraphs = text.split(/\n\s*\n/).filter((part) => part.trim()).length;
	const thread = (item.posts?.length || 0) > 1 ? 'thread' : 'single';
	return `${openerOf(text)}/${bucket}/${paragraphs > 1 ? 'paragraphs' : 'one-block'}/${thread}`;
}

// --- audience ---------------------------------------------------------------

// Who a post is written for (owner, 2026-11-15: "things for developers,
// teachers, students, founders"). The lane says what a post is about; the
// audience says who it talks to, and the ranking rotates it so the feed is not
// one reader's feed. An item may set `audience`; otherwise its lane implies one.
export const AUDIENCES = ['developer', 'educator', 'student', 'founder', 'creator', 'community'];

const LANE_AUDIENCE = {
	developer: 'developer',
	mcp: 'developer',
	article: 'developer',
	tutorial: 'student',
	creation: 'creator',
	library: 'creator',
	animation: 'creator',
	ar: 'creator',
	labs: 'creator',
	world: 'creator',
	token: 'community',
	community: 'community',
	partner: 'founder',
};

export function audienceOf(item) {
	if (!item) return null;
	if (AUDIENCES.includes(item.audience)) return item.audience;
	return LANE_AUDIENCE[item.lane] || 'community';
}

// What an editor and a drafter are told about each reader, so a post for a
// teacher is written as one and not as a developer post with a new label.
export const AUDIENCE_BRIEFS = {
	developer: 'a working developer: wants the call, the snippet, the limit, and what breaks; code beats adjectives',
	educator: 'a teacher or lecturer: wants something a class can use tomorrow, free, in a browser, with no accounts for students',
	student: 'a student or self-taught learner: wants to make something real today and understand how it works',
	founder: 'a founder or product lead: wants what it saves, what it costs, and how fast a team can ship it',
	creator: 'an artist, animator, or 3D hobbyist: wants to see the result first and the tool second',
	community: 'a $THREE holder or community member: wants what shipped, what it means for the platform, and proof it is live',
};

// The heads that went out, newest last, read from posted queue items (the
// copy that shipped, in the order it shipped).
export function postedHeads(items) {
	return (items || [])
		.filter((item) => item.status === 'posted' && item.kind === 'post')
		.map((item) => ({ at: Date.parse(item.publishedAt || item.postedAt || item.notBefore) || 0, text: String(item.posts?.[0]?.text || '') }))
		.sort((a, b) => a.at - b.at)
		.map((row) => row.text)
		.filter(Boolean);
}
