import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	HALF_LIFE_DAYS,
	LEARNED_MIN_SAMPLE,
	LEARNED_POINTS_LIMIT,
	MIN_AGE_HOURS,
	OUTCOMES_REFRESH_HOURS,
	SHRINK_K,
	attributeKeys,
	collectOutcomes,
	describeItem,
	describePost,
	isHeadPost,
	learnLifts,
	learnedScore,
	memoryOutcomesStore,
	outcomeOf,
	outcomesAreStale,
	readDaysFor,
	OUTCOMES_SETTLE_DAYS,
	OUTCOMES_WINDOW_DAYS,
} from '../api/_lib/x-content/outcomes.js';
import { loadLifts, scoreItem } from '../api/_lib/x-content/priority.js';
import { runTick } from '../api/_lib/x-content/runner.js';
import { memoryStore } from '../api/_lib/x-content/state.js';
import { previewClient } from '../api/_lib/x-content/publisher.js';
import { contentHash, reviewPath } from '../api/_lib/x-content/review.js';

const root = process.cwd();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-17T16:50:00Z');

const metrics = (likes = 0, over = {}) => ({ like_count: likes, retweet_count: 0, quote_count: 0, reply_count: 0, bookmark_count: 0, impression_count: 0, ...over });
const tweet = (id, text, over = {}) => ({ id, text, created_at: '2026-09-01T12:00:00.000Z', conversation_id: id, public_metrics: metrics(), ...over });
const daysAgo = (days) => new Date(NOW - days * DAY).toISOString();
const row = (over = {}) => ({ id: '1', at: daysAgo(10), impressions: 0, likes: 0, reposts: 0, replies: 0, bookmarks: 0, media: 'none', length: 'band', link: 'none', thread: false, mentions: 0, cashtag: false, source: 'hand', ...over });

describe('describePost', () => {
	it('reads the whole copy of a long post from note_tweet', () => {
		const full = `${'A long build note about the rig pipeline. '.repeat(8)}https://t.co/full`;
		const post = tweet('10', `${full.slice(0, 270)}...`, {
			note_tweet: { text: full, entities: { urls: [{ url: 'https://t.co/full', expanded_url: 'https://three.ws/rig-doctor' }] } },
		});
		const described = describePost(post);
		expect(described.length).toBe('long');
		expect(described.link).toBe('head');
	});

	it('sorts a post into the length bucket its weighted length falls in', () => {
		const linked = (words) => tweet('11', `${'x'.repeat(words)} https://t.co/a`, { entities: { urls: [{ url: 'https://t.co/a', expanded_url: 'https://github.com/nirholas/three.ws' }] } });
		// Every URL weighs 23, whatever its real length.
		expect(describePost(linked(75)).length).toBe('short');
		expect(describePost(linked(76)).length).toBe('band');
		expect(describePost(linked(155)).length).toBe('band');
		expect(describePost(linked(156)).length).toBe('standard');
		expect(describePost(linked(256)).length).toBe('standard');
		expect(describePost(linked(257)).length).toBe('long');
		expect(describePost(tweet('12', 'Tom &amp; Jerry')).length).toBe('short');
	});

	it('names the media kind, and lets a video outrank a still', () => {
		const mediaByKey = new Map([
			['7_1', { media_key: '7_1', type: 'video' }],
			['3_1', { media_key: '3_1', type: 'photo' }],
			['16_1', { media_key: '16_1', type: 'animated_gif' }],
		]);
		const kind = (keys) => describePost(tweet('20', 'A clip', { attachments: { media_keys: keys } }), { mediaByKey }).media;
		expect(kind(['7_1'])).toBe('video');
		expect(kind(['3_1'])).toBe('photo');
		expect(kind(['16_1'])).toBe('gif');
		expect(kind(['3_1', '7_1'])).toBe('video');
		expect(describePost(tweet('21', 'Words only')).media).toBe('none');
	});

	it('does not count the link X adds for media or for a quoted post', () => {
		const copy = 'x'.repeat(95);
		const media = tweet('30', `${copy} https://t.co/media`, {
			attachments: { media_keys: ['7_1'] },
			entities: { urls: [{ url: 'https://t.co/media', expanded_url: 'https://x.com/trythreews/status/30/video/1', media_key: '7_1' }] },
		});
		const described = describePost(media, { mediaByKey: new Map([['7_1', { type: 'video' }]]) });
		expect(described.link).toBe('none');
		// 95 characters of copy: the media link is not part of what was written.
		expect(described.length).toBe('short');

		const quote = tweet('31', 'The detail the first post left out https://t.co/quote', {
			referenced_tweets: [{ type: 'quoted', id: '9' }],
			entities: { urls: [{ url: 'https://t.co/quote', expanded_url: 'https://twitter.com/trythreews/status/9' }] },
		});
		expect(isHeadPost(quote)).toBe(true);
		expect(describePost(quote).link).toBe('none');
	});

	it('describes an Article by its title and cover, not by the bare link X returns for it', () => {
		const article = tweet('35', 'https://t.co/art', {
			entities: { urls: [{ url: 'https://t.co/art', expanded_url: 'https://x.com/i/article/2101755492414656512' }] },
			article: { title: 'Hold, do not spend: how $THREE gates the expensive lanes', cover_media: '3_35' },
		});
		expect(describePost(article)).toMatchObject({ media: 'photo', length: 'short', link: 'none', cashtag: true, mentions: 0 });
	});

	it('counts a three.ws link and an outside link the same way', () => {
		const linked = (expanded) => describePost(tweet('40', 'Read it https://t.co/a', { entities: { urls: [{ url: 'https://t.co/a', expanded_url: expanded }] } })).link;
		expect(linked('https://three.ws/genesis')).toBe('head');
		expect(linked('https://builder.aws.com/content/x')).toBe('head');
	});

	it('marks a head that the account answered itself as a thread', () => {
		const head = tweet('50', 'Part one');
		expect(describePost(head, { threadSizes: new Map([['50', 2]]) }).thread).toBe(true);
		expect(describePost(head, { threadSizes: new Map([['51', 2]]) }).thread).toBe(false);
	});

	it('counts mentions, spots the cashtag, and carries the metrics over', () => {
		const described = describePost(
			tweet('60', 'Now on @awscloud with @nvidia: the $three layer, mail me@three.ws', {
				public_metrics: metrics(40, { retweet_count: 5, quote_count: 2, reply_count: 9, bookmark_count: 11, impression_count: 9000 }),
			}),
		);
		expect(described).toMatchObject({ id: '60', at: '2026-09-01T12:00:00.000Z', mentions: 2, cashtag: true, likes: 40, reposts: 7, replies: 9, bookmarks: 11, impressions: 9000 });
		expect(describePost(tweet('61', 'It costs $3 and $THREEFOLD is not us')).cashtag).toBe(false);
	});

	it('takes lane and pattern from the publish ledger, and only from there', () => {
		const pipelineById = new Map([['70', { id: 'genesis', lane: 'creation', pattern: 'proof' }]]);
		expect(describePost(tweet('70', 'Sent by the queue'), { pipelineById })).toMatchObject({ source: 'pipeline', lane: 'creation', pattern: 'proof' });
		const hand = describePost(tweet('71', 'Sent by hand'), { pipelineById });
		expect(hand.source).toBe('hand');
		expect(hand).not.toHaveProperty('lane');
		expect(hand).not.toHaveProperty('pattern');
		expect(attributeKeys(hand).some((key) => key.startsWith('lane:'))).toBe(false);
	});
});

