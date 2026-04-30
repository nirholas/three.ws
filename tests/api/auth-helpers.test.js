// Unit tests for auth.js helpers: JWT minting/verification and CSRF tokens.
// Uses real jose and real HMAC — no mocks needed for pure crypto functions.

import { describe, it, expect, vi } from 'vitest';

process.env.PUBLIC_APP_ORIGIN ||= 'https://app.test';
process.env.JWT_SECRET ||= 'test-auth-helpers-secret-at-least-32ch';

// db.js is lazy (Proxy), but mock it to prevent accidental real connections.
vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
}));

const { mintAccessToken, authenticateBearer, csrfTokenFor, verifyCsrfToken } =
	await import('../../api/_lib/auth.js');

const AUDIENCE = 'https://app.test/api/mcp';
const ISSUER = 'https://app.test';

// ── mintAccessToken ───────────────────────────────────────────────────────────

describe('mintAccessToken', () => {
	it('returns a signed JWT string', async () => {
		const token = await mintAccessToken({
			userId: 'user-1',
			clientId: 'mcp_test',
			scope: 'avatars:read',
			resource: AUDIENCE,
		});
		expect(typeof token).toBe('string');
		expect(token.split('.').length).toBe(3);
	});

	it('embeds correct sub, scope, aud, and exp claims', async () => {
		const token = await mintAccessToken({
			userId: 'user-42',
			clientId: 'mcp_test',
			scope: 'avatars:read profile',
			resource: AUDIENCE,
		});
		const [, payloadB64] = token.split('.');
		const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

		expect(payload.sub).toBe('user-42');
		expect(payload.scope).toBe('avatars:read profile');
		expect(payload.aud).toBe(AUDIENCE);
		expect(payload.iss).toBe(ISSUER);
		expect(typeof payload.exp).toBe('number');
		expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
		expect(payload.exp - payload.iat).toBe(3600);
	});

	it('uses env.MCP_RESOURCE as audience when resource is omitted', async () => {
		const token = await mintAccessToken({
			userId: 'user-3',
			clientId: 'mcp_test',
			scope: 'profile',
		});
		const [, payloadB64] = token.split('.');
		const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
		expect(payload.aud).toBe(AUDIENCE);
	});
});

// ── authenticateBearer ────────────────────────────────────────────────────────

describe('authenticateBearer', () => {
	it('returns { userId, scope, source, clientId } for a valid JWT', async () => {
		const token = await mintAccessToken({
			userId: 'user-abc',
			clientId: 'mcp_pub',
			scope: 'avatars:read',
			resource: AUDIENCE,
		});
		const result = await authenticateBearer(token);
		expect(result).not.toBeNull();
		expect(result.userId).toBe('user-abc');
		expect(result.scope).toBe('avatars:read');
		expect(result.source).toBe('oauth');
		expect(result.clientId).toBe('mcp_pub');
	});

	it('returns null for null token', async () => {
		expect(await authenticateBearer(null)).toBeNull();
	});

	it('returns null for undefined token', async () => {
		expect(await authenticateBearer(undefined)).toBeNull();
	});

	it('returns null for a tampered signature', async () => {
		const token = await mintAccessToken({
			userId: 'user-abc',
			clientId: 'mcp_pub',
			scope: 'avatars:read',
			resource: AUDIENCE,
		});
		const parts = token.split('.');
		// Flip the last 4 chars of the signature segment.
		parts[2] = parts[2].slice(0, -4) + 'XXXX';
		const tampered = parts.join('.');
		expect(await authenticateBearer(tampered)).toBeNull();
	});

	it('returns null for an expired JWT', async () => {
		// Mint a token with past expiry using jose directly.
		const { SignJWT } = await import('jose');
		const key = new TextEncoder().encode(process.env.JWT_SECRET);
		const now = Math.floor(Date.now() / 1000);
		const expired = await new SignJWT({ scope: 'avatars:read', client_id: 'mcp_test' })
			.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
			.setIssuer(ISSUER)
			.setSubject('user-expired')
			.setAudience(AUDIENCE)
			.setIssuedAt(now - 7200)
			.setExpirationTime(now - 3600)
			.sign(key);
		expect(await authenticateBearer(expired)).toBeNull();
	});

	it('returns null for a JWT signed with a different secret', async () => {
		const { SignJWT } = await import('jose');
		const wrongKey = new TextEncoder().encode('wrong-secret-totally-different-key!!');
		const now = Math.floor(Date.now() / 1000);
		const badToken = await new SignJWT({ scope: 'avatars:read', client_id: 'mcp_test' })
			.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
			.setIssuer(ISSUER)
			.setSubject('user-bad')
			.setAudience(AUDIENCE)
			.setIssuedAt(now)
			.setExpirationTime(now + 3600)
			.sign(wrongKey);
		expect(await authenticateBearer(badToken)).toBeNull();
	});
});

// ── csrfTokenFor + verifyCsrfToken ────────────────────────────────────────────

describe('csrfTokenFor', () => {
	it('returns an HMAC string when session cookie is present', async () => {
		const req = { headers: { cookie: '__Host-sid=my-session-abc' } };
		const csrf = await csrfTokenFor(req);
		expect(typeof csrf).toBe('string');
		expect(csrf.length).toBeGreaterThan(0);
	});

	it('returns null when no session cookie is present', async () => {
		const req = { headers: { cookie: '' } };
		expect(await csrfTokenFor(req)).toBeNull();
	});

	it('returns null when cookie header is missing entirely', async () => {
		const req = { headers: {} };
		expect(await csrfTokenFor(req)).toBeNull();
	});
});

describe('verifyCsrfToken', () => {
	it('round-trip: generated token passes verification against the same session', async () => {
		const req = { headers: { cookie: '__Host-sid=session-token-xyz' } };
		const csrf = await csrfTokenFor(req);
		expect(await verifyCsrfToken(req, csrf)).toBe(true);
	});

	it('returns false when submitted token is for a different session', async () => {
		const req1 = { headers: { cookie: '__Host-sid=session-one' } };
		const csrf1 = await csrfTokenFor(req1);
		const req2 = { headers: { cookie: '__Host-sid=session-two' } };
		expect(await verifyCsrfToken(req2, csrf1)).toBe(false);
	});

	it('returns false for null submitted token', async () => {
		const req = { headers: { cookie: '__Host-sid=some-session' } };
		expect(await verifyCsrfToken(req, null)).toBe(false);
	});

	it('returns false for empty submitted token', async () => {
		const req = { headers: { cookie: '__Host-sid=some-session' } };
		expect(await verifyCsrfToken(req, '')).toBe(false);
	});

	it('returns false when no session cookie exists on the request', async () => {
		const req = { headers: {} };
		expect(await verifyCsrfToken(req, 'some-csrf-token')).toBe(false);
	});

	it('accepts the legacy "sid" cookie name', async () => {
		const req = { headers: { cookie: 'sid=legacy-session-token' } };
		const csrf = await csrfTokenFor(req);
		expect(typeof csrf).toBe('string');
		expect(await verifyCsrfToken(req, csrf)).toBe(true);
	});
});
