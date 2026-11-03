// redirectToLogin is shared by apiFetch's 401 handler and the avatar upload XHR
// in account.js, which has no apiFetch to lean on.
import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('redirectToLogin', () => {
	it('sends the visitor to /login with the current page as ?next', async () => {
		const loc = { pathname: '/studio', search: '?a=1', hash: '#x', href: '' };
		vi.stubGlobal('location', loc);
		const { redirectToLogin } = await import('../src/api.js');
		redirectToLogin();
		expect(loc.href).toBe('/login?next=' + encodeURIComponent('/studio?a=1#x'));
	});

	it('does not loop when already on the login page', async () => {
		const loc = { pathname: '/login', search: '', hash: '', href: '' };
		vi.stubGlobal('location', loc);
		const { redirectToLogin } = await import('../src/api.js');
		redirectToLogin();
		expect(loc.href).toBe('');
	});
});