describe('collectOutcomes', () => {
	// Two pages, served the way the twitter-api-v2 paginator serves them: the
	// second page and its media only exist once the iterator has asked for them.
	function timelineClient(pages) {
		const calls = [];
		return {
			calls,
			async me() {
				return { data: { id: '42', username: 'trythreews' } };
			},
			async userTimeline(id, options) {
				calls.push({ id, options });
				const media = [...pages[0].media];
				return {
					includes: { get media() { return media; } },
					async *[Symbol.asyncIterator]() {
						yield* pages[0].tweets;
						for (const page of pages.slice(1)) {
							calls.push({ page: 'next' });
							media.push(...page.media);
							yield* page.tweets;
						}
					},
				};
			},
		};
	}

	const reply = (id, conversation, to) => tweet(id, 'and another thing', { conversation_id: conversation, in_reply_to_user_id: to, referenced_tweets: [{ type: 'replied_to', id: conversation }] });
	const pages = [
		{
			media: [{ media_key: '7_1', type: 'video' }],
			tweets: [
				tweet('105', 'A clip of the rig', { attachments: { media_keys: ['7_1'] }, public_metrics: metrics(30) }),
				reply('104', '103', '42'),
				tweet('103', 'A thread starts here', { public_metrics: metrics(12) }),
				reply('102', '999', '7'),
			],
		},
		{
			media: [{ media_key: '3_9', type: 'photo' }],
			tweets: [
				reply('101', '100', '7'),
				tweet('100', 'A still from the studio', { attachments: { media_keys: ['3_9'] }, public_metrics: metrics(4) }),
				tweet('99', 'RT @someone: hello', { referenced_tweets: [{ type: 'retweeted', id: '5' }] }),
			],
		},
	];
	const ledger = { published: [{ id: 'studio-still', lane: 'creation', pattern: 'proof', postIds: ['100'], url: 'https://x.com/trythreews/status/100' }] };

	it('credits the queue with an Article and with the post that quotes it', async () => {
		const quoting = tweet('201', 'The long version is up', { referenced_tweets: [{ type: 'quoted', id: '200' }] });
		const article = tweet('200', 'https://t.co/art', { article: { title: 'How rigs get named', cover_media: '3_200' } });
		const client = timelineClient([{ media: [], tweets: [quoting, article] }]);
		const sent = { published: [{ id: 'rig-names', kind: 'article', lane: 'article', pattern: 'longform', postIds: ['201'], articlePostId: '200', url: 'https://x.com/trythreews/status/200' }] };
		const outcomes = await collectOutcomes({ client, ledger: sent, now: NOW });
		expect(outcomes.posts.map((post) => [post.id, post.source, post.lane])).toEqual([['201', 'pipeline', 'article'], ['200', 'pipeline', 'article']]);
	});

	it('pages the whole timeline and keeps one row per head post', async () => {
		const client = timelineClient(pages);
		const outcomes = await collectOutcomes({ client, ledger, now: NOW });

		expect(client.calls.filter((call) => call.page === 'next')).toHaveLength(1);
		const [{ id, options }] = client.calls;
		expect(id).toBe('42');
		expect(options).toMatchObject({ max_results: 100, exclude: ['retweets'], start_time: '2026-06-19T16:50:00Z', expansions: ['attachments.media_keys'], 'media.fields': ['type'] });
		expect(options['tweet.fields']).toEqual(expect.arrayContaining(['public_metrics', 'created_at', 'referenced_tweets', 'attachments', 'entities', 'note_tweet', 'conversation_id']));

		expect(outcomes.fetchedAt).toBe(new Date(NOW).toISOString());
		expect(outcomes.posts.map((post) => post.id)).toEqual(['105', '103', '100']);
		expect(outcomes.posts.map((post) => post.media)).toEqual(['video', 'none', 'photo']);
		// 103 was answered by the account itself; 100 only by the account answering
		// somebody else, which is a reply and not a second part.
		expect(outcomes.posts.map((post) => post.thread)).toEqual([false, true, false]);
		expect(outcomes.posts[2]).toMatchObject({ source: 'pipeline', lane: 'creation', pattern: 'proof', likes: 4 });
		expect(outcomes.posts[0].source).toBe('hand');
	});

	it('leaves out a reply that X returned without its reference', async () => {
		// A degraded read: the reply arrives with no `referenced_tweets`. Its
		// conversation still belongs to another post, so it is not a head.
		const bare = tweet('104', '@someone so exciting', { conversation_id: '103' });
		const unplaced = tweet('98', 'No conversation at all', { conversation_id: undefined });
		const answered = tweet('97', '@someone agreed', { in_reply_to_user_id: '7' });
		const client = timelineClient([{ media: [], tweets: [bare, tweet('103', 'A real head'), unplaced, answered] }]);
		const outcomes = await collectOutcomes({ client, ledger, now: NOW });
		expect(outcomes.posts.map((post) => post.id)).toEqual(['103']);
		// Nothing says the account wrote 104 to itself, so it is not a second part.
		expect(outcomes.posts[0].thread).toBe(false);
		expect([bare, unplaced, answered].map(isHeadPost)).toEqual([false, false, false]);
	});

	it('starts the read again when X fails part way, and gives up on a refusal', async () => {
		const flaky = timelineClient(pages);
		const timeline = flaky.userTimeline;
		let reads = 0;
		flaky.userTimeline = async (id, options) => {
			const paged = await timeline(id, options);
			if (++reads > 1) return paged;
			return {
				includes: paged.includes,
				async *[Symbol.asyncIterator]() {
					yield* pages[0].tweets;
					throw Object.assign(new Error('Service Unavailable'), { code: 503 });
				},
			};
		};
		const outcomes = await collectOutcomes({ client: flaky, ledger, now: NOW, retryDelayMs: 0 });
		expect(reads).toBe(2);
		expect(outcomes.posts.map((post) => post.id)).toEqual(['105', '103', '100']);

		const down = timelineClient(pages);
		down.userTimeline = vi.fn(async () => {
			throw Object.assign(new Error('Service Unavailable'), { code: 503 });
		});
		await expect(collectOutcomes({ client: down, now: NOW, attempts: 3, retryDelayMs: 0 })).rejects.toThrow('Service Unavailable');
		expect(down.userTimeline).toHaveBeenCalledTimes(3);

		const refused = timelineClient(pages);
		refused.userTimeline = vi.fn(async () => {
			throw Object.assign(new Error('Too Many Requests'), { code: 429 });
		});
		await expect(collectOutcomes({ client: refused, now: NOW, retryDelayMs: 0 })).rejects.toThrow('Too Many Requests');
		expect(refused.userTimeline).toHaveBeenCalledTimes(1);
	});

	it('stops reading at the limit', async () => {
		const client = timelineClient(pages);
		const outcomes = await collectOutcomes({ client, ledger, now: NOW, limit: 3 });
		expect(outcomes.posts.map((post) => post.id)).toEqual(['105', '103']);
		expect(client.calls.filter((call) => call.page === 'next')).toHaveLength(0);
	});

	it('calls a record stale once it is older than the refresh interval, or missing', () => {
		expect(outcomesAreStale({ fetchedAt: null, posts: [] }, NOW)).toBe(true);
		expect(outcomesAreStale(null, NOW)).toBe(true);
		expect(outcomesAreStale({ fetchedAt: new Date(NOW - (OUTCOMES_REFRESH_HOURS + 1) * HOUR).toISOString() }, NOW)).toBe(true);
		expect(outcomesAreStale({ fetchedAt: new Date(NOW - (OUTCOMES_REFRESH_HOURS - 1) * HOUR).toISOString() }, NOW)).toBe(false);
	});
});

