// Keyless X guest reader: activation, parsing, rate-limit cooldown, stale
// query-id recovery. The network is a scripted fetch; the payloads follow the
// shape x.com's guest GraphQL returns (typed User object, timeline instructions).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchGuestProfile, fetchGuestTimeline, resetGuestState } from '../api/_lib/x-guest/index.js';
import { collectSocialBatch, relevantTweets, uniqueHandles } from '../api/_lib/oracle/social-feed.js';

const userResult = {
	__typename: 'User',
	rest_id: '1001',
	core: { name: 'Synthetic Trader', screen_name: 'synthtrader', created_at: 'Mon Jan 05 10:00:00 +0000 2026' },
	avatar: { image_url: 'https://example.test/a_normal.jpg' },
	relationship_counts: { followers: 4321, following: 12 },
	is_blue_verified: true,
};

function tweetEntry(id, text, createdAt, views = '5000') {
	return {
		entryId: `tweet-${id}`,
		content: {
			itemContent: {
				tweet_results: {
					result: {
						__typename: 'Tweet',
						rest_id: id,
						core: { user_results: { result: userResult } },
						legacy: { full_text: text, created_at: createdAt, favorite_count: 10, retweet_count: 2, reply_count: 1 },
						views: { count: views },
					},
				},
			},
		},
	};
}

const json = (status, body, headers = {}) => ({
	ok: status >= 200 && status < 300,
	status,
	headers: { get: (k) => headers[k.toLowerCase()] ?? null },
	json: async () => body,
	text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

function scripted(routes) {
	return vi.fn(async (url, init) => {
		for (const [match, handler] of routes) {
			if (String(url).includes(match)) return handler(String(url), init);
		}
		throw new Error(`unexpected fetch ${url}`);
	});
}

beforeEach(() => resetGuestState());

describe('fetchGuestProfile', () => {
	it('activates a guest token once and parses followers, avatar and join date', async () => {
		const f = scripted([
			['guest/activate.json', () => json(200, { guest_token: '777' })],
			['/UserByScreenName', (_u, init) => {
				expect(init.headers['x-guest-token']).toBe('777');
				return json(200, { data: { user: { result: userResult } } });
			}],
		]);
		const p = await fetchGuestProfile('@synthtrader', { fetchImpl: f });
		expect(p.followers).toBe(4321);
		expect(p.username).toBe('synthtrader');
		expect(p.joined).toBe('2026-01-05T10:00:00.000Z');
		expect(p.verified).toBe(true);
		await fetchGuestProfile('synthtrader', { fetchImpl: f });
		expect(f.mock.calls.filter(([u]) => u.includes('activate')).length).toBe(1);
	});

	it('rejects a malformed handle without touching the network', async () => {
		const f = vi.fn();
		await expect(fetchGuestProfile('not a handle!', { fetchImpl: f })).rejects.toMatchObject({ reason: 'not_found' });
		expect(f).not.toHaveBeenCalled();
	});

	it('opens a cooldown after a 429 and short-circuits the next call', async () => {
		const resetAt = Math.floor(Date.now() / 1000) + 600;
		const f = scripted([
			['guest/activate.json', () => json(200, { guest_token: '1' })],
			['/UserByScreenName', () => json(429, {}, { 'x-rate-limit-reset': String(resetAt) })],
		]);
		await expect(fetchGuestProfile('synthtrader', { fetchImpl: f })).rejects.toMatchObject({ reason: 'rate_limited' });
		const calls = f.mock.calls.length;
		await expect(fetchGuestProfile('synthtrader', { fetchImpl: f })).rejects.toMatchObject({ reason: 'rate_limited' });
		expect(f.mock.calls.length).toBe(calls);
	});

	it('recovers from a rotated query id using the upstream constants', async () => {
		const f = scripted([
			['guest/activate.json', () => json(200, { guest_token: '1' })],
			['raw.githubusercontent.com', () =>
				json(200, '"UserByScreenName": Object.freeze({ queryId: "FRESHID_abc-1", type: "query" }),\n"UserTweets": Object.freeze({ queryId: "TWEETSID_x", type: "query" }),')],
			['/UserByScreenName', (url) =>
				url.includes('/FRESHID_abc-1/')
					? json(200, { data: { user: { result: userResult } } })
					: json(404, { errors: [{ message: 'gone' }] })],
		]);
		const p = await fetchGuestProfile('synthtrader', { fetchImpl: f });
		expect(p.followers).toBe(4321);
	});

	it('fails soft with reason stale_query_id when upstream has no fresh id', async () => {
		const f = scripted([
			['guest/activate.json', () => json(200, { guest_token: '1' })],
			['raw.githubusercontent.com', () => json(500, 'nope')],
			['/UserByScreenName', () => json(404, {})],
		]);
		await expect(fetchGuestProfile('synthtrader', { fetchImpl: f })).rejects.toMatchObject({ reason: 'stale_query_id' });
	});

	it('re-activates once when x.com rejects the guest token', async () => {
		let activations = 0;
		const f = scripted([
			['guest/activate.json', () => json(200, { guest_token: String(++activations) })],
			['/UserByScreenName', (_u, init) =>
				init.headers['x-guest-token'] === '1'
					? json(403, { errors: [{ code: 239 }] })
					: json(200, { data: { user: { result: userResult } } })],
		]);
		expect((await fetchGuestProfile('synthtrader', { fetchImpl: f })).followers).toBe(4321);
		expect(activations).toBe(2);
	});
});

describe('fetchGuestTimeline', () => {
	it('resolves the user id then parses timeline tweets with metrics', async () => {
		const f = scripted([
			['guest/activate.json', () => json(200, { guest_token: '1' })],
			['/UserByScreenName', () => json(200, { data: { user: { result: userResult } } })],
			['/UserTweets', (url) => {
				expect(decodeURIComponent(url)).toContain('"userId":"1001"');
				return json(200, {
					data: { user: { result: { timeline: { timeline: { instructions: [
						{ type: 'TimelineAddEntries', entries: [tweetEntry('9001', 'watching $THREE closely', 'Mon Jan 05 10:00:00 +0000 2026')] },
					] } } } } },
				});
			}],
		]);
		const { profile, tweets } = await fetchGuestTimeline('synthtrader', { limit: 5, fetchImpl: f });
		expect(profile.id).toBe('1001');
		expect(tweets).toHaveLength(1);
		expect(tweets[0]).toMatchObject({ id: '9001', metrics: { likes: 10, retweets: 2, views: 5000 } });
	});
});

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
