// The X mention reader (api/_lib/x-mentions.js), driven by captured-shape
// payloads of GET /2/users/:id/mentions in tests/fixtures/x-mentions/.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	normalizeMentions,
	classifyMentionsError,
	readRateLimit,
	mentionsQuery,
	compareIds,
	companyUserId,
	companyMentionsConfigured,
	fetchMentions,
	bearerTransport,
	XTierUnavailable,
	XRateLimited,
	XAuthFailed,
	XMentionsError,
} from '../api/_lib/x-mentions.js';

const FIX = join(process.cwd(), 'tests', 'fixtures', 'x-mentions');
const fixture = (name) => JSON.parse(readFileSync(join(FIX, name), 'utf8'));
const ACCOUNT = { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' };

describe('normalizeMentions', () => {
	const page = fixture('timeline-page.fixture.json');
	const list = normalizeMentions(page, ACCOUNT);
	const byId = Object.fromEntries(list.map((m) => [m.id, m]));

	it('keeps every post and the gateway-overlapping field names', () => {
		expect(list).toHaveLength(7);
		const m = byId['1800000000000000101'];
		expect(m.platform).toBe('x');
		expect(m.chatId).toBe('1800000000000000101');
		expect(m.chatType).toBe('public');
		expect(m.userId).toBe('1700000000000000020');
		expect(m.username).toBe('fixture_dee');
		expect(m.url).toBe('https://x.com/fixture_dee/status/1800000000000000101');
		expect(m.account).toEqual(ACCOUNT);
	});

	it('resolves an attached image', () => {
		const m = byId['1800000000000000101'];
		expect(m.media).toEqual([
			{ key: '3_1800000000000000501', type: 'photo', url: 'https://pbs.twimg.com/media/FixtureCatPhoto.jpg', previewUrl: null, width: 1200, height: 1600, altText: 'a grey cat on a windowsill' },
		]);
		expect(m.urls[0].expandedUrl).toContain('/photo/1');
		expect(m.quoted).toBeNull();
		expect(m.repliedTo).toBeNull();
	});

	it('resolves a quoted post with its own image and author', () => {
		const m = byId['1800000000000000102'];
		expect(m.media).toEqual([]);
		expect(m.quoted).toMatchObject({
			id: '1800000000000000070',
			available: true,
			text: 'my clay dragon finally finished https://t.co/fixtureImg2',
			author: { id: '1700000000000000021', username: 'fixture_cat' },
			url: 'https://x.com/fixture_cat/status/1800000000000000070',
		});
		expect(m.quoted.media[0].url).toBe('https://pbs.twimg.com/media/FixtureDragonPhoto.jpg');
	});

	it('threads a reply chain: conversation, parent, and reply target user', () => {
		const m = byId['1800000000000000103'];
		expect(m.conversationId).toBe('1800000000000000080');
		expect(m.chatId).toBe('1800000000000000080');
		expect(m.inReplyToUserId).toBe('1700000000000000011');
		expect(m.repliedTo).toMatchObject({ id: '1800000000000000081', available: true, author: { username: 'fixture_bob' }, conversationId: '1800000000000000080' });
		expect(m.mentions.map((x) => x.username)).toEqual(['fixture_bob', 'trythreews']);
		expect(m.author.name).toBe('Fixture Cid & Co');
		expect(m.author.verified).toBe(true);
	});

	it('keeps a reply whose parent was deleted, with the parent marked unavailable', () => {
		const m = byId['1800000000000000106'];
		expect(m.repliedTo).toEqual({ id: '1800000000000000091', available: false, text: null, author: null, media: [], url: 'https://x.com/i/status/1800000000000000091', conversationId: null });
	});

	it('reads a long post from note_tweet and decodes entities', () => {
		const m = byId['1800000000000000104'];
		expect(m.text).toContain('a small rowboat tied to an iron ring & rope coiled on the rocks');
		expect(m.text).not.toContain('&amp;');
	});

	it('flags retweets and our own posts', () => {
		expect(byId['1800000000000000105'].isRetweet).toBe(true);
		expect(byId['1800000000000000107'].fromSelf).toBe(true);
		expect(byId['1800000000000000101'].fromSelf).toBe(false);
	});

	it('survives an empty or malformed page', () => {
		expect(normalizeMentions({ meta: { result_count: 0 } }, ACCOUNT)).toEqual([]);
		expect(normalizeMentions(null, ACCOUNT)).toEqual([]);
	});
});

describe('classifyMentionsError', () => {
	it('maps a project-enrollment refusal to XTierUnavailable', () => {
		const err = classifyMentionsError(fixture('error-tier-403.fixture.json'));
		expect(err).toBeInstanceOf(XTierUnavailable);
		expect(err).toBeInstanceOf(XMentionsError);
		expect(err.code).toBe('tier_unavailable');
		expect(err.reason).toBe('client-not-enrolled');
		expect(err.status).toBe(403);
	});

	it('maps the "subset of endpoints" access-level refusal to XTierUnavailable', () => {
		const err = classifyMentionsError(fixture('error-subset-403.fixture.json'));
		expect(err).toBeInstanceOf(XTierUnavailable);
		expect(err.message).toMatch(/subset of X API V2 endpoints/);
	});

	it('maps a depleted pay-per-use balance (402) to XTierUnavailable', () => {
		const err = classifyMentionsError(fixture('error-credits-402.fixture.json'));
		expect(err).toBeInstanceOf(XTierUnavailable);
		expect(err.status).toBe(402);
	});

	it('maps 429 to XRateLimited with the reset from the headers', () => {
		const now = Date.parse('2026-10-08T04:45:00.000Z');
		const err = classifyMentionsError(fixture('error-rate-429.fixture.json'), now);
		expect(err).toBeInstanceOf(XRateLimited);
		expect(err.resetAt).toBe('2026-10-08T04:56:16.000Z');
		expect(err.limit).toBe(300);
	});

	it('falls back to a 15 minute window when a 429 carries no usable reset', () => {
		const now = Date.parse('2026-10-08T04:45:00.000Z');
		const err = classifyMentionsError({ status: 429, headers: {}, body: null }, now);
		expect(err).toBeInstanceOf(XRateLimited);
		expect(err.resetAt).toBe('2026-10-08T05:00:00.000Z');
	});

	it('maps 401 to XAuthFailed and a bare 403 or 503 to the base error', () => {
		expect(classifyMentionsError(fixture('error-auth-401.fixture.json'))).toBeInstanceOf(XAuthFailed);
		const forbidden = classifyMentionsError({ status: 403, headers: {}, body: { title: 'Forbidden', detail: 'Forbidden', type: 'about:blank' } });
		expect(forbidden).not.toBeInstanceOf(XTierUnavailable);
		expect(forbidden.code).toBe('upstream_error');
		expect(classifyMentionsError({ status: 503, headers: {}, body: 'Service Unavailable' }).status).toBe(503);
	});
});

describe('helpers', () => {
	it('reads rate-limit headers from a plain object or a Headers instance', () => {
		expect(readRateLimit({ 'x-rate-limit-limit': '300', 'x-rate-limit-remaining': '298', 'x-rate-limit-reset': '1791435376' }))
			.toEqual({ limit: 300, remaining: 298, resetAt: '2026-10-08T04:56:16.000Z' });
		expect(readRateLimit(new Headers({ 'X-Rate-Limit-Remaining': '7' })).remaining).toBe(7);
		expect(readRateLimit(undefined)).toEqual({ limit: null, remaining: null, resetAt: null });
	});

	it('builds the documented query and clamps page size', () => {
		const q = mentionsQuery({ sinceId: '1800000000000000100', maxResults: 1000, paginationToken: 'tok' });
		expect(q.max_results).toBe('100');
		expect(q.since_id).toBe('1800000000000000100');
		expect(q.pagination_token).toBe('tok');
		expect(q['tweet.fields'].split(',')).toEqual(expect.arrayContaining(['author_id', 'conversation_id', 'created_at', 'referenced_tweets', 'attachments', 'entities', 'in_reply_to_user_id']));
		expect(q.expansions.split(',')).toEqual(expect.arrayContaining(['author_id', 'attachments.media_keys', 'referenced_tweets.id', 'referenced_tweets.id.author_id']));
		expect(q['user.fields'].split(',')).toEqual(expect.arrayContaining(['username', 'name', 'profile_image_url', 'verified']));
		expect(q['media.fields'].split(',')).toEqual(expect.arrayContaining(['url', 'type', 'width', 'height']));
		expect(mentionsQuery({ maxResults: 1 }).max_results).toBe('5');
	});

	it('orders snowflake ids beyond 2^53 correctly', () => {
		expect(compareIds('1800000000000000102', '1800000000000000101')).toBe(1);
		expect(compareIds('1800000000000000101', '1800000000000000101')).toBe(0);
	});

	it('derives the company user id from the OAuth 1.0a access token', () => {
		expect(companyUserId({ X_ACCESS_TOKEN: '1700000000000000001-fixtureSecretPart' })).toBe('1700000000000000001');
		expect(companyUserId({ X_COMPANY_USER_ID: '42', X_ACCESS_TOKEN: '1-x' })).toBe('42');
		expect(companyUserId({})).toBeNull();
		expect(companyMentionsConfigured({ X_API_KEY: 'a', X_API_SECRET: 'b', X_ACCESS_TOKEN: '1-c', X_ACCESS_SECRET: 'd' })).toBe(true);
		expect(companyMentionsConfigured({ X_API_KEY: 'a' })).toBe(false);
	});
});

describe('fetchMentions', () => {
	const replay = (responses) => {
		const calls = [];
		const request = async (path, query) => {
			calls.push({ path, query });
			const next = responses.shift();
			if (!next) throw new Error('fixture replay ran out of responses');
			return next;
		};
		return { request, calls };
	};
	const ok = (body) => ({ status: 200, headers: { 'x-rate-limit-limit': '300', 'x-rate-limit-remaining': '290', 'x-rate-limit-reset': '1791435376' }, body });

	it('paginates back to sinceId and returns mentions oldest first with the new cursor', async () => {
		const { request, calls } = replay([ok(fixture('timeline-page1.fixture.json')), ok(fixture('timeline-page2.fixture.json'))]);
		const res = await fetchMentions({ account: { kind: 'company' }, sinceId: '1800000000000000200', request, resolvedAccount: ACCOUNT });
		expect(calls).toHaveLength(2);
		expect(calls[0].path).toBe('users/1700000000000000001/mentions');
		expect(calls[0].query.since_id).toBe('1800000000000000200');
		expect(calls[1].query.pagination_token).toBe('fixturenexttoken2');
		expect(res.mentions.map((m) => m.id)).toEqual(['1800000000000000202', '1800000000000000203', '1800000000000000204']);
		expect(res.newestId).toBe('1800000000000000204');
		expect(res.pages).toBe(2);
		expect(res.truncated).toBe(false);
		expect(res.rateLimit.remaining).toBe(290);
	});

	it('reads a single page on the first poll (no sinceId) and anchors the cursor', async () => {
		const { request, calls } = replay([ok(fixture('timeline-page1.fixture.json'))]);
		const res = await fetchMentions({ account: { kind: 'company' }, request, resolvedAccount: ACCOUNT });
		expect(calls).toHaveLength(1);
		expect(calls[0].query.since_id).toBeUndefined();
		expect(res.newestId).toBe('1800000000000000204');
		expect(res.truncated).toBe(false);
	});

	it('reports truncation when the page cap is reached with pages left', async () => {
		const { request } = replay([ok(fixture('timeline-page1.fixture.json'))]);
		const res = await fetchMentions({ account: { kind: 'company' }, sinceId: '1800000000000000100', maxPages: 1, request, resolvedAccount: ACCOUNT });
		expect(res.truncated).toBe(true);
		expect(res.newestId).toBe('1800000000000000204');
	});

	it('keeps the old cursor when nothing is new, and records partial errors', async () => {
		const empty = replay([ok({ meta: { result_count: 0 } })]);
		const none = await fetchMentions({ account: { kind: 'company' }, sinceId: '1800000000000000300', request: empty.request, resolvedAccount: ACCOUNT });
		expect(none.mentions).toEqual([]);
		expect(none.newestId).toBe('1800000000000000300');

		const partial = replay([ok(fixture('timeline-page.fixture.json'))]);
		const res = await fetchMentions({ account: { kind: 'company' }, sinceId: '1800000000000000100', request: partial.request, resolvedAccount: ACCOUNT });
		expect(res.partialErrors).toEqual([{ title: 'Not Found Error', detail: 'Could not find tweet with referenced_tweets.id: [1800000000000000091].', resourceId: '1800000000000000091' }]);
	});

	it('throws the typed errors', async () => {
		const tier = replay([fixture('error-tier-403.fixture.json')]);
		await expect(fetchMentions({ account: { kind: 'company' }, request: tier.request, resolvedAccount: ACCOUNT })).rejects.toBeInstanceOf(XTierUnavailable);
		const rate = replay([fixture('error-rate-429.fixture.json')]);
		await expect(fetchMentions({ account: { kind: 'company' }, request: rate.request, resolvedAccount: ACCOUNT })).rejects.toBeInstanceOf(XRateLimited);
	});

	it('refuses an unconfigured company account and an incomplete agent account', async () => {
		await expect(fetchMentions({ account: { kind: 'company' }, env: {} })).rejects.toMatchObject({ code: 'not_configured' });
		await expect(fetchMentions({ account: { kind: 'agent' }, env: {} })).rejects.toMatchObject({ code: 'bad_account' });
	});
});

describe('bearerTransport (agent OAuth2 mode)', () => {
	it('sends the user token, and returns status, headers and the parsed body', async () => {
		const seen = [];
		const fetchImpl = async (url, init) => {
			seen.push({ url, init });
			return new Response(readFileSync(join(FIX, 'timeline-page1.fixture.json'), 'utf8'), {
				status: 200,
				headers: { 'content-type': 'application/json', 'x-rate-limit-remaining': '74' },
			});
		};
		const request = bearerTransport('fixture-user-token', fetchImpl);
		const res = await fetchMentions({ account: { kind: 'agent' }, request, resolvedAccount: { kind: 'agent', ref: 'agent-1', userId: '1700000000000000040', handle: 'fixture_agent' } });
		expect(seen[0].url.startsWith('https://api.twitter.com/2/users/1700000000000000040/mentions?')).toBe(true);
		expect(seen[0].init.headers.authorization).toBe('Bearer fixture-user-token');
		expect(res.mentions).toHaveLength(2);
		expect(res.mentions[0].account.kind).toBe('agent');
		expect(res.rateLimit.remaining).toBe(74);
	});

	it('turns a non-JSON error body into a typed error', async () => {
		const fetchImpl = async () => new Response('Service Unavailable', { status: 503 });
		const request = bearerTransport('fixture-user-token', fetchImpl);
		await expect(fetchMentions({ account: { kind: 'agent' }, request, resolvedAccount: { kind: 'agent', ref: 'a', userId: '1', handle: null } }))
			.rejects.toMatchObject({ status: 503, code: 'upstream_error' });
	});
});
