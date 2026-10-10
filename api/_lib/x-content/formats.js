// What a post looks like in the feed, and the heads that can lead it.
//
// A reader scrolling the timeline sees the head post's media before a word of
// it: a clip, a looping GIF, a still, or nothing. Running the same one every
// slot reads as a bot, however good each post is. The account's own outcomes
// say stills lead (photo heads out-earned video heads on likes and bookmarks),
// and the community asks for the black cards by name, so the queue rotates the
// format the same way it rotates lane and pattern (priority.js).
//
// A proof reel stays the evidence for every post that carries a scenario. What
// changes is where it sits: an item can declare a `head` other than the reel,
// and the reel then moves to a reply, so the thread opens on a card, a GIF cut
// from the reel, or a piece of AI key art, and the clip that proves it is one
// tap down. The head is rebuilt from the reel every time the reel is filmed
// (scripts/lib/x-heads.mjs), and it records the reel it was cut from, so a
// head can never outlive the evidence it was made from.
//
//   "head": { "as": "card", "headline": "One idea\nin two lines", "body": "...", "at": 6.5 }
//   "head": { "as": "gif", "from": 2, "to": 8, "width": 640 }
//   "head": { "as": "art", "headline": "...", "prompt": "what the key art shows", "at": 4 }
//
// This module is pure: it runs in the production image, which renders nothing.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describeItem } from './outcomes.js';
import { languageProblems } from './editorial.js';
import { loadProof } from './reel.js';
import { mediaType } from './media.js';

export const FORMATS = ['video', 'gif', 'photo', 'text', 'article'];
export const HEAD_KINDS = ['reel', 'card', 'gif', 'art'];

export const HEAD_LIMITS = {
	headline: 90,
	body: 200,
	prompt: 1200,
	gifSeconds: [1, 10],
	gifWidth: [320, 1080],
};

// The format of an item as the feed shows it.
export function formatOf(item) {
	if (!item) return null;
	if (item.kind === 'article') return 'article';
	const media = describeItem(item).media;
	return media === 'none' ? 'text' : media;
}

// Ledger rows written before the format was recorded take it from the queue
// item they published, so rotation is right from the first tick after deploy.
export function withFormats(published, items) {
	const byId = new Map((items || []).map((item) => [item.id, item]));
	return (published || []).map((row) => (row.format || !byId.has(row.id) ? row : { ...row, format: formatOf(byId.get(row.id)) }));
}

// Approved stock by feed format, for `plan` and the low-variety warning.
export function formatMix(items) {
	const mix = Object.fromEntries(FORMATS.map((format) => [format, 0]));
	for (const item of items) {
		const format = formatOf(item);
		if (format in mix) mix[format]++;
	}
	return mix;
}

// Where the reel goes when the head is something else: the first reply unless
// the item says otherwise.
export function reelPostIndex(item) {
	const head = item?.head;
	if (!head || head.as === 'reel') return 0;
	return Number.isInteger(head.reelIn) ? head.reelIn : 1;
}

const numbersIn = (text) => String(text || '').match(/\d[\d,.]*\d|\d/g) || [];

// Problems with the declared head. A head built from a reel must name the
// bytes of the reel on record, so a re-filmed item cannot keep an old head.
export function headProblems(item, root) {
	const problems = headSpecProblems(item);
	const head = item.head;
	if (problems.length || !head || head.as === 'reel') return problems;
	return [...problems, ...headMediaProblems(item, root)];
}

// The head as written, before anything is built from it.
export function headSpecProblems(item) {
	const head = item.head;
	if (head === undefined) return [];
	const problems = [];
	if (!head || !HEAD_KINDS.includes(head.as)) return [`head.as must be one of ${HEAD_KINDS.join(', ')}`];
	if (item.kind !== 'post') return ['a head is only for post items; an article leads with its cover'];
	if (head.as === 'reel') return [];
	if (!item.scenario) problems.push(`a ${head.as} head is built from the item's proof reel, and the item carries no scenario`);

	const reelIndex = reelPostIndex(item);
	if (!(reelIndex >= 1 && reelIndex < (item.posts?.length || 0))) {
		problems.push(`head.as ${head.as} moves the reel to post ${reelIndex + 1}, so the item needs a reply there to carry it`);
	}
	if (['card', 'art'].includes(head.as)) {
		const headline = String(head.headline || '').trim();
		if (!headline) problems.push(`a ${head.as} head needs a headline`);
		if (headline.length > HEAD_LIMITS.headline) problems.push(`head.headline is ${headline.length} characters; keep it under ${HEAD_LIMITS.headline} so it reads in a phone timeline`);
		if (head.body && String(head.body).length > HEAD_LIMITS.body) problems.push(`head.body is ${String(head.body).length} characters; keep it under ${HEAD_LIMITS.body}`);
		// Card type is copy the reader sees, so it meets the same bar as the post,
		// and a number on it must be one the post states (and the review checks).
		for (const text of [head.headline, head.body].filter(Boolean)) {
			for (const finding of languageProblems(text)) if (finding.severity === 'blocking') problems.push(`head ${finding.rule}: ${finding.message}`);
		}
		const copy = (item.posts || []).map((post) => post.text).join('\n');
		for (const number of [...numbersIn(head.headline), ...numbersIn(head.body)]) {
			if (!copy.includes(number)) problems.push(`head states ${number}, which no post in the item says; the review only checks numbers the posts state`);
		}
	}
	if (head.as === 'art' && !String(head.prompt || '').trim()) problems.push('an art head needs a prompt that says what the key art shows');
	if (head.as === 'art' && String(head.prompt || '').length > HEAD_LIMITS.prompt) problems.push(`head.prompt is over ${HEAD_LIMITS.prompt} characters`);
	if (head.as === 'gif') {
		const [minSeconds, maxSeconds] = HEAD_LIMITS.gifSeconds;
		if (head.from !== undefined || head.to !== undefined) {
			const span = Number(head.to) - Number(head.from);
			if (!(Number(head.from) >= 0 && span >= minSeconds && span <= maxSeconds)) problems.push(`head.from and head.to must mark ${minSeconds} to ${maxSeconds} seconds of the reel`);
		}
		if (head.width !== undefined && !(head.width >= HEAD_LIMITS.gifWidth[0] && head.width <= HEAD_LIMITS.gifWidth[1])) {
			problems.push(`head.width must be ${HEAD_LIMITS.gifWidth[0]} to ${HEAD_LIMITS.gifWidth[1]} pixels`);
		}
	}

	return problems;
}

// The head on the post has to be one built for this head, from this reel.
function headMediaProblems(item, root) {
	const head = item.head;
	const problems = [];
	const media = item.posts?.[0]?.media?.[0];
	const expected = head.as === 'gif' ? 'gif' : 'image';
	if (!media?.derived) problems.push(`the head post does not carry a ${head.as} built from the reel; run \`npm run x:content -- remix ${item.id}\``);
	else {
		if (mediaType(media.path)?.kind !== expected) problems.push(`the head post carries ${media.path}, not a ${head.as}`);
		if (media.derived.as !== head.as) problems.push(`the head post carries a ${media.derived.as}, but head.as is ${head.as}; run remix again`);
		if (!existsSync(resolve(root, media.path))) problems.push(`${media.path} is missing`);
		const proof = item.scenario ? loadProof(root, item.id) : null;
		if (proof?.video?.sha256 && media.derived.reel !== proof.video.sha256) {
			problems.push(`the head was cut from an older reel; run \`npm run x:content -- remix ${item.id}\` so it shows what the latest run filmed`);
		}
	}
	return problems;
}