describe('incremental refresh', () => {
	const stored = (fetchedDaysAgo, posts) => ({ fetchedAt: daysAgo(fetchedDaysAgo), posts });

	it('reads the whole window the first time and after a long gap', () => {
		expect(readDaysFor(null, { now: NOW })).toBe(OUTCOMES_WINDOW_DAYS);
		expect(readDaysFor({ fetchedAt: null, posts: [] }, { now: NOW })).toBe(OUTCOMES_WINDOW_DAYS);
		expect(readDaysFor(stored(1, []), { now: NOW })).toBe(OUTCOMES_WINDOW_DAYS);
		expect(readDaysFor(stored(200, [row()]), { now: NOW })).toBe(OUTCOMES_WINDOW_DAYS);
	});

	it('otherwise reads back only as far as metrics can still move', () => {
		expect(readDaysFor(stored(0.25, [row()]), { now: NOW })).toBeCloseTo(0.25 + OUTCOMES_SETTLE_DAYS);
		expect(readDaysFor(stored(2, [row()]), { now: NOW })).toBeCloseTo(2 + OUTCOMES_SETTLE_DAYS);
	});

	it('keeps settled rows, takes moving rows from the read, and drops what was deleted or left the window', async () => {
		const settled = row({ id: 's1', at: daysAgo(30), likes: 90 });
		const outOfWindow = row({ id: 'old', at: daysAgo(OUTCOMES_WINDOW_DAYS + 5) });
		const deleted = row({ id: 'gone', at: daysAgo(2) });
		const remeasured = row({ id: '300', at: daysAgo(3), likes: 1 });
		const calls = [];
		const client = {
			async me() {
				return { data: { id: '42' } };
			},
			async userTimeline(id, options) {
				calls.push(options.start_time);
				return {
					includes: { media: [] },
					async *[Symbol.asyncIterator]() {
						yield tweet('300', 'A post whose likes are still arriving', { created_at: daysAgo(3), public_metrics: metrics(40) });
					},
				};
			},
		};
		const previous = stored(0.25, [remeasured, deleted, settled, outOfWindow]);
		const outcomes = await collectOutcomes({ client, now: NOW, previous });

		expect(outcomes.readDays).toBeCloseTo(0.25 + OUTCOMES_SETTLE_DAYS, 1);
		expect(Date.parse(calls[0])).toBeGreaterThan(NOW - (OUTCOMES_SETTLE_DAYS + 1) * DAY);
		expect(outcomes.posts.map((post) => post.id)).toEqual(['300', 's1']);
		expect(outcomes.posts[0].likes).toBe(40);
	});

	it('paces a failed read like a read, so a refusal is not repeated every tick', () => {
		const failed = { fetchedAt: daysAgo(2), attemptedAt: new Date(NOW - HOUR).toISOString(), posts: [] };
		expect(outcomesAreStale(failed, NOW)).toBe(false);
		expect(outcomesAreStale(failed, NOW + OUTCOMES_REFRESH_HOURS * HOUR)).toBe(true);
	});
});

