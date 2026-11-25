// The Arena page's JSON fetch returned null for a 2xx response whose body was
// not JSON (a proxy's HTML page, an empty 200), and the marquee then read
// `data.standings` off that null: "Cannot read properties of null (reading
// 'standings')" in production on 2026-11-25. Every caller already handles a
// thrown error, so an unreadable success body has to throw like a failed status
// does, never come back as null.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchJSON } from '../src/arena/fetch-json.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubFetch(response) {
	const calls = [];
	vi.stubGlobal('fetch', async (url, init) => {
		calls.push({ url, init });
		return response;
	});
	return calls;
}

describe('arena fetchJSON', () => {
	it('returns the parsed body of a JSON success', async () => {
		const calls = stubFetch(new Response(JSON.stringify({ standings: [{ rank: 1 }] }), { status: 200 }));
		await expect(fetchJSON('/api/tournaments/t1')).resolves.toEqual({ standings: [{ rank: 1 }] });
		expect(calls[0].init.credentials).toBe('include');
	});

	it('throws on a success whose body is not JSON instead of returning null', async () => {
		stubFetch(new Response('<!doctype html><title>portal</title>', { status: 200 }));
		const err = await fetchJSON('/api/tournaments/t1').catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.status).toBe(200);
	});

	it('throws on an empty success body', async () => {
		stubFetch(new Response('', { status: 200 }));
		await expect(fetchJSON('/api/tournaments/t1')).rejects.toThrow();
	});

	it('throws with the API error description on a failed status', async () => {
		stubFetch(new Response(JSON.stringify({ error: 'not_found', error_description: 'no such tournament' }), { status: 404 }));
		const err = await fetchJSON('/api/tournaments/nope').catch((e) => e);
		expect(err.message).toBe('no such tournament');
		expect(err.status).toBe(404);
		expect(err.code).toBe('not_found');
	});
});
