// The CSP inline-script hasher is the only thing standing between a strict
// `script-src` and 1,000+ blank pages: if it misses one inline script, that
// page's JavaScript stops running in production. These tests pin the parser
// edge cases that a naive regex gets wrong, and the shape of the rewritten
// policy.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
	inlineScriptBodies,
	inlineScriptHashes,
	hardenInlineScripts,
	hardenHeaderBag,
	hardenOnEnd,
} from '../server/csp-hashes.mjs';

const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

const POLICY =
	"base-uri 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://esm.sh; worker-src 'self' blob:; frame-ancestors 'self'";

describe('inlineScriptBodies', () => {
	it('captures the body of a plain inline script', () => {
		expect(inlineScriptBodies('<script>alert(1)</script>')).toEqual(['alert(1)']);
	});

	it('skips scripts loaded from a src (covered by the host allowlist)', () => {
		const html = '<script src="/nav.js" defer></script><script>go()</script>';
		expect(inlineScriptBodies(html)).toEqual(['go()']);
	});

	it('does not confuse a data-src attribute with src', () => {
		expect(inlineScriptBodies('<script data-src="x">run()</script>')).toEqual(['run()']);
	});

	it('handles a `>` inside a quoted attribute value', () => {
		const html = `<script type="module" data-note="a > b">body()</script>`;
		expect(inlineScriptBodies(html)).toEqual(['body()']);
	});

	it('handles a `</script` written inside a string, the way the parser does', () => {
		// The HTML parser ends the element at the first `</script`, so the hash
		// must cover only the text up to that point.
		const html = '<script>var s = "</script>";</script>';
		expect(inlineScriptBodies(html)).toEqual(['var s = "']);
	});

	it('is case-insensitive on the tag name', () => {
		expect(inlineScriptBodies('<SCRIPT>a()</SCRIPT>')).toEqual(['a()']);
	});

	it('tolerates whitespace before the closing bracket', () => {
		expect(inlineScriptBodies('<script>a()</script >')).toEqual(['a()']);
	});

	it('ignores an element whose name merely starts with "script"', () => {
		expect(inlineScriptBodies('<scripty>a()</scripty>')).toEqual([]);
	});

	it('covers JSON-LD blocks, which script-src also gates', () => {
		const html = '<script type="application/ld+json">{"@type":"WebPage"}</script>';
		expect(inlineScriptBodies(html)).toEqual(['{"@type":"WebPage"}']);
	});

	it('returns every script on a page, in document order', () => {
		const html = '<script>one</script><p>x</p><script type="module">two</script>';
		expect(inlineScriptBodies(html)).toEqual(['one', 'two']);
	});

	it('treats an unterminated script as running to the end of the document', () => {
		expect(inlineScriptBodies('<p>x</p><script>tail')).toEqual(['tail']);
	});

	it('returns nothing for HTML with no inline scripts', () => {
		expect(inlineScriptBodies('<p>hello</p><script src="/a.js"></script>')).toEqual([]);
	});

	// The bug this class of test exists for: a CSS comment on /oracle mentioning
	// `<script>` started a phantom element that ran to the next real `</script>`,
	// which swallowed the analytics snippet's opening tag. Its hash never reached
	// the header and the browser blocked it.
	it('ignores a <script> written inside a <style> block', () => {
		const html = '<style>/* see <script> docs */ .a { color: red }</style><script>real()</script>';
		expect(inlineScriptBodies(html)).toEqual(['real()']);
	});

	it('ignores a <script> written inside a <textarea>', () => {
		const html = '<textarea><script>fake()</script></textarea><script>real()</script>';
		expect(inlineScriptBodies(html)).toEqual(['real()']);
	});

	it('ignores a <script> written inside a <title>', () => {
		const html = '<title>How <script> tags work</title><script>real()</script>';
		expect(inlineScriptBodies(html)).toEqual(['real()']);
	});

	it('ignores a <script> inside an HTML comment', () => {
		const html = '<!-- <script>fake()</script> --><script>real()</script>';
		expect(inlineScriptBodies(html)).toEqual(['real()']);
	});

	it('does not treat <styles> or <titlebar> as raw-text elements', () => {
		const html = '<styles><script>real()</script></styles>';
		expect(inlineScriptBodies(html)).toEqual(['real()']);
	});

	it('keeps scanning after an unterminated raw-text element', () => {
		// A stray <style> with no close swallows the rest of the document for a
		// real parser too, so finding nothing after it is the correct answer.
		expect(inlineScriptBodies('<style>.a{}<script>x()</script>')).toEqual([]);
	});

	it('finds every script on a page that mixes all of these', () => {
		const html = [
			'<title>A <script> primer</title>',
			'<style>/* <script> */ .a{}</style>',
			'<!-- <script>no()</script> -->',
			'<script>one()</script>',
			'<textarea><script>no()</script></textarea>',
			'<script type="application/ld+json">{"a":1}</script>',
		].join('\n');
		expect(inlineScriptBodies(html)).toEqual(['one()', '{"a":1}']);
	});
});

