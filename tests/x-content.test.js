import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyProblems, weightedLength } from '../api/_lib/x-content/quality.js';
import { attachmentProblems, mediaProblems, parseFfmpegProbe } from '../api/_lib/x-content/media.js';
import { markdownToContentState, attachArticleMedia } from '../api/_lib/x-content/articles.js';
import { dueAt, inQuietHours, jitterMinutes, pickDue } from '../api/_lib/x-content/schedule.js';
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
	const item = (id, over = {}) => ({ id, status: 'approved', kind: 'post', lane: 'community', pattern: 'mechanism', notBefore: '2026-09-17T14:00:00Z', ...over });
	const cadence = { windowMinutes: 60, minimumMinutesApart: 240, dailyCap: 3 };

	it('jitters deterministically inside the window', () => {
		expect(jitterMinutes('genesis', 60)).toBe(jitterMinutes('genesis', 60));
		const at = dueAt(item('genesis'), cadence);
		expect(at).toBeGreaterThanOrEqual(Date.parse('2026-09-17T14:00:00Z'));
		expect(at).toBeLessThan(Date.parse('2026-09-17T15:00:00Z'));
	});

	it('handles quiet hours that wrap midnight', () => {
		expect(inQuietHours(Date.parse('2026-09-17T23:30:00Z'), ['22:00', '06:00'])).toBe(true);
		expect(inQuietHours(Date.parse('2026-09-17T12:00:00Z'), ['22:00', '06:00'])).toBe(false);
	});

	it('waits for the jittered moment, then spacing, then the daily cap', () => {
		const now = Date.parse('2026-09-17T16:00:00Z');
		expect(pickDue({ items: [item('a')], state: {}, now: Date.parse('2026-09-17T13:00:00Z'), cadence }).item).toBeNull();
		expect(pickDue({ items: [item('a')], state: {}, now, cadence }).item.id).toBe('a');
		const recent = { published: [{ id: 'z', lane: 'x', pattern: 'y', publishedAt: new Date(now - HOUR).toISOString() }] };
		expect(pickDue({ items: [item('a')], state: recent, now, cadence }).reason).toMatch(/spacing/);
		const capped = { published: [5, 11, 17].map((h, i) => ({ id: `p${i}`, lane: 'x', pattern: 'y', publishedAt: new Date(now - h * HOUR).toISOString() })) };
		expect(pickDue({ items: [item('a')], state: capped, now, cadence }).reason).toMatch(/daily cap/);
	});

	it('rotates lanes and patterns but never starves a one-lane queue', () => {
		const now = Date.parse('2026-09-17T16:00:00Z');
		const state = { published: [{ id: 'p', lane: 'community', pattern: 'mechanism', publishedAt: new Date(now - 5 * HOUR).toISOString() }] };
		const quality = { maximumSameLaneInARow: 2, maximumSamePatternInARow: 1 };
		const picked = pickDue({ items: [item('same'), item('fresh', { pattern: 'number', notBefore: '2026-09-17T14:30:00Z' })], state, now, cadence, quality });
		expect(picked.item.id).toBe('fresh');
		expect(pickDue({ items: [item('same')], state, now, cadence, quality }).item).toBeNull();
		expect(pickDue({ items: [item('same')], state, now: now + 26 * HOUR, cadence, quality }).item.id).toBe('same');
	});

	it('resumes a half-published item ahead of pacing', () => {
		const now = Date.parse('2026-09-17T16:00:00Z');
		const state = {
			published: [{ id: 'p', lane: 'x', pattern: 'y', publishedAt: new Date(now - 10 * 60_000).toISOString() }],
			inflight: { a: { media: {}, postIds: ['1'] } },
		};
		expect(pickDue({ items: [item('a')], state, now, cadence }).resuming).toBe(true);
	});
});

describe('queue', () => {
	it('keeps the committed queue valid for every item headed to X', () => {
		const queue = loadQueue(root);
		const { problems } = validateQueue(queue, root);
		for (const item of queue.items.filter((row) => row.status === 'approved')) expect(problems[item.id]).toEqual([]);
	});

	it('requires media on the head post unless text-only is explicit', () => {
		const dir = sandbox();
		const base = { id: 'demo', status: 'review', kind: 'post', lane: 'l', pattern: 'p', notBefore: '2026-09-17T14:00:00Z' };
		expect(validateItem({ ...base, posts: [{ text: HEAD }] }, dir).join('\n')).toMatch(/no media/);
		expect(validateItem({ ...base, textOnly: true, posts: [{ text: HEAD }] }, dir)).toEqual([]);
	});

	it('validates an Article end to end', () => {
		const dir = sandbox();
		writeFileSync(join(dir, 'data/x-content/articles/demo.md'), '## Why\n\nBecause.\n\n![Hero](../../../public/x-media/t/b.png)\n\nThe end.');
		const item = {
			id: 'demo', status: 'review', kind: 'article', lane: 'article', pattern: 'longform', notBefore: '2026-09-17T14:00:00Z',
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
