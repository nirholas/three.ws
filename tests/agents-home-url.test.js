import { describe, it, expect } from 'vitest';

import { normalizeHomeUrl } from '../api/agents.js';

describe('agents: normalizeHomeUrl', () => {
	it('keeps http(s) URLs and same-origin paths', () => {
		expect(normalizeHomeUrl('https://example.com/me')).toEqual({ value: 'https://example.com/me' });
		expect(normalizeHomeUrl('http://example.com')).toEqual({ value: 'http://example.com/' });
		expect(normalizeHomeUrl('/agents/abc')).toEqual({ value: '/agents/abc' });
	});

	it('treats an absent or blank value as no change', () => {
		expect(normalizeHomeUrl(undefined)).toEqual({ value: null });
		expect(normalizeHomeUrl('')).toEqual({ value: null });
		expect(normalizeHomeUrl('   ')).toEqual({ value: null });
	});

	it('refuses script and data schemes that would run when the link is clicked', () => {
		for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x']) {
			expect(normalizeHomeUrl(bad).error).toBeTruthy();
		}
	});

	it('refuses protocol-relative and backslash paths that leave the origin', () => {
		expect(normalizeHomeUrl('//evil.example/x').error).toBeTruthy();
		expect(normalizeHomeUrl('/\\evil.example/x').error).toBeTruthy();
	});

	it('refuses non-string input', () => {
		expect(normalizeHomeUrl({ href: 'x' }).error).toBeTruthy();
	});
});
