/**
 * The Meta Muse connector domain-verification file (api/_lib/muse-challenge.js,
 * served by api/wk.js at /.well-known/muse-challenge/<file>).
 *
 * Meta hands the token out inside the logged-in submission form, so it is
 * configured on the Cloud Run service (MUSE_CHALLENGE_TOKEN, optionally
 * MUSE_CHALLENGE_FILE) rather than committed. These cases pin what the verifier
 * sees: the exact token as text/plain when configured, an honest 404 otherwise,
 * and never the SPA shell.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { museChallenge } from '../api/_lib/muse-challenge.js';

const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

describe('museChallenge', () => {
	it('is a 404 when no token is configured', () => {
		expect(museChallenge({ token: '', file: '', requested: 'abc' }).status).toBe(404);
		expect(museChallenge({ token: undefined, file: undefined, requested: '' }).status).toBe(404);
	});

	it('serves the token at any file name when no file name is configured', () => {
		for (const requested of ['', 'abc123', 'challenge.txt']) {
			expect(museChallenge({ token: 'tok_123', file: '', requested })).toEqual({ status: 200, body: 'tok_123' });
		}
	});

	it('serves the token only at the configured file name', () => {
		const cfg = { token: 'tok_123', file: 'meta-7f2a.txt' };
		expect(museChallenge({ ...cfg, requested: 'meta-7f2a.txt' })).toEqual({ status: 200, body: 'tok_123' });
		expect(museChallenge({ ...cfg, requested: 'other.txt' }).status).toBe(404);
		expect(museChallenge({ ...cfg, requested: '' }).status).toBe(404);
	});

	it('trims stray whitespace pasted into the env values', () => {
		expect(museChallenge({ token: ' tok_123\n', file: ' /meta.txt ', requested: 'meta.txt' })).toEqual({
			status: 200,
			body: 'tok_123',
		});
	});

	it('refuses a requested name that is not a plain file name', () => {
		expect(museChallenge({ token: 'tok', file: '', requested: '../etc/passwd' }).status).toBe(404);
		expect(museChallenge({ token: 'tok', file: '', requested: 'x'.repeat(300) }).status).toBe(404);
	});
});

function fakeRes() {
	const headers = {};
	return {
		statusCode: 200,
		headers,
		body: '',
		headersSent: false,
		setHeader(k, v) {
			headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b ?? '';
			this.headersSent = true;
		},
	};
}

describe('/.well-known/muse-challenge via api/wk.js', () => {
	const call = async (file) => {
		const { default: wk } = await import('../api/wk.js');
		const res = fakeRes();
		const req = {
			method: 'GET',
			url: `/api/wk?name=muse-challenge&file=${encodeURIComponent(file)}`,
			headers: { host: 'three.ws' },
			query: { name: 'muse-challenge', file },
		};
		await wk(req, res);
		return res;
	};

	it('returns the configured token as uncached text/plain', async () => {
		process.env.MUSE_CHALLENGE_TOKEN = 'tok_live_abc';
		process.env.MUSE_CHALLENGE_FILE = '';
		const res = await call('whatever');
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toMatch(/^text\/plain/);
		expect(res.headers['cache-control']).toBe('no-store');
		expect(res.body).toBe('tok_live_abc');
	});

	it('is a 404 when unconfigured', async () => {
		delete process.env.MUSE_CHALLENGE_TOKEN;
		const res = await call('whatever');
		expect(res.statusCode).toBe(404);
	});
});