describe('inlineScriptHashes', () => {
	it('produces the sha256 of the exact body text', () => {
		expect(inlineScriptHashes('<script>alert(1)</script>')).toEqual([sha('alert(1)')]);
	});

	it('preserves surrounding whitespace, which the browser hashes too', () => {
		const body = '\n\t\tconst a = 1;\n\t';
		expect(inlineScriptHashes(`<script>${body}</script>`)).toEqual([sha(body)]);
	});

	it('hashes multi-byte content as UTF-8', () => {
		const body = 'const label = "价格 · €";';
		expect(inlineScriptHashes(`<script>${body}</script>`)).toEqual([sha(body)]);
	});

	it('deduplicates identical scripts', () => {
		const html = '<script>same()</script><script>same()</script>';
		expect(inlineScriptHashes(html)).toEqual([sha('same()')]);
	});
});

describe('hardenInlineScripts', () => {
	it("replaces 'unsafe-inline' in script-src with the page's hashes", () => {
		const out = hardenInlineScripts(POLICY, '<script>alert(1)</script>');
		const scriptSrc = out.split(';').find((d) => d.trim().startsWith('script-src'));
		expect(scriptSrc).not.toContain("'unsafe-inline'");
		expect(scriptSrc).toContain(sha('alert(1)'));
	});

	it('keeps every other source in the directive', () => {
		const out = hardenInlineScripts(POLICY, '<script>a()</script>');
		const scriptSrc = out.split(';').find((d) => d.trim().startsWith('script-src'));
		expect(scriptSrc).toContain("'self'");
		expect(scriptSrc).toContain("'unsafe-eval'");
		expect(scriptSrc).toContain('blob:');
		expect(scriptSrc).toContain('https://esm.sh');
	});

	it('leaves the other directives untouched', () => {
		const out = hardenInlineScripts(POLICY, '<script>a()</script>');
		expect(out).toContain("object-src 'none'");
		expect(out).toContain("frame-ancestors 'self'");
		expect(out).toContain("worker-src 'self' blob:");
	});

	it("drops 'unsafe-inline' entirely on a page with no inline scripts", () => {
		const out = hardenInlineScripts(POLICY, '<p>static</p>');
		const scriptSrc = out.split(';').find((d) => d.trim().startsWith('script-src'));
		expect(scriptSrc).not.toContain("'unsafe-inline'");
		expect(scriptSrc).not.toContain('sha256-');
		expect(scriptSrc).toContain("'self'");
	});

	it('is a no-op on a policy that never allowed inline script', () => {
		const strict = "default-src 'self'; script-src 'self'";
		expect(hardenInlineScripts(strict, '<script>a()</script>')).toBe(strict);
	});

	it('is a no-op on a policy with no script directive at all', () => {
		const frameOnly = "frame-ancestors *; base-uri 'self'; object-src 'none'";
		expect(hardenInlineScripts(frameOnly, '<script>a()</script>')).toBe(frameOnly);
	});

	it('does not accumulate hashes when applied twice', () => {
		const once = hardenInlineScripts(POLICY, '<script>a()</script>');
		expect(hardenInlineScripts(once, '<script>b()</script>')).toBe(once);
	});

	it('also hardens script-src-elem when a policy uses it', () => {
		const policy = "script-src 'self' 'unsafe-inline'; script-src-elem 'self' 'unsafe-inline'";
		const out = hardenInlineScripts(policy, '<script>a()</script>');
		expect(out).not.toContain("'unsafe-inline'");
		expect(out.match(/sha256-/g)).toHaveLength(2);
	});

	it('tolerates a non-string policy', () => {
		expect(hardenInlineScripts(undefined, '<script>a()</script>')).toBe(undefined);
	});
});

