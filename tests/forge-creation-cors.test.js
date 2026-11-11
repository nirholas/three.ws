import { describe, it, expect } from 'vitest';
import handler from '../api/forge-creation.js';

// GET /api/forge-creation is the public by-id read behind /m/<id>. Embeds on other
// origins resolve a model id to its GLB through it: the Power BI visual runs in a
// sandboxed iframe whose Origin is the literal string "null". An anonymous read must
// be answerable from there; the owner-only DELETE must stay on the strict allowlist.
function invoke(method, headers, url = '/api/forge-creation?id=not-a-uuid') {
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

describe('forge-creation CORS', () => {
	it('lets a sandboxed embed (Origin: null) read a creation anonymously', async () => {
		const got = await invoke('GET', { origin: 'null' });
		expect(got.headers['access-control-allow-origin']).toBe('*');
	});

	it('answers the GET preflight from any origin', async () => {
		const got = await invoke('OPTIONS', { origin: 'https://app.powerbi.com', 'access-control-request-method': 'GET' });
		expect(got.status).toBe(204);
		expect(got.headers['access-control-allow-origin']).toBe('*');
	});

	it('keeps DELETE off the open policy', async () => {
		const got = await invoke('OPTIONS', { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' });
		expect(got.headers['access-control-allow-origin']).toBeUndefined();
	});
});
