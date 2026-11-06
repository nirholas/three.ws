import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestServer } from './helpers/test-server.js';

// Guards the 2026-11-06 outage. HTML left the server with Express's default
// `public, max-age=0`, which Cloud CDN stores, and the backend's serve-while-stale
// window (86400s) then let the edge answer with that "expired" copy without asking
// the origin. Revision 00526 went live with no CDN purge, so /play and 253 other
// pages kept pointing at hashed chunks the new image no longer held, and every
// visitor to /play landed on "Couldn't load the world". Reloading fetched the same
// stale copy, so the card's own advice could not work.
//
// HTML names hashed assets, so it must never outlive the deploy that built it.
// `private` keeps a document out of the shared cache whatever the purge did, and
// `no-cache` makes a browser revalidate it by ETag.

const HTML_POLICY = 'private, no-cache';
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

let server;
let dist;

beforeAll(async () => {
	dist = mkdtempSync(path.join(tmpdir(), 'three-ws-dist-'));
	mkdirSync(path.join(dist, 'assets'));
	writeFileSync(path.join(dist, 'play.html'), '<!doctype html><html><head><title>play</title></head><body><script type="module" src="/assets/play-abc.js"></script></body></html>');
	// /play takes the SEO head rewrite, /agent-screen the locale rewrite, and
	// /agent-cards is in neither catalog, so it streams from disk through serveFile.
	for (const page of ['agent-screen', 'agent-cards']) {
		writeFileSync(path.join(dist, `${page}.html`), `<!doctype html><html><head><title>${page}</title></head><body></body></html>`);
	}
	writeFileSync(path.join(dist, '404.html'), '<!doctype html><title>missing</title>');
	writeFileSync(path.join(dist, 'assets', 'play-abc.js'), 'export {};\n');
	server = await startTestServer({ env: { THREE_WS_DIST_ROOT: dist } });
}, 90000);

afterAll(() => {
	server?.close();
	if (dist) rmSync(dist, { recursive: true, force: true });
});

describe('HTML stays out of the shared edge cache', () => {
	it('serves a page with a policy the CDN will not store', async () => {
		const res = await fetch(`${server.base}/play`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toMatch(/text\/html/);
		expect(res.headers.get('cache-control')).toBe(HTML_POLICY);
	}, 30000);

	it('serves a page streamed straight from disk the same way', async () => {
		const res = await fetch(`${server.base}/agent-cards`);
		expect(res.status).toBe(200);
		expect(res.headers.get('last-modified')).toBeTruthy();
		expect(res.headers.get('cache-control')).toBe(HTML_POLICY);
	}, 30000);

	// Rewritten shells are the same document with a different head, so they name
	// the same hashed chunks. A short s-maxage does not save them: once it lapses
	// the copy joins the serve-while-stale window like any other. Each case asserts
	// the rewrite ran, so a fallback to the plain shell cannot pass it by accident.
	it('applies the same policy to a coin world invite link', async () => {
		const res = await fetch(`${server.base}/play?coin=${THREE_MINT}`);
		expect(res.status).toBe(200);
		expect(await res.text()).not.toContain('<title>play</title>');
		expect(res.headers.get('cache-control')).toBe(HTML_POLICY);
	}, 30000);

	it('applies the same policy to a localized page', async () => {
		const res = await fetch(`${server.base}/agent-screen?lang=es`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('<html lang="es"');
		expect(res.headers.get('cache-control')).toBe(HTML_POLICY);
	}, 30000);

	it('keeps browser revalidation cheap: an unchanged page answers 304', async () => {
		const first = await fetch(`${server.base}/agent-cards`);
		const etag = first.headers.get('etag');
		expect(etag).toBeTruthy();
		// Raw http, not fetch: fetch adds `Cache-Control: no-cache` to a conditional
		// request, which obliges the server to answer 200 and hides what a browser gets.
		const status = await new Promise((resolve, reject) => {
			http.get(`${server.base}/agent-cards`, { headers: { 'if-none-match': etag } }, (res) => {
				res.resume();
				resolve(res.statusCode);
			}).on('error', reject);
		});
		expect(status).toBe(304);
	}, 30000);

	it('does not let the edge remember a missing hashed chunk', async () => {
		const res = await fetch(`${server.base}/assets/play-gone.js`);
		expect(res.status).toBe(404);
		expect(res.headers.get('cache-control')).toBe(HTML_POLICY);
	}, 30000);

	it('leaves hashed assets on their long immutable policy', async () => {
		const res = await fetch(`${server.base}/assets/play-abc.js`);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
	}, 30000);
});
