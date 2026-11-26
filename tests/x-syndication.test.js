import { describe, it, expect, vi } from 'vitest';
import { readXPost, parsePostUrl, summarizeXPost, PostUnavailableError, XPostError } from '../api/_lib/x-syndication.js';
import { resetXApiState } from '../api/_lib/x-api.js';

const POST_URL = 'https://x.com/trythreews/status/1894000000000000000';
const env = { X_BEARER_TOKEN: 'synthetic-token' };
const res = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });

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

describe('readXPost (official API only)', () => {
	it('reads text, author, metrics and timestamp through the v2 API', async () => {
		resetXApiState();
		const fetchImpl = vi.fn().mockResolvedValue(
			res(200, {
				data: { id: '1894000000000000000', text: 'launch day', author_id: '7', created_at: '2026-10-01T12:00:00.000Z', public_metrics: { like_count: 120, reply_count: 9, retweet_count: 4, quote_count: 1, impression_count: 5000 } },
				includes: { users: [{ id: '7', name: 'three.ws', username: 'trythreews', verified: true }] },
			}),
		);
		const p = await readXPost(POST_URL, { fetchImpl, env });
		expect(String(fetchImpl.mock.calls[0][0])).toContain('api.x.com/2/tweets/1894000000000000000');
		expect(p.source).toBe('x-api');
		expect(p.author).toMatchObject({ handle: 'trythreews', verified: true });
		expect(p.metrics).toMatchObject({ likes: 120, replies: 9, views: 5000 });
		expect(p.ts).toBe(Date.parse('2026-10-01T12:00:00.000Z'));
		expect(summarizeXPost(p)).toMatchObject({ handle: 'trythreews', text: 'launch day' });
	});

	it('rejects a bad URL with 400', async () => {
		await expect(readXPost('https://example.com/x', { env })).rejects.toMatchObject({ status: 400 });
	});

	it('answers 503 and never touches the network when no credentials are set', async () => {
		resetXApiState();
		const fetchImpl = vi.fn();
		await expect(readXPost(POST_URL, { fetchImpl, env: {} })).rejects.toMatchObject({ name: 'XPostError', status: 503 });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('maps a missing post to PostUnavailableError and an outage to 502', async () => {
		resetXApiState();
		await expect(
			readXPost(POST_URL, { env, fetchImpl: async () => res(200, { errors: [{ title: 'Not Found Error' }] }) }),
		).rejects.toBeInstanceOf(PostUnavailableError);
		resetXApiState();
		await expect(readXPost(POST_URL, { env, fetchImpl: async () => res(500, {}) })).rejects.toBeInstanceOf(XPostError);
	});
});
