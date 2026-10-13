// api/_lib/shopify/session-token.js: real HS256 JWT sign/verify round trips
// (via `jose`, unmocked) for the session token App Bridge attaches to every
// embedded-app request.

import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT } from 'jose';

process.env.SHOPIFY_API_KEY = 'test-api-key';
process.env.SHOPIFY_API_SECRET = 'test-api-secret';

const { verifySessionToken, bearerFromRequest, SessionTokenError } = await import(
	'../api/_lib/shopify/session-token.js'
);

async function signToken(claims, { secret = process.env.SHOPIFY_API_SECRET, alg = 'HS256' } = {}) {
	const now = Math.floor(Date.now() / 1000);
	return new SignJWT({
		iss: 'https://example.myshopify.com/admin',
		dest: 'https://example.myshopify.com',
		aud: process.env.SHOPIFY_API_KEY,
		sub: '12345',
		sid: 'session-1',
		...claims,
	})
		.setProtectedHeader({ alg })
		.setIssuedAt(now)
		.setNotBefore(now)
		.setExpirationTime(now + 60)
		.sign(new TextEncoder().encode(secret));
}

describe('shopify session token', () => {
	it('verifies a real session token and extracts shop/user/session', async () => {
		const token = await signToken({});
		const result = await verifySessionToken(token);
		expect(result).toEqual({ shop: 'example.myshopify.com', userId: '12345', sessionId: 'session-1' });
	});

	it('rejects a token signed with a different secret', async () => {
		const token = await signToken({}, { secret: 'wrong-secret' });
		await expect(verifySessionToken(token)).rejects.toBeInstanceOf(SessionTokenError);
	});

	it('rejects a token whose aud does not match this app', async () => {
		const token = await signToken({ aud: 'some-other-app-client-id' });
		await expect(verifySessionToken(token)).rejects.toBeInstanceOf(SessionTokenError);
	});

	it('rejects a token whose iss does not match its dest shop', async () => {
		const token = await signToken({ iss: 'https://attacker.myshopify.com/admin' });
		await expect(verifySessionToken(token)).rejects.toBeInstanceOf(SessionTokenError);
	});

	it('rejects an expired token', async () => {
		const now = Math.floor(Date.now() / 1000) - 120;
		const token = await new SignJWT({
			iss: 'https://example.myshopify.com/admin',
			dest: 'https://example.myshopify.com',
			aud: process.env.SHOPIFY_API_KEY,
			sub: '12345',
			sid: 'session-1',
		})
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt(now)
			.setExpirationTime(now + 60)
			.sign(new TextEncoder().encode(process.env.SHOPIFY_API_SECRET));
		await expect(verifySessionToken(token)).rejects.toBeInstanceOf(SessionTokenError);
	});

	it('rejects missing/malformed tokens without throwing an unrelated error', async () => {
		await expect(verifySessionToken('')).rejects.toBeInstanceOf(SessionTokenError);
		await expect(verifySessionToken('not-a-jwt')).rejects.toBeInstanceOf(SessionTokenError);
	});
});

describe('bearerFromRequest', () => {
	it('extracts the token from a well-formed Authorization header', () => {
		expect(bearerFromRequest({ headers: { authorization: 'Bearer abc.def.ghi' } })).toBe('abc.def.ghi');
	});

	it('returns empty string when the header is missing or malformed', () => {
		expect(bearerFromRequest({ headers: {} })).toBe('');
		expect(bearerFromRequest({ headers: { authorization: 'Basic xyz' } })).toBe('');
	});
});