describe('learnLifts', () => {
	it('scores a post on likes, bookmarks, and reposts, and ignores replies', () => {
		const base = row({ likes: 20, bookmarks: 6, reposts: 3 });
		expect(outcomeOf(base)).toBeCloseTo(Math.log1p(20) + 0.5 * Math.log1p(6) + 0.25 * Math.log1p(3), 10);
		expect(outcomeOf({ ...base, replies: 500 })).toBe(outcomeOf(base));
	});

	it('leaves out posts too young for their counts to have settled', () => {
		const rows = [
			row({ id: 'a', at: new Date(NOW - (MIN_AGE_HOURS - 1) * HOUR).toISOString(), likes: 900 }),
			row({ id: 'b', at: new Date(NOW - MIN_AGE_HOURS * HOUR).toISOString(), likes: 5 }),
			row({ id: 'c', at: daysAgo(9), likes: 5 }),
		];
		const learned = learnLifts(rows, { now: NOW });
		expect(learned.sample).toBe(2);
		expect(learned.baseline).toBeCloseTo(Math.log1p(5), 4);
		expect(learned.learnedAt).toBe(new Date(NOW).toISOString());
		expect(learnLifts(rows, { now: NOW, minAgeHours: 1 }).sample).toBe(3);
	});

	it('weights a recent post above an old one', () => {
		// One half-life apart: the old video counts half as much as the new one.
		const rows = [
			row({ id: 'new', at: daysAgo(HALF_LIFE_DAYS), media: 'video', likes: 100 }),
			row({ id: 'old', at: daysAgo(2 * HALF_LIFE_DAYS), media: 'video', likes: 0 }),
			row({ id: 'p1', at: daysAgo(HALF_LIFE_DAYS), media: 'photo', likes: 0 }),
			row({ id: 'p2', at: daysAgo(HALF_LIFE_DAYS), media: 'photo', likes: 0 }),
		];
		const learned = learnLifts(rows, { now: NOW });
		const video = (0.5 * Math.log1p(100) + 0.25 * 0) / 0.75;
		expect(learned.lifts['media:video'].delta).toBeCloseTo(video, 4);
		expect(learned.lifts['media:photo'].delta).toBeCloseTo(-video, 4);
		expect(learned.baseline).toBeCloseTo((0.5 * Math.log1p(100)) / 1.75, 4);
		// An unweighted mean would have put the video lift at half the top post.
		expect(learned.lifts['media:video'].delta).toBeGreaterThan(Math.log1p(100) / 2);
	});

	it('shrinks a difference by how few posts it was measured on', () => {
		const rows = [
			...[1, 2, 3, 4].map((n) => row({ id: `v${n}`, media: 'video', likes: 50 })),
			...[1, 2, 3, 4, 5, 6].map((n) => row({ id: `p${n}`, media: 'photo', likes: 10 })),
		];
		const learned = learnLifts(rows, { now: NOW });
		const delta = Math.log1p(50) - Math.log1p(10);
		expect(learned.lifts['media:video']).toEqual({ delta: expect.closeTo(delta, 4), n: 4, shrunk: expect.closeTo(delta * (4 / (4 + SHRINK_K)), 4) });
		expect(learned.lifts['media:photo']).toEqual({ delta: expect.closeTo(-delta, 4), n: 6, shrunk: expect.closeTo(-delta * (6 / (6 + SHRINK_K)), 4) });
		expect(learnLifts(rows, { now: NOW, shrinkK: 0 }).lifts['media:video'].shrunk).toBeCloseTo(delta, 4);
		// Every post shares these values, so there is nothing to compare against.
		expect(learned.lifts['cashtag:false']).toEqual({ delta: 0, n: 10, shrunk: 0 });
	});

	it('reports a value seen on fewer than three posts without letting it move a score', () => {
		const rows = [
			...[1, 2].map((n) => row({ id: `g${n}`, media: 'gif', likes: 400 })),
			...[1, 2, 3].map((n) => row({ id: `v${n}`, media: 'video', likes: 400 })),
			...[1, 2, 3, 4, 5].map((n) => row({ id: `p${n}`, media: 'photo', likes: 2 })),
		];
		const learned = learnLifts(rows, { now: NOW });
		expect(learned.lifts['media:gif'].n).toBe(2);
		expect(learned.lifts['media:gif'].delta).toBeGreaterThan(1);
		expect(learned.lifts['media:gif'].shrunk).toBe(0);
		expect(learned.lifts['media:video'].shrunk).toBeGreaterThan(0);
	});

	it('groups mentions, and measures lane and pattern on pipeline posts only', () => {
		const rows = [
			row({ id: 'a', mentions: 0 }),
			row({ id: 'b', mentions: 1 }),
			row({ id: 'c', mentions: 2 }),
			row({ id: 'd', mentions: 5, source: 'pipeline', lane: 'creation', pattern: 'proof' }),
			row({ id: 'e', lane: 'creation', pattern: 'proof' }),
		];
		const { lifts } = learnLifts(rows, { now: NOW });
		expect(lifts['mentions:0'].n).toBe(2);
		expect(lifts['mentions:1'].n).toBe(1);
		expect(lifts['mentions:2+'].n).toBe(2);
		expect(lifts['lane:creation'].n).toBe(1);
		expect(lifts['pattern:proof'].n).toBe(1);
	});
});

