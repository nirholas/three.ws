import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyProblems, weightedLength } from '../api/_lib/x-content/quality.js';
import { SPEED_OUTPUT_FPS, attachmentProblems, mediaProblems, parseFfmpegProbe, videoFilterChain } from '../api/_lib/x-content/media.js';
import { markdownToContentState, attachArticleMedia } from '../api/_lib/x-content/articles.js';
import { DEFAULT_SLOTS, currentSlot, inQuietHours, jitterMinutes, pickDue, slotOpenings, tierOrder } from '../api/_lib/x-content/schedule.js';
import { linkProbeUrl } from '../api/_lib/x-content/verify.js';
import { engagementSignals, loadLifts, loadVolumeModel, rankItems, scoreItem, volumeScore } from '../api/_lib/x-content/priority.js';
import { activeHolds, inventory, isPostSpecific, placeHold, runTick } from '../api/_lib/x-content/runner.js';
import { memoryStore } from '../api/_lib/x-content/state.js';
import { validateItem, validateQueue, loadQueue } from '../api/_lib/x-content/queue.js';
import { previewClient, publishItem } from '../api/_lib/x-content/publisher.js';

const root = process.cwd();
const HOUR = 3_600_000;

function sandbox() {
	const dir = mkdtempSync(join(tmpdir(), 'x-content-'));
	mkdirSync(join(dir, 'public/x-media/t'), { recursive: true });
	mkdirSync(join(dir, 'data/x-content/articles'), { recursive: true });
	writeFileSync(join(dir, 'public/x-media/t/a.png'), Buffer.alloc(64));
	writeFileSync(join(dir, 'public/x-media/t/b.png'), Buffer.alloc(64));
	writeFileSync(join(dir, 'public/x-media/t/clip.mp4'), Buffer.alloc(64));
	return dir;
}

const HEAD = 'Rig Doctor names the skeleton convention of any humanoid GLB, then lists which bones animate and which stay put: three.ws/rig-doctor';

describe('quality', () => {
	it('weights URLs as 23 characters', () => {
		expect(weightedLength('see https://three.ws/a/very/long/path/that/keeps/going')).toBe(4 + 23);
	});

	it('flags the tells of an automated feed', () => {
		const problems = copyProblems('Introducing our REVOLUTIONARY AMAZING tool!!! #ai', { minimum: 1 });
		expect(problems.join('\n')).toMatch(/banned opening/);
		expect(problems.join('\n')).toMatch(/hashtags/);
		expect(problems.join('\n')).toMatch(/exclamation/);
		expect(problems.join('\n')).toMatch(/shouting/);
		expect(problems.join('\n')).toMatch(/must link/);
	});

	it('allows tickers and acronyms in capitals', () => {
		expect(copyProblems('$THREE holders get GLTF exports over HTTP on three.ws/pay', { minimum: 1 })).toEqual([]);
	});

	it('does not require a link when the item links elsewhere', () => {
		expect(copyProblems('The rig runs on our own GPU workers.', { minimum: 1, requireUrl: false })).toEqual([]);
	});
});

describe('media', () => {
	it('allows four images, or one video or GIF alone', () => {
		const img = (n) => ({ path: `public/x-media/t/${n}.png` });
		expect(attachmentProblems([img(1), img(2), img(3), img(4)])).toEqual([]);
		expect(attachmentProblems([img(1), img(2), img(3), img(4), img(5)])).toHaveLength(1);
		expect(attachmentProblems([{ path: 'public/x-media/t/clip.mp4' }, img(1)])).toHaveLength(1);
	});

	it('requires alt text on images and media inside the image', () => {
		const dir = sandbox();
		expect(mediaProblems({ path: 'public/x-media/t/a.png' }, dir)).toEqual(['public/x-media/t/a.png: needs alt text']);
		expect(mediaProblems({ path: 'public/x-media/t/a.png', alt: 'a hero shot' }, dir)).toEqual([]);
		expect(mediaProblems({ path: 'docs/a.png', alt: 'x' }, dir).join('\n')).toMatch(/must live under/);
	});

	it('requires a probe within X video limits', () => {
		const dir = sandbox();
		const path = 'public/x-media/t/clip.mp4';
		expect(mediaProblems({ path }, dir).join('\n')).toMatch(/no probe/);
		const good = { durationSec: 12, width: 1280, height: 720, fps: 30, videoCodec: 'h264', pixFmt: 'yuv420p', audioCodec: 'aac' };
		expect(mediaProblems({ path, probe: good }, dir)).toEqual([]);
		const bad = mediaProblems({ path, probe: { ...good, durationSec: 200, width: 3840, videoCodec: 'hevc' } }, dir).join('\n');
		expect(bad).toMatch(/duration/);
		expect(bad).toMatch(/3840x720/);
		expect(bad).toMatch(/h264/);
	});

	it('parses ffmpeg stream info into a probe', () => {
		const stderr = [
			'  Duration: 00:00:06.03, start: 0.000000, bitrate: 6112 kb/s',
			'  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 5972 kb/s, 60 fps, 60 tbr, 15360 tbn (default)',
			'  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)',
		].join('\n');
		expect(parseFfmpegProbe(stderr)).toEqual({ durationSec: 6.03, width: 1920, height: 1080, fps: 60, videoCodec: 'h264', pixFmt: 'yuv420p', audioCodec: 'aac' });
	});
});

