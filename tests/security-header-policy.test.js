// The HTTP security header policy (scripts/lib/security-header-policy.mjs),
// the X-Frame-Options reconciler and dev-server parity
// (server/security-headers.mjs), and the route table itself: the catch-all
// route in vercel.json has to produce headers that pass the policy, on plain
// pages, auth pages, embeds and API responses alike.

import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSecurityHeaders } from '../scripts/lib/security-header-policy.mjs';
import {
	devSecurityHeadersMiddleware,
	frameOptionsFor,
	frameOptionsMiddleware,
	pickSecurityHeaders,
} from '../server/security-headers.mjs';
import { loadRouteTable, resolvePhase1 } from '../server/route-resolve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const table = loadRouteTable(path.join(ROOT, 'vercel.json'));

const GOOD = {
	'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'SAMEORIGIN',
	'x-xss-protection': '0',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=()',
	'content-security-policy': "base-uri 'self'; object-src 'none'; script-src 'self' 'sha256-abc='; frame-ancestors 'self'",
};
const ctx = { path: '/trust', isHtml: true, production: true };

/** Headers a request to `p` collects from the route table, as the server would. */
function routeHeaders(p) {
	const { headers } = resolvePhase1(table.phase1Routes, { headers: {} }, new URL(p, 'http://x'));
	return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

/** A minimal Node response stand-in: real header map, real writeHead hook. */
function fakeRes() {
	const h = new Map();
	return {
		headersSent: false,
		written: null,
		getHeader: (k) => h.get(k.toLowerCase()),
		setHeader: (k, v) => h.set(k.toLowerCase(), v),
		removeHeader: (k) => h.delete(k.toLowerCase()),
		writeHead(status) {
			this.written = { status, headers: Object.fromEntries(h) };
			this.headersSent = true;
		},
	};
}

describe('evaluateSecurityHeaders', () => {
	it('passes a complete, strong header set', () => {
		expect(evaluateSecurityHeaders(GOOD, ctx)).toEqual([]);
	});

	it('flags each missing header', () => {
		const problems = evaluateSecurityHeaders({}, ctx);
		for (const needle of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'X-XSS-Protection', 'Content-Security-Policy', 'X-Frame-Options'])
			expect(problems.some((p) => p.includes(needle))).toBe(true);
	});

	it('flags an HSTS that is no longer preload-eligible', () => {
		const short = { ...GOOD, 'strict-transport-security': 'max-age=86400; includeSubDomains' };
		const problems = evaluateSecurityHeaders(short, ctx);
		expect(problems).toContain('Strict-Transport-Security max-age 86400 is under 31536000');
		expect(problems).toContain('Strict-Transport-Security lacks preload');
	});

	it("flags 'unsafe-eval' outside /scene and allows it there", () => {
		const csp = "base-uri 'self'; object-src 'none'; script-src 'self' 'unsafe-eval' 'sha256-a='; frame-ancestors 'self'";
		expect(evaluateSecurityHeaders({ ...GOOD, 'content-security-policy': csp }, ctx)).toContain("CSP script-src allows 'unsafe-eval'");
		expect(evaluateSecurityHeaders({ ...GOOD, 'content-security-policy': csp }, { ...ctx, path: '/scene' })).toEqual([]);
	});

	it("requires hashed inline scripts only where production rewrites them", () => {
		const csp = "base-uri 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'";
		const h = { ...GOOD, 'content-security-policy': csp };
		expect(evaluateSecurityHeaders(h, ctx)).toContain("CSP script-src ships 'unsafe-inline' without hashes");
		expect(evaluateSecurityHeaders(h, { ...ctx, production: false })).toEqual([]);
	});

	it('flags a leaky referrer policy and a wildcard camera grant', () => {
		const h = { ...GOOD, 'referrer-policy': 'unsafe-url', 'permissions-policy': 'camera=*' };
		const problems = evaluateSecurityHeaders(h, ctx);
		expect(problems).toContain('Referrer-Policy "unsafe-url" can leak full URLs');
		expect(problems).toContain('Permissions-Policy grants camera to every origin');
	});

	it('rejects X-Frame-Options on a page every origin may embed', () => {
		const embed = { ...GOOD, 'content-security-policy': "base-uri 'self'; object-src 'none'; script-src 'self' 'sha256-a='; frame-ancestors *" };
		expect(evaluateSecurityHeaders(embed, ctx)[0]).toMatch(/contradicts frame-ancestors \*/);
		const { ['x-frame-options']: _drop, ...withoutXfo } = embed;
		expect(evaluateSecurityHeaders(withoutXfo, ctx)).toEqual([]);
	});

	it('does not demand a CSP on non-document responses', () => {
		const { ['content-security-policy']: _csp, ...rest } = GOOD;
		expect(evaluateSecurityHeaders(rest, { path: '/api/healthz', isHtml: false, production: true })).toEqual([]);
	});
});