describe('learnedScore', () => {
	const item = (over = {}) => ({
		id: 'x', kind: 'post', lane: 'creation', pattern: 'proof',
		posts: [{ text: 'Genesis turns a sentence into a rigged 3D agent on @solana with $THREE perks, and it walks on arrival: three.ws/genesis', media: [{ path: 'public/x-media/t/clip.mp4' }] }, { text: 'More in the docs.' }],
		...over,
	});
	const lift = (shrunk, n = 10) => ({ delta: shrunk * 2, n, shrunk });
	const learned = (lifts) => ({ learnedAt: new Date(NOW).toISOString(), sample: 40, baseline: 2, lifts });

	it('describes a queued item in the vocabulary of the measured posts', () => {
		expect(describeItem(item())).toEqual({ media: 'video', length: 'band', link: 'head', thread: true, mentions: 1, cashtag: true, source: 'pipeline', lane: 'creation', pattern: 'proof' });
		const quiet = item({ posts: [{ text: 'A short note.', media: [{ path: 'public/x-media/t/a.png' }] }] });
		expect(describeItem(quiet)).toMatchObject({ media: 'photo', length: 'short', link: 'none', thread: false, mentions: 0, cashtag: false });
		expect(describeItem(item({ posts: [{ text: 'Looping', media: [{ path: 'public/x-media/t/loop.gif' }] }] })).media).toBe('gif');
	});

	it('describes a queued Article the way its own post will be measured', () => {
		const article = item({
			kind: 'article', lane: 'article', pattern: 'longform',
			article: { title: 'Hold, do not spend: how $THREE gates the expensive lanes', body: 'data/x-content/articles/hold.md', cover: { path: 'public/x-media/t/a.png' } },
			posts: [{ text: 'The long version, with the 402 you get when you do not hold, on @solana: three.ws/three' }, { text: 'And a second quote.' }],
		});
		expect(describeItem(article)).toEqual({ media: 'photo', length: 'short', link: 'none', thread: false, mentions: 0, cashtag: true, source: 'pipeline', lane: 'article', pattern: 'longform' });
	});

	it('treats a link that sits in a reply as no link on the head', () => {
		const replyLink = item({ posts: [{ text: 'The head says what shipped and leaves the address for the reply below.' }, { text: 'three.ws/genesis' }] });
		expect(describeItem(replyLink).link).toBe('none');
		expect(describeItem(replyLink).thread).toBe(true);
	});

	it('adds the best and the worst signal to the mean of the rest, without stacking them', () => {
		const scored = learnedScore(item(), learned({
			'media:video': lift(0.6),
			'length:band': lift(0.2),
			'link:head': lift(-0.4),
			'thread:true': lift(0.1),
			'mentions:1': lift(-0.1),
			'cashtag:true': lift(0.3),
			'media:photo': lift(-0.9),
		}));
		expect(scored.found.map((entry) => entry.key)).toEqual(['media:video', 'length:band', 'link:head', 'thread:true', 'mentions:1', 'cashtag:true']);
		expect(scored.found[0]).toEqual({ key: 'media:video', shrunk: 0.6 });
		// 0.6 for, 0.4 against, and the rest average (0.2 + 0.1 - 0.1 + 0.3) / 4.
		expect(scored.points).toBe(Math.round(10 * (0.6 - 0.4 + 0.125) * 10) / 10);
		expect(scored.points).toBeLessThan(10 * (0.6 + 0.2 + 0.1 + 0.3));
	});

	it('uses the single signal it has, and scores nothing when it has none', () => {
		expect(learnedScore(item(), learned({ 'media:video': lift(0.5) })).points).toBe(5);
		expect(learnedScore(item(), learned({ 'link:head': lift(-0.5) })).points).toBe(-5);
		expect(learnedScore(item(), learned({ 'media:video': lift(0.5), 'cashtag:true': lift(0.2) })).points).toBe(7);
		expect(learnedScore(item(), learned({}))).toEqual({ points: 0, found: [] });
		expect(learnedScore(item(), null)).toEqual({ points: 0, found: [] });
	});

	it('lists a thinly measured value without letting it dilute the others', () => {
		const scored = learnedScore(item(), learned({
			'media:video': lift(0.6),
			'cashtag:true': lift(0.2),
			'lane:creation': { delta: 1.4, n: 1, shrunk: 0 },
			'pattern:proof': { delta: -0.8, n: 2, shrunk: 0 },
		}));
		expect(scored.found.map((entry) => entry.key)).toEqual(['media:video', 'cashtag:true', 'lane:creation', 'pattern:proof']);
		expect(scored.points).toBe(8);
	});

	it('clamps the points on both sides', () => {
		expect(learnedScore(item(), learned({ 'media:video': lift(4), 'cashtag:true': lift(3) })).points).toBe(LEARNED_POINTS_LIMIT);
		expect(learnedScore(item(), learned({ 'media:video': lift(-4), 'cashtag:true': lift(-3) })).points).toBe(-LEARNED_POINTS_LIMIT);
	});
});

