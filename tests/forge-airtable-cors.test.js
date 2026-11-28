import { describe, it, expect } from 'vitest';
import forge from '../api/forge.js';
import apiKeys from '../api/api-keys.js';

// The three.ws Airtable extension (integrations/airtable) runs inside an Airtable
// block iframe, whose origin is an Airtable-generated *.airtableblocks.com host
// (a devblock--… subdomain under `block run`, a blk… host once released). It calls
// POST /api/forge and GET /api/forge?job= with the user's own three.ws API key as a
// bearer, so those two calls must pass CORS from there. Nothing else should: the
// allowance is scoped to Forge, never added to the shared default allowlist.
function invoke(handler, method, headers, url) {
	return new Promise((resolve) => {
		const sent = {};
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader(k, v) { sent[k.toLowerCase()] = v; },
			getHeader(k) { return sent[k.toLowerCase()]; },
			removeHeader(k) { delete sent[k.toLowerCase()]; },
			writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; },
			write() { return true; },
			end(body) { this.headersSent = true; resolve({ status: this.statusCode, headers: sent, body: body ? String(body) : '' }); },
		};
		handler({ method, url, headers: { host: 'three.ws', ...headers }, socket: { remoteAddress: '127.0.0.1' } }, res);
	});
}

const preflight = (handler, origin, url = '/api/forge') =>
	invoke(handler, 'OPTIONS', { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type, x-forge-client' }, url);

describe('Forge CORS for the Airtable extension', () => {
	it('answers the preflight from a released block origin', async () => {
		const origin = 'https://blkq3e5Ab1cD2eF3g.airtableblocks.com';
		const got = await preflight(forge, origin);
		expect(got.status).toBe(204);
		expect(got.headers['access-control-allow-origin']).toBe(origin);
		expect(got.headers['access-control-allow-headers']).toMatch(/authorization/);
		expect(got.headers['access-control-allow-credentials']).toBeUndefined();
	});

	it('answers the preflight from a development block origin', async () => {
		const origin = 'https://devblock--blkq3e5ab1cd2ef3g--9f2c.alt.airtableblocks.com';
		const got = await preflight(forge, origin);
		expect(got.headers['access-control-allow-origin']).toBe(origin);
	});

	it('refuses look-alike and plain-http origins', async () => {
		for (const origin of [
			'https://airtableblocks.com.evil.example',
			'https://evilairtableblocks.com',
			'http://blkq3e5ab1cd2ef3g.airtableblocks.com',
		]) {
			const got = await preflight(forge, origin);
			expect(got.headers['access-control-allow-origin'], origin).toBeUndefined();
		}
	});

	it('does not open other endpoints to block origins', async () => {
		const got = await preflight(apiKeys, 'https://blkq3e5ab1cd2ef3g.airtableblocks.com', '/api/api-keys');
		expect(got.headers['access-control-allow-origin']).toBeUndefined();
	});
});
