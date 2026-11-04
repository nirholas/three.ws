import { describe, expect, it, vi } from 'vitest';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
	DIRECTORY_CONTENT_TYPE,
	botAuthHeaders,
	directoryBody,
	loadPrivateKey,
	signDirectoryResponse,
	signRequest,
	thumbprint,
} from '../api/_lib/web-bot-auth.js';

const { privateKey } = generateKeyPairSync('ed25519');
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);

// Independent verifier: parses the headers as a site would, rebuilds the RFC 9421
// signature base from scratch and checks it against the published JWKS only.
function independentVerify({ headers, authority, jwks, now }) {
	const input = headers['Signature-Input'];
	const m = /^sig1=(\((?<comps>[^)]*)\)(?<rest>.*))$/.exec(input);
	if (!m) return { ok: false, why: 'unparseable Signature-Input' };
	const params = Object.fromEntries(
		[...m.groups.rest.matchAll(/;(\w+)=("[^"]*"|\d+)/g)].map(([, k, v]) => [k, v.replace(/"/g, '')]),
	);
	if (params.expires && Number(params.expires) <= Math.floor(now / 1000)) return { ok: false, why: 'expired' };
	const jwk = jwks.keys.find((k) => k.kid === params.keyid);
	if (!jwk) return { ok: false, why: 'unknown key' };
	const lines = m.groups.comps.split(' ').map((c) => {
		const name = c.replace(/"/g, '');
		if (name === '@authority') return `${c}: ${authority}`;
		if (name === 'signature-agent') return `${c}: ${headers['Signature-Agent']}`;
		throw new Error(`unexpected component ${name}`);
	});
	lines.push(`"@signature-params": ${input.slice('sig1='.length)}`);
	const sig = Buffer.from(/^sig1=:(.+):$/.exec(headers.Signature)[1], 'base64');
	const pub = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: 'jwk' });
	return { ok: verify(null, Buffer.from(lines.join('\n')), pub, sig), params };
}

describe('Web Bot Auth signing', () => {
	const jwks = directoryBody(privateKey);

	it('publishes an Ed25519 JWKS whose kid is the RFC 7638 thumbprint', () => {
		expect(jwks.keys).toHaveLength(1);
		const [k] = jwks.keys;
		expect(k).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
		expect(k.kid).toBe(thumbprint(k));
	});

	it('signs a request that an independent verifier accepts', () => {
		const headers = signRequest({ url: 'https://example.com/a?b=1', key: privateKey, now: NOW });
		expect(headers['Signature-Agent']).toBe('"https://three.ws"');
		expect(headers['Signature-Input']).toContain('tag="web-bot-auth"');
		expect(headers['Signature-Input']).toContain('alg="ed25519"');
		const r = independentVerify({ headers, authority: 'example.com', jwks, now: NOW + 1000 });
		expect(r.ok).toBe(true);
		expect(Number(r.params.expires) - Number(r.params.created)).toBe(300);
	});

	it('is bound to the authority: a different host fails verification', () => {
		const headers = signRequest({ url: 'https://example.com/', key: privateKey, now: NOW });
		expect(independentVerify({ headers, authority: 'evil.example', jwks, now: NOW }).ok).toBe(false);
	});

	it('rejects a tampered signature and an expired one', () => {
		const headers = signRequest({ url: 'https://example.com/', key: privateKey, now: NOW });
		const sig = headers.Signature;
		const at = 10;
		const bad = { ...headers, Signature: sig.slice(0, at) + (sig[at] === 'A' ? 'B' : 'A') + sig.slice(at + 1) };
		expect(independentVerify({ headers: bad, authority: 'example.com', jwks, now: NOW }).ok).toBe(false);
		const late = independentVerify({ headers, authority: 'example.com', jwks, now: NOW + 301_000 });
		expect(late).toEqual({ ok: false, why: 'expired' });
	});

	it('uses a fresh nonce per request', () => {
		const a = signRequest({ url: 'https://example.com/', key: privateKey, now: NOW });
		const b = signRequest({ url: 'https://example.com/', key: privateKey, now: NOW });
		expect(a['Signature-Input']).not.toBe(b['Signature-Input']);
	});

	it('signs the directory response against the request authority', () => {
		const h = signDirectoryResponse({ authority: 'three.ws', key: privateKey, now: NOW });
		expect(h['Signature-Input']).toContain('tag="http-message-signatures-directory"');
		const params = h['Signature-Input'].slice('sig1='.length);
		const base = `"@authority";req: three.ws\n"@signature-params": ${params}`;
		const sig = Buffer.from(/^sig1=:(.+):$/.exec(h.Signature)[1], 'base64');
		const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwks.keys[0].x }, format: 'jwk' });
		expect(verify(null, Buffer.from(base), pub, sig)).toBe(true);
	});
});

describe('key loading', () => {
	it('accepts a PKCS8 PEM, base64 PKCS8 DER and a base64 32-byte seed', () => {
		const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
		const der = privateKey.export({ format: 'der', type: 'pkcs8' });
		const seed = der.subarray(der.length - 32);
		const want = directoryBody(privateKey).keys[0].kid;
		for (const raw of [pem, der.toString('base64'), seed.toString('base64')]) {
			expect(directoryBody(loadPrivateKey(raw)).keys[0].kid).toBe(want);
		}
	});

	it('returns null for empty or garbage input and no headers when unconfigured', () => {
		expect(loadPrivateKey('')).toBeNull();
		expect(loadPrivateKey('not a key')).toBeNull();
		expect(botAuthHeaders('https://example.com/', { key: null })).toEqual({});
	});
});

describe('wiring', () => {
	it('keeps the agent-screen-pool copy byte-identical to the API module', () => {
		expect(readFileSync('workers/agent-screen-pool/web-bot-auth.js', 'utf8')).toBe(
			readFileSync('api/_lib/web-bot-auth.js', 'utf8'),
		);
	});

	it('routes the well-known directory path to its handler', () => {
		const routes = JSON.parse(readFileSync('vercel.json', 'utf8')).routes;
		const r = routes.find((x) => x.dest === '/api/web-bot-auth-directory');
		expect(new RegExp(`^${r.src}$`).test('/.well-known/http-message-signatures-directory')).toBe(true);
	});
});

describe('directory endpoint', () => {
	async function call(envKey, method = 'GET') {
		vi.resetModules();
		vi.stubEnv('WEB_BOT_AUTH_PRIVATE_KEY', envKey);
		const handler = (await import('../api/web-bot-auth-directory.js')).default;
		const headers = {};
		let body = '';
		const res = {
			statusCode: 0,
			headersSent: false,
			setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
			getHeader: (k) => headers[k.toLowerCase()],
			end: (b) => { body = b || ''; },
			writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => { headers[k.toLowerCase()] = v; }); },
		};
		await handler({ method, headers: { host: 'three.ws' }, url: '/.well-known/http-message-signatures-directory' }, res);
		return { res, headers, body };
	}

	it('serves the signed JWKS with the directory content type', async () => {
		const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
		const { res, headers, body } = await call(pem);
		expect(res.statusCode).toBe(200);
		expect(headers['content-type']).toBe(DIRECTORY_CONTENT_TYPE);
		expect(JSON.parse(body)).toEqual(directoryBody(privateKey));
		expect(headers.signature).toMatch(/^sig1=:.+:$/);
	});

	it('404s when no key is configured', async () => {
		const { res } = await call('');
		expect(res.statusCode).toBe(404);
	});
});
