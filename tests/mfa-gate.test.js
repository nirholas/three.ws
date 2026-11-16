// server/mfa-gate.mjs: page loads that carry a pending two-step sign-in go to
// /login/verify; APIs, assets and the login pages themselves never do.

import { describe, it, expect } from 'vitest';
import { needsMfaRedirect, mfaRedirectLocation, mfaGateMiddleware } from '../server/mfa-gate.mjs';

const PENDING = '__Host-sid=mfa_abc123; theme=dark';
const page = (url, headers = {}) => ({
	method: 'GET',
	url,
	headers: { cookie: PENDING, accept: 'text/html,application/xhtml+xml', 'sec-fetch-dest': 'document', ...headers },
});

describe('needsMfaRedirect', () => {
	it('redirects a page navigation carrying a pending session', () => {
		expect(needsMfaRedirect(page('/dashboard'))).toBe(true);
		expect(needsMfaRedirect(page('/teams/42?tab=people'))).toBe(true);
		expect(needsMfaRedirect(page('/dashboard', { cookie: 'sid=mfa_x' }))).toBe(true);
		expect(needsMfaRedirect(page('/', { 'sec-fetch-dest': undefined }))).toBe(true);
	});

	it('leaves full sessions and signed-out visitors alone', () => {
		expect(needsMfaRedirect(page('/dashboard', { cookie: '__Host-sid=abc123' }))).toBe(false);
		expect(needsMfaRedirect(page('/dashboard', { cookie: 'other=mfa_x' }))).toBe(false);
		expect(needsMfaRedirect(page('/dashboard', { cookie: undefined }))).toBe(false);
	});

	it('never redirects APIs, login pages, assets or non-navigations', () => {
		for (const url of ['/api/auth/me', '/login', '/login/verify?next=%2F', '/logout', '/assets/app.js', '/src/main.js', '/.well-known/security.txt', '/logo.svg', '/favicon.ico']) {
			expect(needsMfaRedirect(page(url))).toBe(false);
		}
		expect(needsMfaRedirect({ ...page('/dashboard'), method: 'POST' })).toBe(false);
		expect(needsMfaRedirect(page('/dashboard', { 'sec-fetch-dest': 'empty' }))).toBe(false);
		expect(needsMfaRedirect(page('/dashboard', { 'sec-fetch-dest': undefined, accept: 'application/json' }))).toBe(false);
	});
});

describe('mfaGateMiddleware', () => {
	it('sends a 302 to /login/verify with the original path as next', () => {
		const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end() { this.ended = true; } };
		let passed = false;
		mfaGateMiddleware()(page('/teams/42?tab=people'), res, () => { passed = true; });
		expect(passed).toBe(false);
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe('/login/verify?next=%2Fteams%2F42%3Ftab%3Dpeople');
		expect(res.headers['cache-control']).toBe('no-store');
		expect(res.ended).toBe(true);
	});

	it('calls next for everything else', () => {
		let passed = false;
		mfaGateMiddleware()(page('/api/x'), {}, () => { passed = true; });
		expect(passed).toBe(true);
		expect(mfaRedirectLocation({ url: '/' })).toBe('/login/verify?next=%2F');
	});
});
