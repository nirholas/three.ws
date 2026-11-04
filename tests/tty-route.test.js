// `curl https://three.ws/tty` printed the HTML page for about half an hour after
// any browser visit, because the HTML variant of /tty was cached by the CDN
// without Vary: Accept, so the cached copy answered text clients too. The route
// table is the one place that decides which variant a request gets.
import { describe, it, expect } from 'vitest';
import { loadRouteTable, resolvePhase1 } from '../server/route-resolve.mjs';

const { phase1Routes } = loadRouteTable(new URL('../vercel.json', import.meta.url).pathname);
const resolve = (headers) =>
	resolvePhase1(phase1Routes, { method: 'GET', headers }, new URL('http://x/tty'));

describe('/tty content negotiation', () => {
	it('serves the text renderer to curl and to any non-HTML Accept', () => {
		expect(resolve({ accept: '*/*', 'user-agent': 'curl/8.5.0' }).path).toBe('/api/tty');
		expect(resolve({ 'user-agent': 'curl/8.5.0' }).path).toBe('/api/tty');
	});

	it('serves the HTML page to browsers', () => {
		expect(resolve({ accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }).path).toBe('/tty.html');
	});

	it('marks the HTML variant as varying on Accept and keeps it out of shared caches', () => {
		const r = resolve({ accept: 'text/html' });
		const headers = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v]));
		expect(headers.vary).toMatch(/\bAccept\b/);
		expect(headers['cache-control']).toMatch(/private|no-store/);
	});

	it('marks the text variant as varying on Accept too', () => {
		const r = resolve({ accept: '*/*' });
		const headers = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v]));
		expect(headers.vary).toMatch(/\bAccept\b/);
	});
});
