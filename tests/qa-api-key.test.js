import { describe, expect, it } from 'vitest';
import { cookieHeader, keyRequestBody } from '../scripts/lib/qa-api-key.mjs';

describe('qa-api-key', () => {
	it('sends back only the name=value part of each Set-Cookie', () => {
		expect(
			cookieHeader(['session=abc; Path=/; HttpOnly; Secure', 'csrf=xyz; SameSite=Lax', '']),
		).toBe('session=abc; csrf=xyz');
	});

	it('asks for a connector key that expires after the given time', () => {
		const body = keyRequestBody('smoke', 3600_000, Date.parse('2026-11-20T12:00:00Z'));
		expect(body).toEqual({ name: 'smoke', preset: 'connector', expires_at: '2026-11-20T13:00:00.000Z' });
	});
});
