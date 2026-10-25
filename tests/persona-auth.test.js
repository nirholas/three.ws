// The persona token's audience is the tenant origin the user authorises, so
// the origin check must be an exact host match: a lookalike host that merely
// starts with a loopback name must not pass.

import { describe, it, expect, vi } from 'vitest';

process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';
vi.mock('../api/_lib/db.js', () => ({ sql: async () => [] }));
vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));

const { validateTenantOrigin } = await import('../api/auth/persona/[action].js');

describe('validateTenantOrigin', () => {
	it.each([
		'http://127.0.0.1.attacker.test',
		'http://127.0.0.1.attacker.test:8080',
		'http://localhost.attacker.test',
		'http://localhost.attacker.test:3000',
		'http://127.0.0.10',
		'https://three.ws.attacker.test',
		'https://evilthree.ws',
	])('rejects %s', (origin) => {
		expect(validateTenantOrigin(origin)).toBeNull();
	});

	it.each([
		['http://localhost', 'http://localhost'],
		['http://localhost:3000', 'http://localhost:3000'],
		['http://127.0.0.1:5173', 'http://127.0.0.1:5173'],
		['http://127.0.0.1', 'http://127.0.0.1'],
		['https://three.ws', 'https://three.ws'],
		['https://app.three.ws', 'https://app.three.ws'],
	])('accepts %s', (origin, expected) => {
		expect(validateTenantOrigin(origin)).toBe(expected);
	});
});