describe('scoreItem with learned lifts', () => {
	const now = Date.parse('2026-09-17T00:00:00Z');
	const post = { id: 'x', kind: 'post', lane: 'l', pattern: 'p', notBefore: '2026-09-17T00:00:00Z', posts: [{ text: 'The $THREE layer, on @awscloud: three.ws/x', media: [{ path: 'public/x.webp' }] }] };
	const learned = (sample) => ({ learnedAt: new Date(now).toISOString(), sample, baseline: 2, lifts: { 'media:photo': { delta: 0.5, n: 30, shrunk: 0.4 }, 'cashtag:true': { delta: -0.3, n: 12, shrunk: -0.2 } } });
	const attach = (extra) => Object.assign(new Map(loadLifts(root)), { volumeModel: null, ...extra });

	it('adds the learned part and drops the archive estimate once the sample is large enough', () => {
		const scored = scoreItem(post, { lifts: attach({ learned: learned(LEARNED_MIN_SAMPLE) }), now });
		expect(scored.parts.learned).toBe(2);
		expect(scored.parts.engagement).toBeUndefined();
		expect(scored.score).toBe(2);
		expect(scored.learnedSignals).toEqual([{ key: 'media:photo', shrunk: 0.4 }, { key: 'cashtag:true', shrunk: -0.2 }]);
	});

	it('keeps the volume part in front, with the learned part beside it', () => {
		const lifts = Object.assign(loadLifts(root), { learned: learned(60) });
		const scored = scoreItem(post, { lifts, now });
		const alone = scoreItem(post, { lifts: loadLifts(root), now });
		expect(scored.parts.volume).toBe(alone.parts.volume);
		expect(scored.parts.learned).toBe(2);
		expect(scored.parts.engagement).toBeUndefined();
		expect(scored.score).toBeCloseTo(alone.score + 2, 5);
	});

	it('ranks the old way while the sample is too small, or missing', () => {
		const before = scoreItem(post, { lifts: attach({}), now });
		expect(before.parts.engagement).toBeGreaterThan(0);
		expect(before.learnedSignals).toEqual([]);

		const thin = scoreItem(post, { lifts: attach({ learned: learned(LEARNED_MIN_SAMPLE - 1) }), now });
		expect(thin.parts).toEqual(before.parts);
		expect(thin.parts.learned).toBeUndefined();
		expect(thin.score).toBe(before.score);

		const withModel = scoreItem(post, { lifts: Object.assign(loadLifts(root), { learned: learned(3) }), now });
		expect(withModel.parts).toEqual(scoreItem(post, { lifts: loadLifts(root), now }).parts);
		expect(scoreItem(post, { lifts: null, now }).parts.learned).toBeUndefined();
	});
});