describe('hardenHeaderBag', () => {
	it('rewrites the lowercase header key the route table uses', () => {
		const bag = { 'content-security-policy': POLICY, 'x-frame-options': 'SAMEORIGIN' };
		hardenHeaderBag(bag, '<script>a()</script>');
		expect(bag['content-security-policy']).toContain(sha('a()'));
		expect(bag['content-security-policy']).not.toContain("'unsafe-inline'");
		expect(bag['x-frame-options']).toBe('SAMEORIGIN');
	});

	it('rewrites the canonical casing too', () => {
		const bag = { 'Content-Security-Policy': POLICY };
		hardenHeaderBag(bag, '<script>a()</script>');
		expect(bag['Content-Security-Policy']).toContain(sha('a()'));
	});

	it('is a no-op on a bag with no policy', () => {
		const bag = { 'cache-control': 'public, max-age=60' };
		expect(hardenHeaderBag(bag, '<script>a()</script>')).toEqual({
			'cache-control': 'public, max-age=60',
		});
	});
});

describe('hardenOnEnd', () => {
	// The slice of a Node ServerResponse the hook touches, with header names
	// case-insensitive the way the real one keeps them.
	function fakeRes(headers) {
		const bag = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
		const res = {
			headersSent: false,
			sent: null,
			getHeader: (k) => bag.get(k.toLowerCase()),
			setHeader: (k, v) => bag.set(k.toLowerCase(), v),
			end(chunk) {
				res.headersSent = true;
				res.sent = chunk;
				return res;
			},
		};
		return res;
	}

	it('drops unsafe-inline from an API-rendered HTML page and hashes its own scripts', () => {
		const res = hardenOnEnd(fakeRes({ 'content-security-policy': POLICY, 'content-type': 'text/html; charset=utf-8' }));
		res.end('<p>hi</p><script>a()</script>');
		const csp = res.getHeader('content-security-policy');
		expect(csp).not.toContain("'unsafe-inline'");
		expect(csp).toContain(sha('a()'));
		expect(res.sent).toBe('<p>hi</p><script>a()</script>');
	});

	it('hardens an SVG card sent as a Buffer', () => {
		const res = hardenOnEnd(fakeRes({ 'content-security-policy': POLICY, 'content-type': 'image/svg+xml; charset=utf-8' }));
		res.end(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>'));
		expect(res.getHeader('content-security-policy')).not.toContain("'unsafe-inline'");
	});

	it('leaves JSON responses alone', () => {
		const res = hardenOnEnd(fakeRes({ 'content-security-policy': POLICY, 'content-type': 'application/json' }));
		res.end('{"ok":true}');
		expect(res.getHeader('content-security-policy')).toBe(POLICY);
	});

	it('does not touch headers that have already gone out', () => {
		const res = hardenOnEnd(fakeRes({ 'content-security-policy': POLICY, 'content-type': 'text/html' }));
		res.headersSent = true;
		res.end('<script>a()</script>');
		expect(res.getHeader('content-security-policy')).toBe(POLICY);
	});

	it('keeps a policy the handler set for itself', () => {
		const res = hardenOnEnd(fakeRes({ 'content-security-policy': POLICY, 'content-type': 'text/html' }));
		const own = "default-src 'none'; script-src 'unsafe-inline'";
		res.setHeader('content-security-policy', own);
		res.end('<script>a()</script>');
		expect(res.getHeader('content-security-policy')).toBe(own);
	});

	it('passes a bodiless end straight through', () => {
		const res = hardenOnEnd(fakeRes({ 'content-security-policy': POLICY, 'content-type': 'text/html' }));
		res.end();
		expect(res.getHeader('content-security-policy')).toBe(POLICY);
		expect(res.headersSent).toBe(true);
	});
});
