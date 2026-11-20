// Regression tests for the open-redirect guards (security audit 2026-07-23:
// unvalidated ?next= / ?return= params on the auth and paywall pages allowed
// attacker-controlled post-login redirects and javascript: hrefs).
//
// Two layers:
//   1. Behavior tests for the canonical guards in src/safe-next.js.
//   2. Drift tests asserting the inline copies shipped in the public pages
//      (which cannot import /src at runtime) stay byte-identical to the
//      canonical functions.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { safeNext, safeNavUrl, authPageHref } from '../src/safe-next.js';

describe('safeNext', () => {
	it('allows same-origin relative paths', () => {
		expect(safeNext('/dashboard')).toBe('/dashboard');
		expect(safeNext('/create')).toBe('/create');
		expect(safeNext('/dashboard/embed-policy?agent=abc#top')).toBe(
			'/dashboard/embed-policy?agent=abc#top',
		);
		expect(safeNext('/extension/auth-callback')).toBe('/extension/auth-callback');
		expect(safeNext('/%2f%2fevil.com')).toBe('/%2f%2fevil.com'); // stays a path
	});

	it('rejects absolute and protocol-relative URLs', () => {
		expect(safeNext('https://evil.com')).toBe('/dashboard');
		expect(safeNext('http://evil.com')).toBe('/dashboard');
		expect(safeNext('//evil.com')).toBe('/dashboard');
		expect(safeNext('///evil.com')).toBe('/dashboard');
		expect(safeNext('javascript:alert(1)')).toBe('/dashboard');
		expect(safeNext('data:text/html,x')).toBe('/dashboard');
	});

	it('rejects backslash normalization tricks', () => {
		expect(safeNext('/\\evil.com')).toBe('/dashboard');
		expect(safeNext('/\\/evil.com')).toBe('/dashboard');
		expect(safeNext('\\evil.com')).toBe('/dashboard');
	});

	it('rejects control characters', () => {
		expect(safeNext('/\tlogin')).toBe('/dashboard');
		expect(safeNext('/dash\nboard')).toBe('/dashboard');
		expect(safeNext('/dashboard')).toBe('/dashboard');
	});

	it('rejects empty and non-string input', () => {
		expect(safeNext('')).toBe('/dashboard');
		expect(safeNext(null)).toBe('/dashboard');
		expect(safeNext(undefined)).toBe('/dashboard');
		expect(safeNext(42)).toBe('/dashboard');
	});

	it('honors a custom fallback', () => {
		expect(safeNext('https://evil.com', '/create')).toBe('/create');
		expect(safeNext(null, '/dashboard/')).toBe('/dashboard/');
	});
});

describe('safeNavUrl', () => {
	it('allows same-origin relative paths', () => {
		expect(safeNavUrl('/')).toBe('/');
		expect(safeNavUrl('/pay/receipt?id=1')).toBe('/pay/receipt?id=1');
	});

	it('allows absolute http(s) URLs', () => {
		expect(safeNavUrl('https://example.com/resource')).toBe('https://example.com/resource');
		expect(safeNavUrl('http://example.com')).toBe('http://example.com/');
	});

	it('blocks script-capable and opaque schemes', () => {
		expect(safeNavUrl('javascript:alert(1)')).toBe('/');
		expect(safeNavUrl('JaVaScRiPt:alert(1)')).toBe('/');
		expect(safeNavUrl('  javascript:alert(1)')).toBe('/');
		expect(safeNavUrl('data:text/html,<script>alert(1)</script>')).toBe('/');
		expect(safeNavUrl('vbscript:msgbox(1)')).toBe('/');
		expect(safeNavUrl('file:///etc/passwd')).toBe('/');
	});

	it('blocks protocol-relative and backslash tricks', () => {
		expect(safeNavUrl('//evil.com')).toBe('/');
		expect(safeNavUrl('/\\evil.com')).toBe('/');
		expect(safeNavUrl('https:\\evil.com')).toBe('/');
	});

	it('falls back on empty, non-string, and unparseable input', () => {
		expect(safeNavUrl('')).toBe('/');
		expect(safeNavUrl(null)).toBe('/');
		expect(safeNavUrl('not a url')).toBe('/');
	});
});

// ── Inline-copy drift guard ──────────────────────────────────────────────────

const canonical = readFileSync(new URL('../src/safe-next.js', import.meta.url), 'utf8');

function canonicalSource(exportName) {
	const match = canonical.match(new RegExp(`export function ${exportName}[\\s\\S]*?\\n}`));
	if (!match) throw new Error(`canonical source for ${exportName} not found`);
	return match[0].replace('export function', 'function');
}

const copies = [
	['public/login.html', ['safeNext']],
	['public/register.html', ['safeNext']],
	['public/wallet-login.js', ['safeNext']],
	['public/wallet-connect-demo.html', ['safeNext']],
	['public/paywall.js', ['safeNavUrl']],
];

describe('inline copies stay in sync with src/safe-next.js', () => {
	for (const [file, fns] of copies) {
		for (const fn of fns) {
			it(`${file} carries the canonical ${fn}`, () => {
				const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
				expect(text.includes(canonicalSource(fn))).toBe(true);
			});
		}
	}
});

describe('safeNext with nested query strings (extension sign-in round trip)', () => {
	it('keeps the extension state inside next, encoded or not', () => {
		const encoded = '/extension/auth-callback?state=ab12%3D%26cd';
		expect(safeNext(encoded)).toBe(encoded);
		const nested = `/login?next=${encodeURIComponent('/extension/auth-callback?state=xyz')}`;
		expect(safeNext(nested)).toBe(nested);
		expect(new URL(safeNext(encoded), 'https://three.ws').searchParams.get('state')).toBe('ab12=&cd');
	});
});

// A sign-in that started somewhere (an OAuth consent screen, the extension)
// must survive the hop between /login and /register, or a brand new user who
// clicks "Create one" on an MCP connector's sign-in page lands on /create and
// the connector never gets its authorization code.
describe('authPageHref carries next between the sign-in and sign-up pages', () => {
	it('appends a non-default next', () => {
		const consent = '/oauth/consent?client_id=mcp_abc&code_challenge=xyz&state=s1';
		const href = authPageHref('/register', consent, '/dashboard');
		expect(href).toBe(`/register?next=${encodeURIComponent(consent)}`);
		expect(new URL(href, 'https://three.ws').searchParams.get('next')).toBe(consent);
	});

	it('leaves the link alone when next is the page default', () => {
		expect(authPageHref('/register', '/dashboard', '/dashboard')).toBe('/register');
		expect(authPageHref('/login', '/create', '/create')).toBe('/login');
	});

	it('never forwards an unsafe next', () => {
		expect(authPageHref('/register', 'https://evil.com', '/dashboard')).toBe('/register');
		expect(authPageHref('/register', '//evil.com', '/dashboard')).toBe('/register');
	});

	for (const [file, target] of [
		['public/login.html', '/register'],
		['public/register.html', '/login'],
	]) {
		it(`${file} carries the canonical authPageHref and applies it to its ${target} link`, () => {
			const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
			expect(text.includes(canonicalSource('authPageHref'))).toBe(true);
			expect(text).toMatch(new RegExp(`authPageHref\\('${target}', next,`));
		});
	}
});
