// The PowerPoint add-in's pure core (src/office-powerpoint/core.js): PKCE,
// the authorize URL, reading the sign-in callback, base64 for
// insertSlidesFromBase64, reading a free-lane result and the export URL.

import { webcrypto } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
	authorizeUrl,
	base64url,
	bytesToBase64,
	createPkce,
	endpointOn,
	exportUrl,
	needsRefresh,
	readAuthCallback,
	readGeneration,
	readPollFrame,
} from '../src/office-powerpoint/core.js';

describe('base64 helpers', () => {
	it('base64url has no padding or unsafe characters', () => {
		expect(base64url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
		expect(base64url(new Uint8Array([1]))).toBe('AQ');
	});

	it('bytesToBase64 matches Node for large buffers, chunk by chunk', () => {
		const bytes = new Uint8Array(200_003).map((_, i) => (i * 7919) % 256);
		expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
		expect(bytesToBase64(new Uint8Array())).toBe('');
	});
});

describe('createPkce', () => {
	it('derives the S256 challenge from the verifier (RFC 7636 appendix B)', async () => {
		const verifierBytes = new Uint8Array([
			116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214,
			191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
		]);
		const pkce = await createPkce(webcrypto, verifierBytes);
		expect(pkce.verifier).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
		expect(pkce.challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
	});

	it('makes a fresh 43-character verifier when none is given', async () => {
		const a = await createPkce(webcrypto);
		const b = await createPkce(webcrypto);
		expect(a.verifier).toHaveLength(43);
		expect(a.verifier).not.toBe(b.verifier);
	});
});

describe('endpointOn', () => {
	it('keeps the discovered path but answers on the pane origin', () => {
		expect(endpointOn('http://localhost:3102', 'https://three.ws/api/oauth/token')).toBe('http://localhost:3102/api/oauth/token');
		expect(endpointOn('https://three.ws', '/oauth/authorize')).toBe('https://three.ws/oauth/authorize');
	});
});

describe('authorizeUrl', () => {
	it('carries every PKCE and resource parameter', () => {
		const url = new URL(
			authorizeUrl('https://three.ws/oauth/authorize', {
				clientId: 'c1',
				redirectUri: 'https://three.ws/office/powerpoint/auth',
				scope: 'profile avatars:read',
				state: 's1',
				challenge: 'ch',
				resource: 'https://three.ws/api/mcp',
			}),
		);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			response_type: 'code',
			client_id: 'c1',
			redirect_uri: 'https://three.ws/office/powerpoint/auth',
			scope: 'profile avatars:read',
			state: 's1',
			code_challenge: 'ch',
			code_challenge_method: 'S256',
			resource: 'https://three.ws/api/mcp',
		});
	});
});

describe('readAuthCallback', () => {
	const base = 'https://three.ws/office/powerpoint/auth';

	it('returns the code when the state matches', () => {
		expect(readAuthCallback(`${base}?code=abc&state=s1`, 's1')).toEqual({ code: 'abc' });
	});

	it('refuses a mismatched state', () => {
		expect(readAuthCallback(`${base}?code=abc&state=other`, 's1').error).toMatch(/did not match/);
	});

	it('explains a cancelled sign-in and other errors', () => {
		expect(readAuthCallback(`${base}?error=access_denied&state=s1`, 's1').error).toMatch(/cancelled/);
		expect(readAuthCallback(`${base}?error=server_error&state=s1`, 's1').error).toMatch(/server_error/);
		expect(readAuthCallback(`${base}?state=s1`, 's1').error).toMatch(/No sign-in code/);
	});
});

describe('needsRefresh', () => {
	it('refreshes within 90 seconds of expiry', () => {
		expect(needsRefresh({ expires_at: 1_000_000 }, 1_000_000 - 120_000)).toBe(false);
		expect(needsRefresh({ expires_at: 1_000_000 }, 1_000_000 - 60_000)).toBe(true);
		expect(needsRefresh(null)).toBe(true);
	});
});

describe('readGeneration', () => {
	it('reads a finished model', () => {
		const rpc = { result: { structuredContent: { glbUrl: 'https://three.ws/cdn/forge/x.glb', prompt: 'a lantern', viewerUrl: 'v' } } };
		expect(readGeneration(rpc)).toEqual({ status: 'done', glbUrl: 'https://three.ws/cdn/forge/x.glb', prompt: 'a lantern', viewerUrl: 'v' });
	});

	it('reads a job still running', () => {
		const rpc = { result: { structuredContent: { status: 'pending', jobId: 'j1', pollUrl: 'https://three.ws/api/gpt-forge?job=j1', progress: 0.3, eta_seconds: 40 } } };
		expect(readGeneration(rpc)).toEqual({ status: 'pending', jobId: 'j1', pollUrl: 'https://three.ws/api/gpt-forge?job=j1', progress: 0.3, etaSeconds: 40 });
	});

	it('reads a tool error and a rate limit', () => {
		expect(readGeneration({ result: { isError: true, structuredContent: { error: true, message: 'Busy.' } } })).toEqual({ status: 'error', message: 'Busy.' });
		const limited = readGeneration({ error: { code: -32029, message: 'Rate limited: ...', data: { reason: 'rate_limited', retry_after: 120 } } });
		expect(limited).toMatchObject({ status: 'error', retryAfter: 120 });
		expect(limited.message).toMatch(/2 minutes/);
	});
});

describe('readPollFrame', () => {
	it('reads done, failed, unknown and running frames from /api/gpt-forge', () => {
		expect(readPollFrame({ status: 'done', glb_url: 'https://three.ws/cdn/x.glb' })).toEqual({ status: 'done', glbUrl: 'https://three.ws/cdn/x.glb' });
		expect(readPollFrame({ status: 'failed', error: 'The GPU worker crashed.' })).toEqual({ status: 'error', message: 'The GPU worker crashed.' });
		expect(readPollFrame({ error: 'unknown_job', message: 'That job id is not recognized.' }).message).toBe('That job id is not recognized.');
		expect(readPollFrame({ status: 'running', progress: 0.5, eta_remaining_seconds: 30 })).toEqual({ status: 'pending', progress: 0.5, etaSeconds: 30 });
	});
});

describe('exportUrl', () => {
	it('names a stored creation by id and a fresh one by its GLB URL', () => {
		expect(exportUrl('https://three.ws', { id: 'abc' })).toBe('https://three.ws/api/forge/export-pptx?id=abc');
		expect(exportUrl('https://three.ws', { src: 'https://three.ws/cdn/a b.glb', title: 'A & B' })).toBe(
			'https://three.ws/api/forge/export-pptx?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fa+b.glb&title=A+%26+B',
		);
	});
});
