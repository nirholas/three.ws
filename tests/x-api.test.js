import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	XApiUnavailable,
	xApiConfigured,
	fetchXProfile,
	fetchXTimeline,
	fetchXPostById,
	resetXApiState,
} from '../api/_lib/x-api.js';

const res = (status, body, headers = {}) => ({
	ok: status >= 200 && status < 300,
	status,
	headers: { get: (k) => headers[k.toLowerCase()] ?? null },
	json: async () => body,
});

describe('x-api unset token', () => {
	it('reports not configured and never calls the network', async () => {
		const fetchImpl = vi.fn();
		expect(xApiConfigured({})).toBe(false);
		await expect(fetchXProfile('synthuser', { env: {}, fetchImpl })).rejects.toMatchObject({
			name: 'XApiUnavailable',
			reason: 'not_configured',
		});
		await expect(fetchXTimeline('synthuser', { env: {}, fetchImpl })).rejects.toBeInstanceOf(XApiUnavailable);
		await expect(fetchXPostById('123', { env: {}, fetchImpl })).rejects.toBeInstanceOf(XApiUnavailable);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

beforeEach(() => resetXApiState());

describe('x-api official v2 calls', () => {
	const env = { X_BEARER_TOKEN: 'synthetic-token' };

	it('reads a profile with an honest user agent and bearer auth', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			res(200, { data: { id: '1', username: 'synthuser', name: 'Synth', verified: true, created_at: '2026-01-05T10:00:00.000Z', profile_image_url: 'https://example.test/a.jpg', public_metrics: { followers_count: 42 } } }),
		);
		const p = await fetchXProfile('@synthuser', { env, fetchImpl });
		expect(p).toMatchObject({ username: 'synthuser', followers: 42, verified: true, joined: '2026-01-05T10:00:00.000Z' });
		const [url, init] = fetchImpl.mock.calls[0];
		expect(String(url)).toContain('api.x.com/2/users/by/username/synthuser');
		expect(init.headers.authorization).toBe('Bearer synthetic-token');
		expect(init.headers['user-agent']).toMatch(/^three\.ws\//);
		expect(init.headers.referer).toBeUndefined();
		expect(init.headers.origin).toBeUndefined();
	});

	it('maps a 404 body to not_found and a 429 to rate_limited', async () => {
		await expect(fetchXProfile('synthuser', { env, fetchImpl: async () => res(200, { errors: [{ title: 'Not Found Error' }] }) })).rejects.toMatchObject({ reason: 'not_found' });
		await expect(fetchXProfile('synthuser', { env, fetchImpl: async () => res(429, {}) })).rejects.toMatchObject({ reason: 'rate_limited' });
	});

	it('reads a timeline into the social tweet shape', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(res(200, { data: { id: '9', username: 'synthuser' } }))
			.mockResolvedValueOnce(
				res(200, { data: [{ id: '5', text: '$SYN up', created_at: '2026-11-01T00:00:00.000Z', public_metrics: { like_count: 3, retweet_count: 1, impression_count: 90 } }] }),
			);
		const { tweets } = await fetchXTimeline('synthuser', { env, fetchImpl, limit: 20 });
		expect(tweets[0]).toMatchObject({ id: '5', text: '$SYN up', createdAt: '2026-11-01T00:00:00.000Z', author: { username: 'synthuser' }, metrics: { views: 90, likes: 3, retweets: 1 } });
	});
});