describe('articles', () => {
	it('maps inline styles and links onto correct offsets', () => {
		const { content_state } = markdownToContentState('Drop one `<agent-3d>` tag &amp; go. **Bold [link](https://three.ws) text** and ~~old~~.');
		const [block] = content_state.blocks;
		expect(block.text).toBe('Drop one <agent-3d> tag & go. Bold link text and old.');
		const bold = block.inline_style_ranges.find((range) => range.style === 'bold');
		expect(block.text.substr(bold.offset, bold.length)).toBe('Bold link text');
		const strike = block.inline_style_ranges.find((range) => range.style === 'strikethrough');
		expect(block.text.substr(strike.offset, strike.length)).toBe('old');
		const [link] = block.entity_ranges;
		expect(block.text.substr(link.offset, link.length)).toBe('link');
		expect(content_state.entities[link.key].value).toEqual({ type: 'link', mutability: 'mutable', data: { url: 'https://three.ws' } });
	});

	it('turns structure into block types and atomic embeds', () => {
		const md = '# One\n\n## Two\n\n### Three\n\n- a\n- b\n\n1. c\n\n> quote\n\n---\n\n```js\nx()\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |';
		const { content_state, markdownWeight } = markdownToContentState(md);
		expect(content_state.blocks.map((block) => block.type)).toEqual([
			'header-one', 'header-two', 'header-three', 'unordered-list-item', 'unordered-list-item', 'ordered-list-item', 'blockquote', 'atomic', 'atomic', 'atomic',
		]);
		expect(content_state.entities.map((entity) => entity.value.type)).toEqual(['divider', 'markdown', 'markdown']);
		expect(markdownWeight).toBeGreaterThan(0);
	});

	it('resolves local images and attaches uploaded media ids', () => {
		const { content_state, images, warnings } = markdownToContentState('![Hero](../../../public/x-media/t/a.png)\n\n![Remote](https://example.com/x.png)', {
			articlePath: 'data/x-content/articles/demo.md',
		});
		expect(images).toEqual([{ entityIndex: 0, path: 'public/x-media/t/a.png', caption: 'Hero' }]);
		expect(warnings).toHaveLength(1);
		const attached = attachArticleMedia(content_state, images, ['123']);
		expect(attached.entities[0].value.data.media_items).toEqual([{ media_category: 'tweet_image', media_id: '123' }]);
		expect(content_state.entities[0].value.data.media_items).toEqual([]);
	});
});

