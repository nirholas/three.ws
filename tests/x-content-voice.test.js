import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AUDIENCES, audienceOf, constructionProblems, houseTics, openerOf, postedHeads, shapeOf, ticProblems } from '../api/_lib/x-content/voice.js';
import { languageProblems } from '../api/_lib/x-content/editorial.js';
import { pollProblems, validateItem } from '../api/_lib/x-content/queue.js';
import { publishItem, previewClient } from '../api/_lib/x-content/publisher.js';
import { scoreItem } from '../api/_lib/x-content/priority.js';
import { withFormats } from '../api/_lib/x-content/formats.js';

const rules = (text) => constructionProblems(text).map((finding) => finding.message);

describe('machine-written constructions', () => {
	it.each([
		['It is not an image. It is a live avatar you can talk to.', /contrast reframe/],
		['This is not just a viewer, but a full studio.', /not just X, but Y/],
		['No sign-up. No key. Paste a prompt.', /negation stack/],
		['Runs with no plugin, no video, no server.', /three-part negation/],
		["Here's how it works: one script tag.", /here's how/],
		['The result: a rigged avatar.', /teaser colon/],
		['Turns out a GLB is enough.', /reveal phrasing/],
		['Paste a prompt, get a model. That is the whole thing.', /summarising closer/],
		['In one word: fast.', /in one word/],
		['Ship 3D without the hassle.', /friction cliche/],
		["Whether you're a teacher or a founder, it fits.", /audience sweep/],
	])('flags %j', (text, rule) => {
		expect(rules(text).join('\n')).toMatch(rule);
	});

	it('leaves plain, specific copy alone', () => {
		expect(rules('Describe a jacket in a sentence and the wardrobe fits it to your avatar in about 40 seconds. three.ws/wardrobe')).toEqual([]);
		expect(rules('Parts Studio splits a mesh into 24 named parts from the geometry alone.')).toEqual([]);
	});

	it('ignores the words inside a link', () => {
		expect(rules('Open three.ws/no-key-no-account-no-server and try it')).toEqual([]);
	});

	it('runs as part of the language lint every post already passes through', () => {
		expect(languageProblems('No sign-up. No key. Just paste.').some((finding) => finding.rule === 'voice' && finding.severity === 'blocking')).toBe(true);
	});
});

describe('house tics', () => {
	const posted = [
		'Labs: a bouncing cube with no model file behind it, built in shaders. three.ws/labs/cube',
		'A water surface with no model file behind it, every wave from math. three.ws/labs/water',
		'Describe a jacket and the wardrobe fits it. three.ws/wardrobe',
	];

	it('finds a phrase the account has posted twice', () => {
		expect(houseTics(posted).has('no model file behind')).toBe(true);
	});

	it('blocks a new post that reuses it, and lets fresh copy through', () => {
		const tics = houseTics(posted);
		expect(ticProblems('A fire effect with no model file behind it. three.ws/labs/fire', tics)[0].severity).toBe('blocking');
		expect(ticProblems('Fire drawn in a fragment shader, 60 lines of GLSL. three.ws/labs/fire', tics)).toEqual([]);
	});

	it('never treats grammar or the brand as a tic', () => {
		const tics = houseTics(['On three.ws you can do it in one go.', 'On three.ws you can do it in one go, again.']);
		expect([...tics].filter((gram) => /^(on three ws you|three ws you can)/.test(gram))).toEqual([]);
	});

	it('reads only posted heads, oldest first', () => {
		const items = [
			{ status: 'posted', kind: 'post', publishedAt: '2026-11-02T12:00:00Z', posts: [{ text: 'second' }] },
			{ status: 'approved', kind: 'post', posts: [{ text: 'not yet' }] },
			{ status: 'posted', kind: 'post', publishedAt: '2026-11-01T12:00:00Z', posts: [{ text: 'first' }] },
		];
		expect(postedHeads(items)).toEqual(['first', 'second']);
	});
});

describe('shape', () => {
	it('names the opener a reader sees first', () => {
		expect(openerOf('"It just works," a teacher wrote.')).toBe('quote');
		expect(openerOf('24 parts from one mesh.')).toBe('number');
		expect(openerOf('We shipped Parts Studio.')).toBe('first-person');
		expect(openerOf('Paste a prompt and get a model.')).toBe('imperative');
		expect(openerOf('npx three-ws create')).toBe('code');
		expect(openerOf('What if your avatar could talk? Now it can.')).toBe('question');
		expect(openerOf('Parts Studio is live.')).toBe('statement');
	});

	it('tells a short single from a long thread', () => {
		const short = { kind: 'post', posts: [{ text: 'Parts Studio is live. three.ws/segment' }] };
		const long = { kind: 'post', posts: [{ text: `${'Parts Studio splits a mesh into named parts. '.repeat(5)}\n\nThen export them.` }, { text: 'reply' }] };
		expect(shapeOf(short)).toBe('statement/short/one-block/single');
		expect(shapeOf(long)).toBe('statement/medium/paragraphs/thread');
		expect(shapeOf({ kind: 'article' })).toBe('article');
	});
});

describe('audience', () => {
	it('comes from the item when set, and from the lane otherwise', () => {
		expect(audienceOf({ lane: 'developer' })).toBe('developer');
		expect(audienceOf({ lane: 'developer', audience: 'educator' })).toBe('educator');
		expect(audienceOf({ lane: 'tutorial' })).toBe('student');
		expect(audienceOf({ lane: 'unknown-lane' })).toBe('community');
		expect(AUDIENCES).toContain('founder');
	});

	it('fills ledger rows written before audience and shape were recorded', () => {
		const item = { id: 'a', kind: 'post', lane: 'partner', posts: [{ text: 'We partner with AWS.' }] };
		const [row] = withFormats([{ id: 'a', publishedAt: '2026-11-01T00:00:00Z' }], [item]);
		expect(row.audience).toBe('founder');
		expect(row.shape).toBe('first-person/short/one-block/single');
	});
});

describe('rotation', () => {
	const item = { id: 'next', kind: 'post', lane: 'developer', pattern: 'mechanism', posts: [{ text: 'Parts Studio is live. three.ws/segment' }] };
	const quality = { maximumSameAudienceInARow: 1, maximumSameShapeInARow: 1 };

	it('marks down a post for the same reader as the last one', () => {
		const published = [{ id: 'p', publishedAt: '2026-11-01T00:00:00Z', audience: 'developer', shape: 'number/long/paragraphs/thread' }];
		const { parts } = scoreItem(item, { published, quality });
		expect(parts.audience).toBe(-20);
		expect(parts.shape).toBeUndefined();
	});

	it('marks down a post shaped like the last one', () => {
		const published = [{ id: 'p', publishedAt: '2026-11-01T00:00:00Z', audience: 'creator', shape: 'statement/short/one-block/single' }];
		const { parts } = scoreItem(item, { published, quality });
		expect(parts.shape).toBe(-20);
		expect(parts.audience).toBeUndefined();
	});
});

describe('native polls', () => {
	const poll = { options: ['Developer', 'Teacher', 'Student', 'Founder'], durationMinutes: 1440 };

	it('accepts a poll inside X limits', () => {
		expect(pollProblems({ text: 'Who are you building for?', poll })).toEqual([]);
	});

	it.each([
		[{ options: ['Only one'], durationMinutes: 60 }, /2 to 4 options/],
		[{ options: ['a', 'b', 'c', 'd', 'e'], durationMinutes: 60 }, /2 to 4 options/],
		[{ options: ['A very long option that runs past the limit', 'b'], durationMinutes: 60 }, /over 25 characters/],
		[{ options: ['Yes', 'yes'], durationMinutes: 60 }, /repeat/],
		[{ options: ['a', 'b'], durationMinutes: 2 }, /5 to 10080/],
		[{ options: ['a', 'b'], durationMinutes: 20_000 }, /5 to 10080/],
	])('rejects %j', (bad, rule) => {
		expect(pollProblems({ text: 'q', poll: bad }).join('\n')).toMatch(rule);
	});

	it('rejects a poll beside media, which X refuses', () => {
		expect(pollProblems({ text: 'q', poll, media: [{ path: 'a.png' }] }).join('\n')).toMatch(/poll or media/);
	});

	it('counts a poll as the head attachment and checks it through the item', () => {
		const root = mkdtempSync(join(tmpdir(), 'x-poll-'));
		mkdirSync(join(root, 'data/x-content'), { recursive: true });
		writeFileSync(join(root, 'data/x-content/queue.json'), JSON.stringify({ quality: {}, items: [] }));
		const base = { id: 'poll', status: 'review', kind: 'post', tier: 2, lane: 'community', pattern: 'question', notBefore: '2026-11-15T00:00:00Z', claims: [], mentions: {} };
		const good = validateItem({ ...base, posts: [{ text: 'Which do you reach for first when you build in 3D? Vote and tell us why in the replies.', poll }] }, root, { quality: {} });
		expect(good.join('\n')).not.toMatch(/head post has no media/);
		expect(good.join('\n')).not.toMatch(/poll/);
		const bad = validateItem({ ...base, posts: [{ text: 'Which do you reach for first when you build in 3D? Vote and tell us why in the replies.', poll: { options: ['one'], durationMinutes: 60 } }] }, root, { quality: {} });
		expect(bad.join('\n')).toMatch(/head: a poll needs 2 to 4 options/);
		expect(good.join('\n')).not.toMatch(/rhetorical-question/);
		const badAudience = validateItem({ ...base, audience: 'investor', posts: [{ text: 'q', poll }] }, root, { quality: {} });
		expect(badAudience.join('\n')).toMatch(/audience must be one of/);
	});

	it('sends the poll to X in the v2 shape', async () => {
		const client = previewClient();
		const state = {};
		const item = { id: 'poll', kind: 'post', lane: 'community', pattern: 'question', posts: [{ text: ' Who are you building for? ', poll }] };
		const row = await publishItem({ item, client, root: process.cwd(), state, store: { save: async () => {} } });
		const call = client.calls.find((entry) => entry.call === 'tweets.create');
		expect(call.poll).toEqual({ options: poll.options, duration_minutes: 1440 });
		expect(call.media).toBeUndefined();
		expect(row.audience).toBe('community');
		expect(row.shape).toBe('question/short/one-block/single');
	});
});
