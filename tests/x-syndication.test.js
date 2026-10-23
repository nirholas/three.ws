import { describe, it, expect, vi } from 'vitest';
import {
	readXPost,
	parsePostUrl,
	postVideoVariants,
	assertMediaUrl,
	downloadFilename,
	PostUnavailableError,
	XPostError,
} from '../api/_lib/x-syndication.js';

const POST_URL = 'https://x.com/trythreews/status/1894000000000000000';

const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const status = (code) => ({ ok: false, status: code, text: async () => '' });

const synVideoPost = {
	text: 'launch day https://t.co/abc',
	display_text_range: [0, 10],
	created_at: '2026-10-01T12:00:00.000Z',
	favorite_count: 120,
	conversation_count: 9,
	user: { name: 'three.ws', screen_name: 'trythreews', profile_image_url_https: 'https://pbs.twimg.com/a.jpg', is_blue_verified: true },
	mediaDetails: [
		{
			type: 'video',
			media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/t.jpg',
			video_info: {
				duration_millis: 12000,
				variants: [
					{ content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/a/playlist.m3u8' },
					{ content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/a/vid/avc1/320x180/low.mp4?tag=12' },
					{ content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/a/vid/avc1/1280x720/hi.mp4?tag=12' },
				],
			},
		},
	],
};

describe('parsePostUrl', () => {
	it('parses x.com and twitter.com status links', () => {
		expect(parsePostUrl(POST_URL)).toEqual({ handle: 'trythreews', id: '1894000000000000000' });
		expect(parsePostUrl('https://twitter.com/a/status/5?s=20')).toEqual({ handle: 'a', id: '5' });
	});
	it('rejects other hosts and junk', () => {
		expect(parsePostUrl('https://evil.example/a/status/5')).toBeNull();
		expect(parsePostUrl(null)).toBeNull();
	});
});

describe('readXPost', () => {
	it('reads text, author, metrics, timestamps and ranked mp4 variants from syndication', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(ok(synVideoPost));
		const p = await readXPost(POST_URL, { fetchImpl, bearerToken: '' });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('cdn.syndication.twimg.com');
		expect(p.source).toBe('syndication');
		expect(p.text).toBe('launch day');
		expect(p.author).toMatchObject({ handle: 'trythreews', verified: true });
		expect(p.metrics).toMatchObject({ likes: 120, replies: 9, views: null });
		expect(p.ts).toBe(Date.parse('2026-10-01T12:00:00.000Z'));
		const v = postVideoVariants(p);
		expect(v.map((x) => x.quality)).toEqual(['720p', '320p']);
		expect(v[0].width).toBe(1280);
		expect(v.every((x) => x.url.endsWith('.mp4') || x.url.includes('.mp4?'))).toBe(true);
		expect(v).toHaveLength(2);
	});

	it('falls through to fxtwitter when syndication fails and picks up reposts and views', async () => {
		const fetchImpl = vi.fn(async (url) => {
			if (String(url).includes('syndication')) return status(429);
			return ok({
				tweet: {
					text: 'hello',
					created_at: 'Thu Oct 01 12:00:00 +0000 2026',
					likes: 5, replies: 1, retweets: 3, quotes: 2, views: 900, bookmarks: 4,
					author: { name: 'three.ws', screen_name: 'trythreews', avatar_url: 'https://pbs.twimg.com/a.jpg' },
					media: { all: [{ type: 'video', thumbnail_url: 't', duration: 4.5, width: 1280, height: 720, url: 'https://video.twimg.com/x/1280x720/v.mp4', formats: [] }] },
				},
			});
		});
		const p = await readXPost(POST_URL, { fetchImpl, bearerToken: '' });
		expect(p.source).toBe('fxtwitter');
		expect(p.metrics).toMatchObject({ likes: 5, reposts: 3, quotes: 2, views: 900, bookmarks: 4 });
		expect(p.media[0].durationMs).toBe(4500);
		expect(postVideoVariants(p)[0].quality).toBe('720p');
	});

	it('falls through to guest GraphQL only when a bearer token is configured', async () => {
		const fetchImpl = vi.fn(async (url) => {
			const u = String(url);
			if (u.includes('guest/activate')) return ok({ guest_token: 'g1' });
			if (u.includes('graphql')) {
				return ok({ data: { tweetResult: { result: { legacy: { full_text: 'gql text', favorite_count: 1, retweet_count: 2, reply_count: 3, quote_count: 4, created_at: 'Thu Oct 01 12:00:00 +0000 2026' }, views: { count: '77' }, core: { user_results: { result: { core: { name: 'n', screen_name: 'trythreews' } } } } } } } });
			}
			return status(500);
		});
		const p = await readXPost(POST_URL, { fetchImpl, bearerToken: 'test-bearer' });
		expect(p.source).toBe('graphql');
		expect(p.metrics).toMatchObject({ likes: 1, reposts: 2, replies: 3, quotes: 4, views: 77 });

		const noBearer = vi.fn().mockResolvedValue(status(500));
		await expect(readXPost(POST_URL, { fetchImpl: noBearer, bearerToken: '' })).rejects.toMatchObject({ status: 502 });
		expect(noBearer).toHaveBeenCalledTimes(2);
	});

	it('reports a deleted post as unavailable (404), not as an outage', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(status(404));
		const err = await readXPost(POST_URL, { fetchImpl, bearerToken: '' }).catch((e) => e);
		expect(err).toBeInstanceOf(PostUnavailableError);
		expect(err.status).toBe(404);
	});

	it('treats a syndication tombstone as unavailable and still tries fxtwitter', async () => {
		const fetchImpl = vi.fn(async (url) =>
			String(url).includes('syndication')
				? ok({ __typename: 'TweetTombstone' })
				: ok({ tweet: { text: 'alive', author: { name: 'a', screen_name: 'a' }, media: { all: [] } } }),
		);
		const p = await readXPost(POST_URL, { fetchImpl, bearerToken: '' });
		expect(p.source).toBe('fxtwitter');
		expect(p.text).toBe('alive');
	});

	it('rejects a non-post URL with 400 without fetching', async () => {
		const fetchImpl = vi.fn();
		await expect(readXPost('https://example.com/x', { fetchImpl })).rejects.toBeInstanceOf(XPostError);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe('download proxy guards', () => {
	it('allows only https video.twimg.com and pbs.twimg.com', () => {
		expect(assertMediaUrl('https://video.twimg.com/a/b.mp4').hostname).toBe('video.twimg.com');
		expect(assertMediaUrl('https://pbs.twimg.com/media/a.jpg').hostname).toBe('pbs.twimg.com');
	});
	it.each([
		'http://video.twimg.com/a.mp4',
		'https://evil.example/a.mp4',
		'https://video.twimg.com.evil.example/a.mp4',
		'https://user:pw@video.twimg.com/a.mp4',
		'https://video.twimg.com:8443/a.mp4',
		'https://127.0.0.1/a.mp4',
		'not a url',
	])('refuses %s', (u) => {
		expect(() => assertMediaUrl(u)).toThrow(XPostError);
	});
	it('builds a header-safe filename', () => {
		expect(downloadFilename('a"b\r\nc', '123')).toBe('a_b__c_123.mp4');
	});
});
