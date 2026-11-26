// Oracle social feed: cashtag filtering, handle dedupe, and the batch collector
// with an injected timeline reader (the official X API client in production).

import { describe, it, expect, vi } from 'vitest';
import { collectSocialBatch, relevantTweets, uniqueHandles } from '../api/_lib/oracle/social-feed.js';

describe('social feed', () => {
	const NOW = Date.parse('2026-02-01T12:00:00Z');
	const fresh = { id: '1', text: 'accumulating $THREE', createdAt: '2026-02-01T10:00:00.000Z', author: { username: 'a' }, metrics: { views: 100, likes: 3, retweets: 1 } };

	it('keeps recent cashtag tweets and drops stale or cashtag-free ones', () => {
		const out = relevantTweets(
			[fresh, { ...fresh, id: '2', text: 'gm' }, { ...fresh, id: '3', createdAt: '2026-01-01T00:00:00.000Z' }],
			'a',
			{ now: NOW },
		);
		expect(out.map((t) => t.id)).toEqual(['1']);
		expect(out[0]).toMatchObject({ url: 'https://x.com/a/status/1', author: { username: 'a' }, metrics: { views: 100, likes: 3, retweets: 1 } });
	});

	it('dedupes and caps handles case-insensitively', () => {
		expect(uniqueHandles([['Alice', '@alice'], ['bob', 'bad handle']], 5)).toEqual(['alice', 'bob']);
		expect(uniqueHandles([['a', 'b', 'c']], 2)).toEqual(['a', 'b']);
	});

	it('stops at a rate limit and reports the unread handles as skipped', async () => {
		const reader = vi.fn(async (h) => {
			if (h === 'two') throw Object.assign(new Error('slow down'), { reason: 'rate_limited' });
			return { tweets: [fresh] };
		});
		const r = await collectSocialBatch(['one', 'two', 'three'], { reader, now: () => NOW });
		expect(r.read).toBe(1);
		expect(r.tweets).toHaveLength(1);
		expect(r.skipped).toEqual(['three']);
		expect(r.failures.two).toMatch(/rate_limited/);
	});
});