describe('schedule', () => {
	const cadence = { windowMinutes: 45, minimumMinutesApart: 240, dailyCap: 3, slots: [{ tier: 3, at: '08:00' }, { tier: 1, at: '16:00' }, { tier: 2, at: '22:00' }] };
	const item = (id, over = {}) => ({ id, status: 'approved', kind: 'post', tier: 2, lane: id, pattern: id, notBefore: '2026-09-17T00:00:00Z', posts: [{ text: HEAD }], ...over });
	// 16:50 UTC: the 16:00 T1 slot has opened whatever the jitter (under 45 min).
	const primeTime = Date.parse('2026-09-17T16:50:00Z');

	it('handles quiet hours that wrap midnight', () => {
		expect(inQuietHours(Date.parse('2026-09-17T23:30:00Z'), ['22:00', '06:00'])).toBe(true);
		expect(inQuietHours(Date.parse('2026-09-17T12:00:00Z'), ['22:00', '06:00'])).toBe(false);
	});

	it('opens three tiered slots a day at jittered minutes only the seed reproduces', () => {
		const openings = slotOpenings(primeTime, cadence).filter((slot) => slot.key.startsWith('2026-09-17'));
		expect(openings.map((slot) => slot.tier)).toEqual([3, 1, 2]);
		for (const [slot, hour] of openings.map((slot, index) => [slot, [8, 16, 22][index]])) {
			const minutes = (slot.opensAt - Date.parse(`2026-09-17T${String(hour).padStart(2, '0')}:00:00Z`)) / 60_000;
			expect(minutes).toBeGreaterThanOrEqual(0);
			expect(minutes).toBeLessThan(45);
		}
		const seeded = slotOpenings(primeTime, cadence, 'production-seed');
		expect(slotOpenings(primeTime, cadence, 'production-seed')).toEqual(seeded);
		const bySeed = new Set(['s1', 's2', 's3', 's4', 's5'].map((seed) => slotOpenings(primeTime, cadence, seed)[4].opensAt));
		expect(bySeed.size).toBeGreaterThan(1);
		expect(jitterMinutes('genesis', 60)).toBe(jitterMinutes('genesis', 60, null));
	});

	it('keeps a slot open for three hours, then closes it until the next one', () => {
		expect(currentSlot(primeTime, cadence).slot.key).toBe('2026-09-17#1');
		expect(currentSlot(Date.parse('2026-09-18T00:30:00Z'), cadence).slot.key).toBe('2026-09-17#2');
		const small = currentSlot(Date.parse('2026-09-18T04:00:00Z'), cadence);
		expect(small.slot).toBeNull();
		expect(small.next.key).toBe('2026-09-18#0');
	});

	it('fills a slot from its own tier first, then lower tiers, then a higher tier with surplus', () => {
		expect(tierOrder(1, new Map())).toEqual([1, 2, 3]);
		expect(tierOrder(3, new Map([[1, 1], [2, 1]]))).toEqual([3]);
		expect(tierOrder(3, new Map([[1, 2], [2, 2]]))).toEqual([3, 2, 1]);
		const items = [item('feature', { tier: 2, priority: 40 }), item('flagship', { tier: 1 })];
		const prime = pickDue({ items, state: {}, now: primeTime, cadence });
		expect([prime.item.id, prime.slot.tier, prime.filledDown]).toEqual(['flagship', 1, false]);
		const noFlagship = pickDue({ items: [items[0]], state: {}, now: primeTime, cadence });
		expect([noFlagship.item.id, noFlagship.filledDown]).toEqual(['feature', true]);
		// The last flagship post is kept for prime time, not spent off-peak.
		const morning = Date.parse('2026-09-17T08:50:00Z');
		expect(pickDue({ items: [item('flagship', { tier: 1 })], state: {}, now: morning, cadence }).item).toBeNull();
	});

	it('spends each slot once, and respects embargo, spacing, and the daily cap', () => {
		const used = { published: [{ id: 'z', slot: '2026-09-17#1', publishedAt: '2026-09-17T16:40:00Z' }] };
		expect(pickDue({ items: [item('a', { tier: 1 })], state: used, now: primeTime, cadence }).reason).toMatch(/2026-09-17#1 \(T1\) is used/);
		expect(pickDue({ items: [item('a', { tier: 1, notBefore: '2026-09-18T00:00:00Z' })], state: {}, now: primeTime, cadence }).reason).toMatch(/embargoed/);
		const recent = { published: [{ id: 'z', slot: 'other', publishedAt: new Date(primeTime - HOUR).toISOString() }] };
		expect(pickDue({ items: [item('a', { tier: 1 })], state: recent, now: primeTime, cadence }).reason).toMatch(/spacing/);
		const capped = { published: [5, 11, 17].map((h, i) => ({ id: `p${i}`, slot: `s${i}`, publishedAt: new Date(primeTime - h * HOUR).toISOString() })) };
		expect(pickDue({ items: [item('a', { tier: 1 })], state: capped, now: primeTime, cadence }).reason).toMatch(/daily cap/);
	});

	it('ranks within a tier and falls to the next post when one is held', () => {
		const items = [item('low', { tier: 1, priority: -10 }), item('high', { tier: 1, priority: 30 }), item('mid', { tier: 1 })];
		const first = pickDue({ items, state: {}, now: primeTime, cadence });
		expect(first.ranking.map((row) => row.id)).toEqual(['high', 'mid', 'low']);
		expect(pickDue({ items, state: {}, now: primeTime, cadence, exclude: new Set(['high']) }).item.id).toBe('mid');
		expect(pickDue({ items, state: {}, now: primeTime, cadence, exclude: new Set(['high', 'mid', 'low']) }).reason).toMatch(/held this tick/);
	});

	it('resumes a half-published item ahead of pacing and priority', () => {
		const state = { published: [{ id: 'p', publishedAt: new Date(primeTime - 10 * 60_000).toISOString() }], inflight: { a: { media: {}, postIds: ['1'] } } };
		expect(pickDue({ items: [item('a'), item('b', { priority: 50 })], state, now: primeTime, cadence }).resuming).toBe(true);
	});
});

const tierOfPick = (pick) => Number(pick.item.tier);

describe('priority', () => {
	const lifts = loadLifts(root);
	const post = (text, over = {}) => ({ id: 'x', kind: 'post', lane: 'l', pattern: 'p', notBefore: '2026-09-17T00:00:00Z', posts: [{ text, media: [{ path: 'public/x.webp' }] }], ...over });

	it('reads the measured lifts from the engagement report', () => {
		expect(lifts.get('topic:token').lift).toBeGreaterThan(1);
		const keys = engagementSignals(post('The $THREE layer, on @awscloud: three.ws/x'), lifts).map((row) => row.key);
		expect(keys).toEqual(expect.arrayContaining(['format:image', 'format:mention', 'format:cashtag', 'topic:token']));
	});

	it('shrinks small samples and does not stack overlapping signals', () => {
		const scored = scoreItem(post('The $THREE layer, on @awscloud, explained for partners: three.ws/x'), { lifts, now: Date.parse('2026-09-17T00:00:00Z') });
		expect(scored.predictedLift).toBeGreaterThan(1.5);
		expect(scored.predictedLift).toBeLessThan(10);
	});

	it('ranks on the chance of a volume response, not on engagement, when the volume model ships', () => {
		const model = loadVolumeModel(root);
		expect(model.baseRate).toBeGreaterThan(0);
		expect(model.features.map((row) => row.key)).toEqual(expect.arrayContaining(['launch', 'recognition', 'tier1', 'long', 'thread', 'video']));

		const plain = post('A short note about a tool: three.ws/x');
		const partner = post('three.ws has been accepted into the @nvidia Inception program. The rendering pipeline that ships your agent is now live for every creator on the platform, and the partnership opens GPU capacity we could not reach before: three.ws/nvidia', { posts: [{ text: 'three.ws has been accepted into the @nvidia Inception program. The rendering pipeline that ships your agent is now live for every creator on the platform, and the partnership opens GPU capacity we could not reach before: three.ws/nvidia', media: [{ path: 'public/x.webp' }] }, { text: 'What it unlocks, in detail.', media: [] }] });
		expect(volumeScore(partner, model).found).toEqual(expect.arrayContaining(['tier1', 'recognition', 'launch', 'long', 'thread']));
		expect(volumeScore(partner, model).chance).toBeGreaterThan(volumeScore(plain, model).chance * 2);

		const context = { lifts, now: Date.parse('2026-09-17T00:00:00Z') };
		const scored = scoreItem(partner, context);
		expect(scored.parts.volume).toBeGreaterThan(0);
		expect(scored.parts.engagement).toBeUndefined();
		expect(scoreItem(plain, context).parts.volume).toBeLessThan(0);
		expect(rankItems([{ ...plain, id: 'plain' }, { ...partner, id: 'partner' }], context)[0].item.id).toBe('partner');
	});

	it('falls back to the engagement estimate when no volume model is present', () => {
		const withoutModel = Object.assign(new Map(lifts), { volumeModel: null });
		const scored = scoreItem(post('The $THREE layer, on @awscloud: three.ws/x'), { lifts: withoutModel, now: Date.parse('2026-09-17T00:00:00Z') });
		expect(scored.parts.engagement).toBeGreaterThan(0);
		expect(scored.parts.volume).toBeUndefined();
		expect(scored.volumeChance).toBeNull();
	});

	it('spaces the three daily slots eight hours apart, far enough that all three can post', () => {
		// Owner cadence (2026-09-20): three posts a day, eight hours apart, every
		// day. That replaced the volume-study window (12:00 to 20:00 UTC), which
		// could not hold three slots without crowding them.
		const queue = loadQueue(root);
		const slots = queue.cadence.slots;
		expect(slots).toHaveLength(3);
		const minutes = slots.map((slot) => Number(slot.at.slice(0, 2)) * 60 + Number(slot.at.slice(3))).sort((a, b) => a - b);
		for (let index = 1; index < minutes.length; index++) expect(minutes[index] - minutes[index - 1]).toBe(8 * 60);
		// Wrapping past midnight, the last slot to the first is also eight hours.
		expect(minutes[0] + 24 * 60 - minutes[minutes.length - 1]).toBe(8 * 60);

		// The latest a slot can open, to the earliest the next one can: never closer
		// than the minimum gap, or the later slot would be blocked by the earlier post.
		for (let index = 1; index < minutes.length; index++) {
			expect(minutes[index] - (minutes[index - 1] + queue.cadence.windowMinutes)).toBeGreaterThanOrEqual(queue.cadence.minimumMinutesApart);
		}
	});

	it('opens all three slots every day, weekends included, and still lets a flagship take the flagship slot', () => {
		// Owner directive (2026-09-20): three a day, Sundays too. The queue no
		// longer sets flagshipWeekdaysOnly, so no slot is withheld on a weekend.
		const cadence = loadQueue(root).cadence;
		expect(cadence.flagshipWeekdaysOnly).toBeUndefined();
		const saturday = Date.parse('2026-09-19T16:20:00Z');
		const sunday = Date.parse('2026-09-20T16:20:00Z');
		const monday = Date.parse('2026-09-21T16:45:00Z');
		const tiersOn = (day) => slotOpenings(day, cadence, 'seed').filter((slot) => slot.key.startsWith(new Date(day).toISOString().slice(0, 10))).map((slot) => slot.tier);
		const everyDay = cadence.slots.map((slot) => Number(slot.tier));
		for (const day of [saturday, sunday, monday]) expect(tiersOn(day)).toEqual(everyDay);

		// A weekend flagship slot goes to a flagship post, not down to a feature.
		const flagship = (id) => ({ id, status: 'approved', kind: 'post', tier: 1, lane: id, pattern: id, notBefore: '2026-09-01T00:00:00Z', posts: [{ text: `${id} is now live: three.ws/x`, media: [] }] });
		const feature = { id: 'feature', status: 'approved', kind: 'post', tier: 2, lane: 'f', pattern: 'f', notBefore: '2026-09-01T00:00:00Z', posts: [{ text: 'A feature: three.ws/x', media: [] }] };
		const items = [flagship('one'), flagship('two'), feature];
		const pick = (now) => pickDue({ items, state: { published: [] }, now, cadence, quality: {}, seed: 'seed', lifts: null, reviews: new Map(), exclude: new Set() });
		const sundayFlagship = slotOpenings(sunday, cadence, 'seed').find((slot) => slot.key.startsWith('2026-09-20') && slot.tier === 1);
		expect(tierOfPick(pick(sundayFlagship.opensAt + 60_000))).toBe(1);
		const sundayFeature = slotOpenings(sunday, cadence, 'seed').find((slot) => slot.key.startsWith('2026-09-20') && slot.tier === 2);
		expect(pick(sundayFeature.opensAt + 60_000).item.id).toBe('feature');
	});

	it('adds owner boost, timeliness, waiting, and review; penalizes repetition; drops expired posts', () => {
		const now = Date.parse('2026-09-20T00:00:00Z');
		const base = scoreItem(post('A plain update about avatars: three.ws/x'), { lifts, now });
		expect(base.parts.waiting).toBe(3);
		expect(scoreItem(post('A plain update about avatars: three.ws/x', { priority: 20 }), { lifts, now }).score).toBeCloseTo(base.score + 20, 5);
		expect(scoreItem(post('A plain update about avatars: three.ws/x', { expiresAt: '2026-09-20T12:00:00Z' }), { lifts, now }).parts.timely).toBe(15);
		expect(scoreItem(post('A plain update about avatars: three.ws/x', { expiresAt: '2026-09-19T00:00:00Z' }), { lifts, now }).expired).toBe(true);
		const review = { editor: { scores: { a: 5, b: 5, c: 5, d: 5, e: 5, f: 5 } } };
		expect(scoreItem(post('A plain update about avatars: three.ws/x'), { lifts, now, review }).parts.review).toBe(5);
		const published = [{ id: 'q', lane: 'l', pattern: 'p', publishedAt: '2026-09-19T00:00:00Z' }];
		expect(scoreItem(post('A plain update about avatars: three.ws/x'), { lifts, now, published, quality: { maximumSamePatternInARow: 1 } }).parts.variety).toBe(-25);
		const ranked = rankItems([post('A plain update about avatars: three.ws/x', { id: 'old' }), post('A plain update about avatars: three.ws/x', { id: 'gone', expiresAt: '2026-09-19T00:00:00Z' })], { lifts, now });
		expect(ranked.map((row) => row.item.id)).toEqual(['old']);
	});
});

describe('holds and fall-through', () => {
	it('tells a post problem from an account or platform problem', () => {
		expect(isPostSpecific({ code: 403, data: { detail: 'You are not allowed to create a Tweet with duplicate content.' } })).toBe(true);
		expect(isPostSpecific({ code: 400, message: 'invalid media' })).toBe(true);
		expect(isPostSpecific({ code: 403, data: { detail: 'forbidden' } })).toBe(false);
		expect(isPostSpecific({ code: 401 })).toBe(false);
		expect(isPostSpecific({ code: 429 })).toBe(false);
		expect(isPostSpecific({ code: 503 })).toBe(false);
		expect(isPostSpecific(new Error('socket hang up'))).toBe(false);
	});

	it('backs off a held post and releases it when the post changes', () => {
		const dir = sandbox();
		const item = { id: 'a', kind: 'post', posts: [{ text: HEAD }] };
		const state = {};
		const now = Date.parse('2026-09-17T00:00:00Z');
		expect(placeHold(state, item, dir, 'link down', now).until).toBe('2026-09-17T02:00:00.000Z');
		expect(placeHold(state, item, dir, 'link down', now).until).toBe('2026-09-17T06:00:00.000Z');
		expect(placeHold(state, item, dir, 'link down', now).until).toBe('2026-09-18T00:00:00.000Z');
		expect([...activeHolds(state, [item], dir, now)]).toEqual(['a']);
		expect([...activeHolds(state, [{ ...item, posts: [{ text: `${HEAD} Now fixed.` }] }], dir, now)]).toEqual([]);
		expect([...activeHolds(state, [item], dir, Date.parse('2026-09-18T00:00:01Z'))]).toEqual([]);
	});

	it('counts days of stock per tier and flags the thin ones', () => {
		const dir = sandbox();
		const items = [
			{ id: 'a', status: 'approved', tier: 1, kind: 'post', posts: [{ text: 'a' }] },
			{ id: 'b', status: 'approved', tier: 2, kind: 'post', posts: [{ text: 'b' }] },
			{ id: 'c', status: 'approved', tier: 2, kind: 'post', posts: [{ text: 'c' }] },
			{ id: 'd', status: 'approved', tier: 2, kind: 'post', posts: [{ text: 'd' }] },
			{ id: 'e', status: 'review', tier: 3, kind: 'post', posts: [{ text: 'e' }] },
		];
		const stock = inventory(items, { published: [{ id: 'a' }] }, dir);
		expect(stock).toEqual([{ tier: 1, days: 0, low: true }, { tier: 2, days: 3, low: false }, { tier: 3, days: 0, low: true }]);
	});

	it('never ends a tick on a failed post: it holds it and publishes the next best', async () => {
		const { contentHash, reviewPath } = await import('../api/_lib/x-content/review.js');
		const dir = sandbox();
		mkdirSync(join(dir, 'data/x-content/reviews'), { recursive: true });
		const texts = {
			broken: 'Rig Doctor names the skeleton convention of a humanoid GLB in the browser and lists the joints that stay frozen: three.ws/broken',
			rejected: 'Genesis turns a sentence or a selfie into a rigged 3D agent with a custodial wallet, a persona, and a voice: three.ws/rejected',
			working: 'Materialize measures the true solid volume of a repaired mesh and prices a physical print from that measurement: three.ws/working',
		};
		const items = Object.entries(texts).map(([id, text], index) => ({
			id, status: 'approved', kind: 'post', tier: 1, lane: id, pattern: id, priority: 40 - index * 20,
			notBefore: '2026-09-17T00:00:00Z', textOnly: true, posts: [{ text }],
			probes: [{ type: 'api', url: `https://three.ws/api/${id}` }],
		}));
		for (const item of items) {
			writeFileSync(join(dir, reviewPath(item.id)), JSON.stringify({ id: item.id, contentHash: contentHash(item, dir), reviewedAt: '2026-09-17T00:00:00Z', passed: true, blockers: [] }));
		}
		const cadence = { windowMinutes: 45, minimumMinutesApart: 240, dailyCap: 3, slots: [{ tier: 3, at: '08:00' }, { tier: 1, at: '16:00' }, { tier: 2, at: '22:00' }] };
		writeFileSync(join(dir, 'data/x-content/queue.json'), JSON.stringify({ account: 'trythreews', cadence, items }));

		const store = memoryStore();
		const client = previewClient();
		const tweet = client.tweet;
		client.tweet = async (payload) => {
			if (payload.text.includes('three.ws/rejected')) throw Object.assign(new Error('duplicate content'), { code: 403, data: { detail: 'You are not allowed to create a Tweet with duplicate content.' } });
			return tweet(payload);
		};
		const checks = async (item) => (item.id === 'broken' ? [{ kind: 'probe:api', target: 'https://three.ws/api/broken', ok: false, detail: 'HTTP 500' }] : []);
		const now = Date.parse('2026-09-17T16:50:00Z');

		const result = await runTick({ root: dir, store, dryRun: false, now, client, checks, env: {} });
		expect(result.blocked).toEqual([]);
		expect(result.held.map((row) => row.id)).toEqual(['broken', 'rejected']);
		expect(result.held[0].reason).toMatch(/probe:api .*HTTP 500/);
		expect(result.held[1].reason).toMatch(/X rejected the post/);
		expect(result.published.id).toBe('working');
		expect(result.published.slot).toBe('2026-09-17#1');

		const state = await store.load();
		expect(Object.keys(state.holds).sort()).toEqual(['broken', 'rejected']);
		expect(state.inflight.rejected).toBeUndefined();

		// An account-wide failure is not the post's fault: it stops the tick
		// instead of burning through the queue, and holds nothing new.
		const outage = previewClient();
		outage.tweet = async () => {
			throw Object.assign(new Error('Service Unavailable'), { code: 503 });
		};
		const nextSlot = Date.parse('2026-09-17T22:50:00Z');
		await expect(runTick({ root: dir, store, dryRun: false, now: nextSlot, client: outage, checks: async () => [], env: {} })).rejects.toThrow('Service Unavailable');
		expect(Object.keys((await store.load()).holds).sort()).toEqual(['broken', 'rejected']);
	});
});

describe('queue', () => {
	it('keeps the committed queue valid for every item headed to X', () => {
		const queue = loadQueue(root);
		const { problems } = validateQueue(queue, root);
		for (const item of queue.items.filter((row) => row.status === 'approved')) expect(problems[item.id]).toEqual([]);
	});

	it('speeds a recording up without desyncing its captions, and pins a constant rate', () => {
		// A headless WebGL capture renders about 3 frames a second and the encoder
		// pads it to 25, so 87%% of the shipped frames were repeats. Speeding up
		// drops the padding rather than the content.
		const plain = videoFilterChain();
		expect(plain.some((f) => f.startsWith('setpts'))).toBe(false);
		expect(plain.some((f) => f.startsWith('fps='))).toBe(false);

		const fast = videoFilterChain({ speed: 3 });
		expect(fast.slice(-2)).toEqual(['setpts=PTS/3', `fps=${SPEED_OUTPUT_FPS}`]);

		// Captions burn in against the original timeline and are sped up with the
		// picture; putting setpts first would render them at a third of their cue.
		const captioned = videoFilterChain({ speed: 2, subtitlesPath: '/tmp/cues.srt' });
		const subtitleAt = captioned.findIndex((f) => f.startsWith('subtitles='));
		const setptsAt = captioned.findIndex((f) => f.startsWith('setpts'));
		expect(subtitleAt).toBeGreaterThan(-1);
		expect(setptsAt).toBeGreaterThan(subtitleAt);
	});

	it('refuses a second cashtag, which X rejects at publish', () => {
		// X answers 403 "Posts are limited to a maximum of one cashtag" and the
		// publisher cannot retry around it, so review has to catch it first.
		const one = 'Forge Max is a $THREE holder perk. You hold $25 in it, you do not spend it, and the 200k-poly lane turns on: three.ws/three';
		expect(copyProblems(one)).toEqual([]);
		const two = 'Forge Max is a $THREE holder perk. You hold $25 in $THREE, you do not spend it, and the 200k lane turns on: three.ws/three';
		expect(copyProblems(two)).toEqual(['2 cashtags ($THREE); X allows one per post, so keep the first and write the rest in plain words']);
		// A bare dollar amount is not a cashtag.
		expect(copyProblems('Bronze at $25 takes 5% off compute and $500 takes 20%, which is the whole ladder: three.ws/three')).toEqual([]);
	});

	it('takes a post id for a quote tweet and refuses a pasted URL', async () => {
		const { publishItem, previewClient } = await import('../api/_lib/x-content/publisher.js');
		const dir = sandbox();
		const base = { id: 'quote-post', status: 'draft', kind: 'post', tier: 2, lane: 'l', pattern: 'p', notBefore: '2026-09-20T00:00:00Z', textOnly: true, posts: [{ text: HEAD }, { text: 'A reply that carries the rest of it.' }] };
		expect(validateItem({ ...base, quotes: '2101524482313920723' }, dir)).toEqual([]);
		expect(validateItem({ ...base, quotes: 'https://x.com/trythreews/status/2101524482313920723' }, dir)).toContain('quotes must be a post id (digits only), not a URL');

		// Only the head quotes; the reply still threads under it.
		const client = previewClient();
		const state = { inflight: {} };
		await publishItem({ item: { ...base, quotes: '2101524482313920723' }, client, root: dir, state, store: { save: async () => {} } });
		const tweets = client.calls.filter((call) => call.call === 'tweets.create');
		expect(tweets[0].quote_tweet_id).toBe('2101524482313920723');
		expect(tweets[1].quote_tweet_id).toBeUndefined();
		expect(tweets[1].reply.in_reply_to_tweet_id).toBe(tweets[0] && 'preview-post-1');
	});

	it('requires media on the head post unless text-only is explicit', () => {
		const dir = sandbox();
		const base = { id: 'demo', status: 'review', kind: 'post', tier: 2, lane: 'l', pattern: 'p', notBefore: '2026-09-17T14:00:00Z' };
		expect(validateItem({ ...base, posts: [{ text: HEAD }] }, dir).join('\n')).toMatch(/no media/);
		expect(validateItem({ ...base, textOnly: true, posts: [{ text: HEAD }] }, dir)).toEqual([]);
	});

	it('validates an Article end to end', () => {
		const dir = sandbox();
		writeFileSync(join(dir, 'data/x-content/articles/demo.md'), '## Why\n\nBecause.\n\n![Hero](../../../public/x-media/t/b.png)\n\nThe end.');
		const item = {
			id: 'demo', status: 'review', kind: 'article', tier: 1, lane: 'article', pattern: 'longform', notBefore: '2026-09-17T14:00:00Z',
			article: { title: 'How rigs get named', body: 'data/x-content/articles/demo.md', cover: { path: 'public/x-media/t/a.png' } },
			posts: [{ text: 'The long version of how Rig Doctor reads a skeleton.' }],
		};
		expect(validateItem(item, dir)).toEqual([]);
		expect(validateItem({ ...item, article: { ...item.article, cover: undefined } }, dir).join('\n')).toMatch(/cover/);
	});
});

describe('publisher', () => {
	const store = (log) => ({ save: async (state) => log.push(structuredClone(state)) });

	it('chains a thread with media and alt text on the head', async () => {
		const dir = sandbox();
		const client = previewClient();
		const state = { published: [], inflight: {} };
		const item = {
			id: 'demo', kind: 'post', lane: 'l', pattern: 'p',
			posts: [{ text: HEAD, media: [{ path: 'public/x-media/t/a.png', alt: 'alt one' }] }, { text: 'second' }],
		};
		const row = await publishItem({ item, client, root: dir, state, store: store([]) });
		expect(client.calls.map((call) => call.call)).toEqual(['media.upload', 'media.metadata', 'tweets.create', 'tweets.create']);
		expect(client.calls[3].reply.in_reply_to_tweet_id).toBe(row.postIds[0]);
		expect(state.inflight).toEqual({});
		expect(state.published[0].url).toBe(`https://x.com/trythreews/status/${row.postIds[0]}`);
	});

	it('resumes after a failure without reposting what already went out', async () => {
		const dir = sandbox();
		const state = { published: [], inflight: {} };
		const item = { id: 'demo', kind: 'post', lane: 'l', pattern: 'p', posts: [{ text: HEAD }, { text: 'two' }, { text: 'three' }] };
		const flaky = previewClient();
		const tweet = flaky.tweet;
		let calls = 0;
		flaky.tweet = async (payload) => {
			if (++calls === 2) throw new Error('X 503');
			return tweet(payload);
		};
		await expect(publishItem({ item, client: flaky, root: dir, state, store: store([]) })).rejects.toThrow('X 503');
		expect(state.inflight.demo.postIds).toHaveLength(1);

		const retry = previewClient();
		await publishItem({ item, client: retry, root: dir, state, store: store([]) });
		expect(retry.calls.map((call) => call.text)).toEqual(['two', 'three']);
		expect(retry.calls[0].reply.in_reply_to_tweet_id).toBe(state.published[0].postIds[0]);
	});

	it('drafts, publishes, then quotes an Article', async () => {
		const dir = sandbox();
		writeFileSync(join(dir, 'data/x-content/articles/demo.md'), '## Why\n\n![Hero](../../../public/x-media/t/b.png)\n\nText.');
		const client = previewClient();
		const state = { published: [], inflight: {} };
		const item = {
			id: 'demo', kind: 'article', lane: 'article', pattern: 'longform',
			article: { title: 'Title', body: 'data/x-content/articles/demo.md', cover: { path: 'public/x-media/t/a.png' } },
			posts: [{ text: 'Quote post' }],
		};
		const row = await publishItem({ item, client, root: dir, state, store: store([]) });
		const draft = client.calls.find((call) => call.call === 'POST /2/articles/draft');
		expect(draft.body.cover_media.media_category).toBe('tweet_image');
		const image = draft.body.content_state.entities.find((entity) => entity.value.type === 'image');
		expect(image.value.data.media_items[0].media_id).toMatch(/^preview-media/);
		const quote = client.calls.at(-1);
		expect(quote.quote_tweet_id).toBe(row.articlePostId);
		expect(row.url).toBe(`https://x.com/trythreews/status/${row.articlePostId}`);
	});
});

describe('editorial', () => {
	it('passes the reviewed Genesis copy untouched', async () => {
		const { languageProblems, assertionsIn } = await import('../api/_lib/x-content/editorial.js');
		const text = 'A sentence or a selfie becomes a rigged 3D agent holding its own custodial @solana wallet, a persona, and a voice. It walks and emotes on arrival: three.ws/genesis';
		expect(languageProblems(text)).toEqual([]);
		expect(assertionsIn(text)).toEqual({ numbers: [], absolutes: [] });
	});

	it('blocks brand errors, financial promotion, slang, pushy asks, and ad-copy structure', async () => {
		const { languageProblems } = await import('../api/_lib/x-content/editorial.js');
		const rules = (text) => languageProblems(text).map((row) => `${row.rule}:${row.severity}`);
		expect(rules('Three.ws ships agents on Github: three.ws/a')).toEqual(['brand:blocking', 'brand:blocking', 'links:blocking']);
		expect(rules('$THREE has 100x potential for holders: three.ws/a')).toContain('compliance:blocking');
		expect(rules('gm frens, agents are live: three.ws/a')).toContain('register:blocking');
		expect(rules('A robust agent runtime: three.ws/a')).toEqual(['register:major']);
		expect(rules('Agents are live, check it out: three.ws/a')).toContain('register:blocking');
		expect(rules('Fast. Simple. Onchain. three.ws/a')).toContain('structure:blocking');
		expect(rules('What if agents could pay? They can: three.ws/a')).toContain('structure:blocking');
		expect(rules('Two links: three.ws/a and three.ws/b')).toContain('links:blocking');
	});

	it('counts a bare domain as a link, the way X renders it', async () => {
		const { urlsIn, weightedLength } = await import('../api/_lib/x-content/quality.js');
		const { languageProblems } = await import('../api/_lib/x-content/editorial.js');
		expect(urlsIn('Agents on three.ws spend budgets: https://builder.aws.com/x')).toEqual(['three.ws', 'https://builder.aws.com/x']);
		expect(urlsIn('A .glb loads in Three.js and Node.js; write to me@x.com')).toEqual([]);
		expect(weightedLength('on three.ws')).toBe(3 + 23);
		expect(languageProblems('Agents on three.ws spend budgets: https://builder.aws.com/x').map((row) => row.rule)).toEqual(['links']);
	});

	it('treats names as names and ordinals as numbers', async () => {
		const { assertionsIn } = await import('../api/_lib/x-content/editorial.js');
		expect(assertionsIn('3D agents on ERC-8004 with $THREE: three.ws/a').numbers).toEqual([]);
		expect(assertionsIn('Rig Doctor knows 11 conventions; teach it the 12th in 40 ms at 86%').numbers).toEqual(['11', '12th', '40 ms', '86%']);
	});

	it('requires every number, absolute, and tag in the copy to be declared', async () => {
		const { claimProblems } = await import('../api/_lib/x-content/editorial.js');
		const item = { posts: [{ text: 'The first viewer with 15 rig conventions, built on @solana: three.ws/a' }] };
		const messages = claimProblems(item).map((row) => row.message).join('\n');
		expect(messages).toMatch(/"15" is an unverified number/);
		expect(messages).toMatch(/"first" is an absolute/);
		expect(messages).toMatch(/@solana has no recorded reason/);

		const declared = {
			...item,
			claims: [
				{ says: 'first viewer', evidence: [{ type: 'file', path: 'x', contains: 'y' }] },
				{ says: '15 rig conventions', evidence: [{ type: 'file', path: 'x', contains: 'y' }] },
			],
			mentions: { '@solana': 'wallets are Solana wallets' },
		};
		expect(claimProblems(declared)).toEqual([]);
		expect(claimProblems({ ...declared, claims: [...declared.claims, { says: 'not in the copy', evidence: [] }] }).map((row) => row.message).join('\n'))
			.toMatch(/does not appear in the copy[\s\S]*has no evidence/);
	});

	it('flags soft, badly cropped, undescribed, and stale media', async () => {
		const { mediaQualityProblems } = await import('../api/_lib/x-content/editorial.js');
		const { default: sharp } = await import('sharp');
		const dir = sandbox();
		await sharp({ create: { width: 800, height: 200, channels: 3, background: '#000' } }).png().toFile(join(dir, 'public/x-media/t/small.png'));
		await sharp({ create: { width: 1800, height: 1013, channels: 3, background: '#000' } }).png().toFile(join(dir, 'public/x-media/t/hero.png'));
		mkdirSync(join(dir, 'public/announce'), { recursive: true });
		writeFileSync(join(dir, 'public/announce/media-manifest.json'), JSON.stringify({ shots: { hero: { src: '/x-media/t/hero.png', route: '/hero', capturedAt: '2026-08-01T00:00:00Z' } } }));
		const now = Date.parse('2026-09-16T00:00:00Z');

		const small = await mediaQualityProblems({ text: 'x', media: [{ path: 'public/x-media/t/small.png', alt: 'short' }] }, dir, { now });
		const smallText = small.map((row) => row.message).join('\n');
		expect(smallText).toMatch(/800px wide/);
		expect(smallText).toMatch(/4\.00:1/);
		expect(smallText).toMatch(/alt text is 5 characters/);

		const stale = await mediaQualityProblems({ text: 'x', media: [{ path: 'public/x-media/t/hero.png', alt: 'The hero page with its drop zone and the four stats beneath it' }] }, dir, { now });
		expect(stale.map((row) => row.message)).toEqual([expect.stringMatching(/captured 46 days ago from \/hero/)]);
	});
});

describe('review', () => {
	it('binds approval to the exact reviewed content', async () => {
		const { approvalProblems, contentHash, reviewPath } = await import('../api/_lib/x-content/review.js');
		const dir = sandbox();
		const item = { id: 'demo', kind: 'post', posts: [{ text: HEAD, media: [{ path: 'public/x-media/t/a.png', alt: 'alt' }] }] };
		expect(approvalProblems(item, dir).join('\n')).toMatch(/no editorial review/);

		mkdirSync(join(dir, 'data/x-content/reviews'), { recursive: true });
		const record = { id: 'demo', contentHash: contentHash(item, dir), reviewedAt: '2026-09-16T00:00:00Z', passed: true, blockers: [] };
		writeFileSync(join(dir, reviewPath('demo')), JSON.stringify(record));
		const now = Date.parse('2026-09-17T00:00:00Z');
		expect(approvalProblems(item, dir, now)).toEqual([]);

		expect(approvalProblems({ ...item, posts: [{ ...item.posts[0], text: `${HEAD} ` }] }, dir, now)).toEqual([]);
		expect(approvalProblems({ ...item, posts: [{ ...item.posts[0], text: HEAD.replace('Rig', 'The rig') }] }, dir, now).join('\n')).toMatch(/changed after the last review/);
		writeFileSync(join(dir, 'public/x-media/t/a.png'), Buffer.alloc(65));
		expect(approvalProblems(item, dir, now).join('\n')).toMatch(/changed after the last review/);
		writeFileSync(join(dir, 'public/x-media/t/a.png'), Buffer.alloc(64));
		expect(approvalProblems(item, dir, Date.parse('2026-10-16T00:00:00Z')).join('\n')).toMatch(/days old/);
		writeFileSync(join(dir, reviewPath('demo')), JSON.stringify({ ...record, passed: false, blockers: ['link three.ws/a: HTTP 404'] }));
		expect(approvalProblems(item, dir, now).join('\n')).toMatch(/did not pass: link three\.ws\/a: HTTP 404/);
	});

	it('blocks an approved item in the queue validator until it is reviewed', () => {
		const dir = sandbox();
		const item = { id: 'demo', status: 'approved', kind: 'post', tier: 2, lane: 'l', pattern: 'p', notBefore: '2026-09-17T14:00:00Z', posts: [{ text: HEAD, media: [{ path: 'public/x-media/t/a.png', alt: 'The Rig Doctor page' }] }] };
		expect(validateItem(item, dir).join('\n')).toMatch(/review: no editorial review/);
		expect(validateItem({ ...item, status: 'review' }, dir)).toEqual([]);
	});

	it('never lets the editor pass its own blocking issue or a low score', async () => {
		const { parseReview } = await import('../api/_lib/x-content/editor.js');
		const scores = { accuracy: 5, clarity: 5, specificity: 5, voice: 5, professionalism: 5, visual: 5 };
		const clean = parseReview(`Here you go: ${JSON.stringify({ verdict: 'publish', scores, issues: [] })}`);
		expect(clean.verdict).toBe('publish');
		expect(parseReview(JSON.stringify({ verdict: 'publish', scores, issues: [{ severity: 'blocking', area: 'accuracy' }] })).verdict).toBe('revise');
		expect(parseReview(JSON.stringify({ verdict: 'publish', scores: { ...scores, clarity: 3 }, issues: [] })).verdict).toBe('revise');
		expect(() => parseReview(JSON.stringify({ verdict: 'ship', scores, issues: [] }))).toThrow(/verdict/);
		expect(() => parseReview('no json here')).toThrow(/no JSON/);
	});
});



describe('npm package links', () => {
	it('checks an npm package page against the registry, which answers a non-browser client', () => {
		expect(linkProbeUrl('https://npmjs.com/package/@three-ws/activity-mcp')).toBe('https://registry.npmjs.org/@three-ws%2Factivity-mcp');
		expect(linkProbeUrl('https://www.npmjs.com/package/three')).toBe('https://registry.npmjs.org/three');
		expect(linkProbeUrl('https://three.ws/knock')).toBe('https://three.ws/knock');
	});
});
