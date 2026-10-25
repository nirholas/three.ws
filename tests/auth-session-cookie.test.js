// Only the __Host- prefixed session cookie is honoured. The legacy unprefixed
// `sid` cookie can be planted by any sibling subdomain (Domain=three.ws), so
// accepting it would allow session fixation.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const { hasSessionCookie, sessionCookie } = await import('../api/_lib/auth.js');

const req = (cookie) => ({ headers: { cookie } });

describe('session cookie reading', () => {
	it('accepts the __Host-sid cookie', () => {
		expect(hasSessionCookie(req('a=1; __Host-sid=token'))).toBe(true);
	});

	it('ignores the legacy unprefixed sid cookie', () => {
		expect(hasSessionCookie(req('sid=planted-by-sibling-subdomain'))).toBe(false);
		expect(hasSessionCookie(req('x=1; sid=planted'))).toBe(false);
	});

	it('still clears the legacy cookie on logout', () => {
		expect(sessionCookie('', { clear: true }).some((c) => c.startsWith('sid='))).toBe(true);
	});
});
