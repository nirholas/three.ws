// Meetup #3 client audit (auth failure states): the /play sign-in gate showed
// the raw "Failed to fetch" or "HTTP 502" when the community API was
// unreachable or down. A player at an event needs to know what happened and
// what to do, so the boundary turns those into plain, actionable messages and
// keeps the status and code for callers that branch on them.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSession } from '../src/community/town-auth.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('town-auth network boundary', () => {
	it('explains an unreachable API instead of "Failed to fetch"', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
		const err = await getSession().catch((e) => e);
		expect(err.message).not.toMatch(/failed to fetch/i);
		expect(err.message).toMatch(/connection/i);
		expect(err.code).toBe('network');
	});

	it('explains a server error instead of a bare "HTTP 502"', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));
		const err = await getSession().catch((e) => e);
		expect(err.message).not.toMatch(/^HTTP 502$/);
		expect(err.message).toMatch(/try again/i);
		expect(err.status).toBe(502);
	});

	it('keeps the server description when the API gives one', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unauthorized', error_description: 'Sign in with X first.' }, { status: 401 })));
		const err = await getSession().catch((e) => e);
		expect(err.message).toBe('Sign in with X first.');
		expect(err.code).toBe('unauthorized');
	});
});