describe('frame options reconciliation', () => {
	it('drops X-Frame-Options where frame-ancestors is *, and the invalid ALLOWALL anywhere', () => {
		expect(frameOptionsFor('frame-ancestors *', 'SAMEORIGIN')).toBeNull();
		expect(frameOptionsFor("frame-ancestors 'self'", 'ALLOWALL')).toBeNull();
		expect(frameOptionsFor("frame-ancestors 'self' https://ibm.com", 'SAMEORIGIN')).toBe('SAMEORIGIN');
		expect(frameOptionsFor(undefined, 'DENY')).toBe('DENY');
	});

	it('applies at writeHead, after every handler has set its headers', () => {
		const res = fakeRes();
		frameOptionsMiddleware()({}, res, () => {});
		res.setHeader('x-frame-options', 'SAMEORIGIN');
		res.setHeader('content-security-policy', "object-src 'none'; frame-ancestors *");
		res.writeHead(200);
		expect(res.written.headers['x-frame-options']).toBeUndefined();
	});

	it('keeps only security headers when picking from a route bag', () => {
		expect(pickSecurityHeaders({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' })).toEqual({ 'x-frame-options': 'DENY' });
	});
});

describe('the route table meets the policy', () => {
	// What the server sends after the reconciler: the route headers, minus a
	// contradicting X-Frame-Options.
	function served(p) {
		const h = routeHeaders(p);
		const xfo = frameOptionsFor(h['content-security-policy'], h['x-frame-options']);
		if (xfo === null) delete h['x-frame-options'];
		else h['x-frame-options'] = xfo;
		return h;
	}

	for (const p of ['/', '/trust', '/login', '/settings', '/teams', '/scene']) {
		it(`page ${p}`, () => {
			expect(evaluateSecurityHeaders(served(p), { path: p, isHtml: true, production: false })).toEqual([]);
		});
	}

	for (const p of ['/widget', '/viewer', '/a/1/2/embed']) {
		it(`embeddable page ${p} carries no X-Frame-Options`, () => {
			const h = served(p);
			expect(h['content-security-policy']).toMatch(/frame-ancestors \*/);
			expect(h['x-frame-options']).toBeUndefined();
			expect(evaluateSecurityHeaders(h, { path: p, isHtml: true, production: false })).toEqual([]);
		});
	}

	it('API responses', () => {
		expect(evaluateSecurityHeaders(served('/api/healthz'), { path: '/api/healthz', isHtml: false, production: false })).toEqual([]);
	});
});

describe('dev server parity', () => {
	it('sets the route table security headers on a dev response', () => {
		const res = fakeRes();
		let nextCalled = false;
		devSecurityHeadersMiddleware(() => table)({ url: '/widget', headers: {} }, res, () => {
			nextCalled = true;
		});
		res.writeHead(200);
		expect(nextCalled).toBe(true);
		expect(res.written.headers['strict-transport-security']).toMatch(/preload/);
		expect(res.written.headers['x-xss-protection']).toBe('0');
		expect(res.written.headers['x-frame-options']).toBeUndefined();
		expect(res.written.headers['cache-control']).toBeUndefined();
	});
});