describe('runTick and the outcomes loop', () => {
	const cadence = { windowMinutes: 45, minimumMinutesApart: 240, dailyCap: 3, slots: [{ tier: 3, at: '08:00' }, { tier: 1, at: '16:00' }, { tier: 2, at: '22:00' }] };
	const texts = {
		rigged: 'Rig Doctor names the skeleton convention of a humanoid GLB in the browser and lists the joints that stay frozen: three.ws/rig-doctor',
		priced: 'Materialize measures the true solid volume of a repaired mesh and prices a physical print from that measurement: three.ws/materialize',
	};

	function sandbox() {
		const dir = mkdtempSync(join(tmpdir(), 'x-outcomes-'));
		mkdirSync(join(dir, 'data/x-content/reviews'), { recursive: true });
		const items = Object.entries(texts).map(([id, text], index) => ({
			id, status: 'approved', kind: 'post', tier: 1, lane: id, pattern: id, priority: 20 - index * 20,
			notBefore: '2026-09-17T00:00:00Z', textOnly: true, posts: [{ text }],
		}));
		for (const item of items) {
			writeFileSync(join(dir, reviewPath(item.id)), JSON.stringify({ id: item.id, contentHash: contentHash(item, dir), reviewedAt: '2026-09-17T00:00:00Z', passed: true, blockers: [] }));
		}
		writeFileSync(join(dir, 'data/x-content/queue.json'), JSON.stringify({ account: 'trythreews', cadence, items }));
		return dir;
	}

	// Posts of the queue's own length did well; short ones did not.
	const measured = [
		...Array.from({ length: 12 }, (_, n) => row({ id: `b${n}`, at: daysAgo(5 + n), length: 'band', likes: 80 })),
		...Array.from({ length: 12 }, (_, n) => row({ id: `s${n}`, at: daysAgo(5 + n), length: 'short', likes: 3 })),
	];
	const stale = () => memoryOutcomesStore({ fetchedAt: new Date(NOW - (OUTCOMES_REFRESH_HOURS + 1) * HOUR).toISOString(), posts: measured });
	const recorder = () => {
		const events = [];
		const client = previewClient();
		const send = client.tweet;
		client.tweet = async (payload) => {
			events.push('tweet');
			return send(payload);
		};
		return { events, client };
	};
	const noChecks = async () => [];

	it('ranks with the learned lifts, and reads nothing from X on a dry run', async () => {
		const outcomes = stale();
		const collect = vi.fn();
		const result = await runTick({ root: sandbox(), store: memoryStore(), dryRun: true, now: NOW, env: {}, outcomes, collect });
		expect(result.preview.id).toBe('rigged');
		expect(result.preview.parts.learned).toBeGreaterThan(0);
		expect(result.preview.parts.engagement).toBeUndefined();
		expect(result.preview.parts.learned).toBe(learnedScore({ lane: 'rigged', pattern: 'rigged', posts: [{ text: texts.rigged }] }, learnLifts(measured, { now: NOW })).points);
		expect(result.outcomes).toEqual({ refreshed: false, sample: 24 });
		expect(collect).not.toHaveBeenCalled();
		expect((await outcomes.load()).posts).toHaveLength(24);
	});

	it('ranks the old way when there is no outcomes store', async () => {
		const result = await runTick({ root: sandbox(), store: memoryStore(), dryRun: true, now: NOW, env: {} });
		expect(result.preview.parts.learned).toBeUndefined();
		expect(result.preview.parts.engagement).toBe(0);
		expect(result.outcomes).toEqual({ refreshed: false, sample: 0 });
	});

	it('refreshes stale outcomes once the post is out', async () => {
		const outcomes = stale();
		const { events, client } = recorder();
		const fresh = { fetchedAt: new Date(NOW).toISOString(), posts: [...measured, row({ id: 'n1', at: daysAgo(3) })] };
		const collect = vi.fn(async ({ ledger }) => {
			events.push(`collect after ${ledger.published.map((entry) => entry.id).join(',')}`);
			return fresh;
		});
		const result = await runTick({ root: sandbox(), store: memoryStore(), dryRun: false, now: NOW, env: {}, client, checks: noChecks, outcomes, collect });

		expect(result.published.id).toBe('rigged');
		expect(result.published.slot).toBe('2026-09-17#1');
		expect(events).toEqual(['tweet', 'collect after rigged']);
		expect(collect).toHaveBeenCalledTimes(1);
		expect(collect.mock.calls[0][0]).toMatchObject({ client, now: NOW, previous: await stale().load() });
		expect(result.outcomes).toEqual({ refreshed: true, sample: 25 });
		expect(await outcomes.load()).toEqual(fresh);
	});

	it('refreshes on a tick that had nothing to send, and leaves fresh outcomes alone', async () => {
		const quiet = Date.parse('2026-09-17T13:00:00Z');
		const outcomes = memoryOutcomesStore({ fetchedAt: null, posts: [] });
		const collect = vi.fn(async ({ now }) => ({ fetchedAt: new Date(now).toISOString(), posts: measured }));
		const first = await runTick({ root: sandbox(), store: memoryStore(), dryRun: false, now: quiet, env: {}, client: previewClient(), checks: noChecks, outcomes, collect });
		expect(first.published).toBeNull();
		expect(first.reason).toMatch(/no slot is open/);
		expect(first.outcomes.refreshed).toBe(true);

		const second = await runTick({ root: sandbox(), store: memoryStore(), dryRun: false, now: quiet + HOUR, env: {}, client: previewClient(), checks: noChecks, outcomes, collect });
		expect(second.outcomes.refreshed).toBe(false);
		expect(collect).toHaveBeenCalledTimes(1);
	});

	it('still reports the post as sent when the refresh throws', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const outcomes = stale();
			const store = memoryStore();
			const collect = vi.fn(async () => {
				throw new Error('Too Many Requests');
			});
			const result = await runTick({ root: sandbox(), store, dryRun: false, now: NOW, env: {}, client: previewClient(), checks: noChecks, outcomes, collect });

			expect(result.published.id).toBe('rigged');
			expect(result.outcomes).toEqual({ refreshed: false, sample: 24 });
			expect((await store.load()).published.map((entry) => entry.id)).toEqual(['rigged']);
			expect(warn).toHaveBeenCalledWith('[x-content] outcomes refresh failed', 'Too Many Requests');
			const after = await outcomes.load();
			expect(after.posts).toHaveLength(24);
			expect(after.attemptedAt).toBe(new Date(NOW).toISOString());
			expect(after.attemptError).toBe('Too Many Requests');
			expect(outcomesAreStale(after, NOW + HOUR)).toBe(false);
		} finally {
			warn.mockRestore();
		}
	});

	it('ranks without the learned part when the stored outcomes cannot be read', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const broken = { load: async () => { throw new Error('connection refused'); }, save: vi.fn() };
			const result = await runTick({ root: sandbox(), store: memoryStore(), dryRun: false, now: NOW, env: {}, client: previewClient(), checks: noChecks, outcomes: broken, collect: async () => ({ fetchedAt: new Date(NOW).toISOString(), posts: measured }) });
			expect(result.published.id).toBe('rigged');
			expect(warn).toHaveBeenCalledWith('[x-content] outcomes load failed', 'connection refused');
			expect(broken.save).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});

	it('does not refresh for a post an operator sends by name', async () => {
		const collect = vi.fn();
		const result = await runTick({ root: sandbox(), store: memoryStore(), dryRun: false, now: NOW, env: {}, requestedId: 'priced', client: previewClient(), checks: noChecks, outcomes: stale(), collect });
		expect(result.published.id).toBe('priced');
		expect(result.outcomes).toEqual({ refreshed: false, sample: 24 });
		expect(collect).not.toHaveBeenCalled();
	});

	it('lets an account-wide failure through unchanged, after the refresh has run', async () => {
		const outcomes = stale();
		const down = previewClient();
		down.tweet = async () => {
			throw Object.assign(new Error('Service Unavailable'), { code: 503 });
		};
		const collect = vi.fn(async ({ now }) => ({ fetchedAt: new Date(now).toISOString(), posts: measured.slice(0, 5) }));
		await expect(runTick({ root: sandbox(), store: memoryStore(), dryRun: false, now: NOW, env: {}, client: down, checks: noChecks, outcomes, collect })).rejects.toThrow('Service Unavailable');
		expect(collect).toHaveBeenCalledTimes(1);
		expect((await outcomes.load()).posts).toHaveLength(5);
	});
});
