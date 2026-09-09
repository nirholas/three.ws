import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'node:http';
import { startTestServer } from './helpers/test-server.js';

// `www.three.ws` resolves to the same load balancer as the apex and served the
// same app, which reads as harmless until media is involved. The apex is the
// only origin the platform declares (server/seo-head.mjs pins every canonical
// URL to it) and the only origin the media bucket's CORS read rule allowlists,
// so a page loaded from www got its GLB URLs from the API and then had every
// one of them blocked by the browser.
//
// Measured 2026-09-09 against the live bucket, same object, before the fix:
//   Origin: https://three.ws      -> Access-Control-Allow-Origin: https://three.ws
//   Origin: https://www.three.ws  -> (no Access-Control-Allow-Origin)
//
// The server now collapses the duplicate host onto the canonical one. Any other
// host has to pass through untouched: Cloud Run's own *.run.app URL answers the
// health probe, and dev.three.ws is a real testing host.

let server;
let PORT;

beforeAll(async () => {
	server = await startTestServer();
	PORT = server.port;
}, 30000);

afterAll(() => {
	server?.close();
});

/** Raw request with an explicit Host header, which fetch() refuses to set. */
function withHost(host, pathname, method = 'GET') {
	return new Promise((resolve, reject) => {
		const req = request(
			{ host: '127.0.0.1', port: PORT, path: pathname, method, headers: { host } },
			(res) => {
				res.resume();
				resolve({ status: res.statusCode, location: res.headers.location });
			},
		);
		req.on('error', reject);
		req.end();
	});
}

describe('canonical host redirect', () => {
	it('sends a www page request to the apex, permanently', async () => {
		const res = await withHost('www.three.ws', '/create');
		expect(res.status).toBe(301);
		expect(res.location).toBe('https://three.ws/create');
	});

	it('preserves the query string', async () => {
		const res = await withHost('www.three.ws', '/marketplace?sort=new&page=2');
		expect(res.location).toBe('https://three.ws/marketplace?sort=new&page=2');
	});

	it('ignores the port in the Host header', async () => {
		const res = await withHost('www.three.ws:443', '/');
		expect(res.status).toBe(301);
		expect(res.location).toBe('https://three.ws/');
	});

	it('matches the host case-insensitively', async () => {
		const res = await withHost('WWW.Three.WS', '/');
		expect(res.status).toBe(301);
	});

	it('keeps the method and body on an API write with a 308', async () => {
		const res = await withHost('www.three.ws', '/api/forge-upload', 'POST');
		expect(res.status).toBe(308);
		expect(res.location).toBe('https://three.ws/api/forge-upload');
	});

	it('never rewrites the origin out of an absolute-form request target', async () => {
		const res = await withHost('www.three.ws', 'http://evil.example/steal?a=1');
		expect(res.location).toBe('https://three.ws/steal?a=1');
	});

	it('leaves the apex alone', async () => {
		const res = await withHost('three.ws', '/api/healthz');
		expect(res.status).toBe(200);
	});

	it('leaves every other host alone, including Cloud Run and dev', async () => {
		for (const host of ['three-ws-api-abc123-uc.a.run.app', 'dev.three.ws', 'localhost']) {
			const res = await withHost(host, '/api/healthz');
			expect(res.status, host).toBe(200);
		}
	});
});
