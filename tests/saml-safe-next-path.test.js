// SAML RelayState / ?next= must not allow backslash or control-char open redirects.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/env.js', () => ({ env: new Proxy({}, { get: () => 'x' }) }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn() }));

const { safeNextPath } = await import('../api/_lib/saml.js');

describe('saml safeNextPath', () => {
	it('keeps same-origin paths', () => {
		expect(safeNextPath('/dashboard?a=1')).toBe('/dashboard?a=1');
	});
	it('rejects protocol-relative, backslash and control-char redirects', () => {
		for (const bad of ['//evil.com', '/\\evil.com', '/\\/evil.com', '/\t/evil.com', 'https://evil.com', '/\n/evil.com']) {
			expect(safeNextPath(bad, '/x')).toBe('/x');
		}
	});
});
