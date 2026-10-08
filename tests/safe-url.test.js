import { describe, it, expect } from 'vitest';
import { safeUrl } from '../src/safe-url.js';

describe('safeUrl', () => {
	it('keeps http(s) and site-relative links', () => {
		expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
		expect(safeUrl('HTTP://example.com')).toBe('HTTP://example.com');
		expect(safeUrl('/oracle/coin/abc')).toBe('/oracle/coin/abc');
		expect(safeUrl('./x')).toBe('./x');
		expect(safeUrl('#top')).toBe('#top');
	});

	it('rejects script-bearing and odd schemes', () => {
		for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.example/x', 'java\tscript:alert(1)']) {
			expect(safeUrl(bad)).toBe('#');
		}
	});

	it('rejects relative paths a browser would normalize into a protocol-relative URL', () => {
		for (const bad of ['/\\evil.example/x', '/\\/evil.example', '/\t/evil.example', '/\n/evil.example', './\\evil']) {
			expect(safeUrl(bad)).toBe('#');
		}
	});

	it('returns the caller fallback so a rejected link can be omitted entirely', () => {
		expect(safeUrl('javascript:alert(1)', '')).toBe('');
		expect(safeUrl(null, '')).toBe('');
		expect(safeUrl('', '')).toBe('');
		expect(safeUrl(42, '')).toBe('');
	});
});
