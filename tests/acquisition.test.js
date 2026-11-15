import { describe, it, expect } from 'vitest';

import { TOUCH_COOKIE, acquisitionMiddleware, broughtSignup, decodeTouch, encodeTouch, landingPath, referralSource } from '../api/_lib/acquisition.js';

const AT = Date.parse('2026-11-15T15:00:00Z');

function fakeRes() {
	const headers = {};
	return { headers, getHeader: (name) => headers[name], setHeader: (name, value) => (headers[name] = value) };
}

const nav = (extra = {}) => ({ method: 'GET', path: '/forge', headers: { 'sec-fetch-dest': 'document', ...extra } });

async function run(middleware, req) {
	const res = fakeRes();
	let nexted = 0;
	await middleware(req, res, () => nexted++);
	expect(nexted).toBe(1);
	return [res.headers['set-cookie'] || []].flat();
}

describe('referral source', () => {
	it('names X for t.co, x.com and twitter.com, and nothing else', () => {
		expect(referralSource('https://t.co/abc123')).toBe('x');
		expect(referralSource('https://x.com/trythreews/status/1')).toBe('x');
		expect(referralSource('https://mobile.twitter.com/')).toBe('x');
		expect(referralSource('https://notx.com/')).toBeNull();
		expect(referralSource('https://three.ws/forge')).toBeNull();
		expect(referralSource('')).toBeNull();
	});

	it('keeps only a bounded path, never a query that could carry a token', () => {
		expect(landingPath('/forge?token=secret#x')).toBe('/forge');
		expect(landingPath('/a b<script>')).toBe('/abscript');
		const touch = decodeTouch(encodeTouch({ source: 'x', landing: '/docs/mcp-studio?x=1', at: AT }));
		expect(touch).toEqual({ source: 'x', landing: '/docs/mcp-studio', at: AT });
		expect(decodeTouch('x.!!.1')).toBeNull();
	});
});

describe('acquisition middleware', () => {
	it('drops a 30-day first-touch cookie on a page load from X, and nothing on assets or other referrers', async () => {
		const mw = acquisitionMiddleware({ now: () => AT });
		const [line] = await run(mw, nav({ referer: 'https://t.co/abc' }));
		expect(line).toMatch(new RegExp(`^${TOUCH_COOKIE}=x\\.[A-Za-z0-9_-]+\\.\\d+; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$`));
		expect(decodeTouch(line.split(';')[0].split('=')[1])).toEqual({ source: 'x', landing: '/forge', at: AT });
		expect(await run(mw, { method: 'GET', path: '/assets/a.js', headers: { 'sec-fetch-dest': 'script', referer: 'https://t.co/abc' } })).toEqual([]);
		expect(await run(mw, nav({ referer: 'https://google.com/' }))).toEqual([]);
	});

	it('keeps the first touch: a second visit from X does not overwrite it', async () => {
		const cookie = `${TOUCH_COOKIE}=${encodeTouch({ source: 'x', landing: '/genesis', at: AT })}`;
		expect(await run(acquisitionMiddleware({ now: () => AT + 1000 }), nav({ referer: 'https://t.co/b', cookie }))).toEqual([]);
	});

	it('records an account created after the touch as an X signup, then clears the cookie', async () => {
		const recorded = [];
		const mw = acquisitionMiddleware({
			hasSession: () => true,
			sessionUser: async () => ({ id: 'u1', created_at: new Date(AT + 60_000).toISOString() }),
			record: async (row) => recorded.push(row),
		});
		const cookie = `${TOUCH_COOKIE}=${encodeTouch({ source: 'x', landing: '/genesis', at: AT })}; __Host-sid=abc`;
		const lines = await run(mw, nav({ cookie }));
		expect(recorded).toEqual([{ userId: 'u1', source: 'x', landing: '/genesis', at: AT }]);
		expect(lines).toEqual([`${TOUCH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`]);
	});

	it('does not credit X for an existing account that clicked through, but still clears the cookie', async () => {
		const recorded = [];
		const mw = acquisitionMiddleware({ hasSession: () => true, sessionUser: async () => ({ id: 'old', created_at: '2026-01-01T00:00:00Z' }), record: async (row) => recorded.push(row) });
		const lines = await run(mw, nav({ cookie: `${TOUCH_COOKIE}=${encodeTouch({ source: 'x', landing: '/', at: AT })}` }));
		expect(recorded).toEqual([]);
		expect(lines[0]).toMatch(/Max-Age=0/);
	});

	it('never fails the request when the database does', async () => {
		const mw = acquisitionMiddleware({ hasSession: () => true, sessionUser: async () => { throw new Error('db down'); } });
		expect(await run(mw, nav({ cookie: `${TOUCH_COOKIE}=${encodeTouch({ source: 'x', landing: '/', at: AT })}` }))).toEqual([]);
	});

	it('only credits signups inside the cookie lifetime', () => {
		expect(broughtSignup({ at: AT }, new Date(AT - 1).toISOString())).toBe(false);
		expect(broughtSignup({ at: AT }, new Date(AT + 31 * 86_400_000).toISOString())).toBe(false);
		expect(broughtSignup({ at: AT }, 'not a date')).toBe(false);
	});
});
