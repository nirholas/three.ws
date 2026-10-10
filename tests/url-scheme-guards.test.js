// Unit tests for the two URL scheme guards: safeUrl (src/safe-url.js, for
// href / src / CSS url() sinks) and sanitizeUrl (src/shared/sanitize-url.js,
// for links in rendered markdown). Tests only: the "differences" block pins
// the places where the two intentionally disagree, so changing one is a
// deliberate, visible decision.

import { describe, it, expect } from 'vitest';
import { safeUrl } from '../src/safe-url.js';
import { sanitizeUrl } from '../src/shared/sanitize-url.js';

const SCRIPT_SCHEMES = [
	'javascript:alert(1)',
	'JAVASCRIPT:alert(1)',
	'JaVaScRiPt:alert(1)',
	'  javascript:alert(1)',
	'\tjavascript:alert(1)',
	'\njavascript:alert(1)',
	'data:text/html,<script>alert(1)</script>',
	'DATA:text/html,x',
	'  data:image/svg+xml,x',
	'vbscript:msgbox(1)',
	'VbScript:msgbox(1)',
	'  vbscript:msgbox(1)',
];

const PROTOCOL_RELATIVE = ['//evil.com', '//evil.com/path', '  //evil.com'];

const NON_STRINGS = [null, undefined, 0, 42, {}, { href: 'https://x.y' }, ['https://x.y']];

const BLANK = ['', ' ', '   ', '\t\n'];

describe('safeUrl', () => {
	it.each(SCRIPT_SCHEMES)('rejects script scheme %j', (url) => {
		expect(safeUrl(url)).toBe('#');
	});

	it.each(PROTOCOL_RELATIVE)('rejects protocol-relative %j', (url) => {
		expect(safeUrl(url)).toBe('#');
	});

	it.each([
		'https://example.com',
		'HTTPS://example.com/a?b=c#d',
		'http://example.com',
		'/path',
		'/',
		'#anchor',
		'#',
		'./a',
		'../a',
	])('allows %j unchanged', (url) => {
		expect(safeUrl(url)).toBe(url);
	});

	it.each([...NON_STRINGS, ...BLANK])('returns the default fallback for %j', (url) => {
		expect(safeUrl(url)).toBe('#');
	});

	it.each([...NON_STRINGS, ...BLANK, ...SCRIPT_SCHEMES, ...PROTOCOL_RELATIVE])(
		'returns a custom fallback for %j',
		(url) => {
			expect(safeUrl(url, '/img/placeholder.png')).toBe('/img/placeholder.png');
		},
	);
});

describe('sanitizeUrl', () => {
	it.each(SCRIPT_SCHEMES)('rejects script scheme %j', (url) => {
		expect(sanitizeUrl(url)).toBe('#');
	});

	it.each(PROTOCOL_RELATIVE)('rejects protocol-relative %j', (url) => {
		expect(sanitizeUrl(url)).toBe('#');
	});

	it.each([
		'https://example.com',
		'HTTPS://example.com/a?b=c#d',
		'http://example.com',
		'/path',
		'/',
		'#anchor',
		'#',
		'mailto:a@b.c',
		'MAILTO:a@b.c',
	])('allows %j', (url) => {
		expect(sanitizeUrl(url)).toBe(url);
	});

	it.each([...NON_STRINGS, ...BLANK])('returns "#" for %j', (url) => {
		expect(sanitizeUrl(url)).toBe('#');
	});
});

describe('intentional differences between safeUrl and sanitizeUrl', () => {
	it('mailto: is rejected by safeUrl but allowed by sanitizeUrl', () => {
		expect(safeUrl('mailto:a@b.c')).toBe('#');
		expect(sanitizeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
	});

	it('./ relative paths are allowed by safeUrl but rejected by sanitizeUrl', () => {
		expect(safeUrl('./a')).toBe('./a');
		expect(sanitizeUrl('./a')).toBe('#');
	});

	it('../ relative paths are allowed by safeUrl but rejected by sanitizeUrl', () => {
		expect(safeUrl('../a')).toBe('../a');
		expect(sanitizeUrl('../a')).toBe('#');
	});

	it('safeUrl returns an accepted url untrimmed; sanitizeUrl returns it trimmed', () => {
		expect(safeUrl(' https://x.y ')).toBe(' https://x.y ');
		expect(sanitizeUrl(' https://x.y ')).toBe('https://x.y');
	});

	it('safeUrl accepts http(s): without slashes; sanitizeUrl requires ://', () => {
		expect(safeUrl('https:example.com')).toBe('https:example.com');
		expect(sanitizeUrl('https:example.com')).toBe('#');
	});

	it('both agree on the shared cases from the issue table', () => {
		for (const [url, want] of [
			['  javascript:alert(1)', '#'],
			['JaVaScRiPt:x', '#'],
			['data:text/html,x', '#'],
			['//evil.com', '#'],
			['#top', '#top'],
		]) {
			expect(safeUrl(url)).toBe(want);
			expect(sanitizeUrl(url)).toBe(want);
		}
	});
});
