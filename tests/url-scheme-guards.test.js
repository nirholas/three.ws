import { describe, it, expect } from 'vitest';
import { safeUrl } from '../src/safe-url.js';
import { sanitizeUrl } from '../src/shared/sanitize-url.js';

const SCRIPT = ['javascript:alert(1)', '  javascript:alert(1)', 'JaVaScRiPt:x', 'JAVASCRIPT:x', 'data:text/html,x', 'DaTa:x', ' vbscript:x', 'VBScript:x'];
const NON_STRINGS = [null, undefined, 42, {}, [], true];

describe('safeUrl', () => {
	it.each(SCRIPT)('rejects script scheme %j', (u) => expect(safeUrl(u)).toBe('#'));
	it('rejects protocol-relative //host', () => expect(safeUrl('//evil.com')).toBe('#'));
	it.each([
		['https://x.y', 'https://x.y'], ['http://x.y', 'http://x.y'], ['/path', '/path'],
		['#top', '#top'], ['./a', './a'], ['../a', '../a'],
	])('allows %s', (u, out) => expect(safeUrl(u)).toBe(out));
	it.each(NON_STRINGS)('returns the fallback for non-string %j', (u) => {
		expect(safeUrl(u)).toBe('#');
		expect(safeUrl(u, '/home')).toBe('/home');
	});
	it.each(['', '   ', '\n'])('returns the fallback for blank %j', (u) => {
		expect(safeUrl(u)).toBe('#');
		expect(safeUrl(u, '/home')).toBe('/home');
	});
	it('honours a custom fallback on rejection', () => expect(safeUrl('javascript:x', '/safe')).toBe('/safe'));

	// Intentional differences from sanitizeUrl, locked so changing them is deliberate.
	it('differs: rejects mailto:', () => expect(safeUrl('mailto:a@b.c')).toBe('#'));
	it('differs: allows ./ relative paths', () => expect(safeUrl('./a')).toBe('./a'));
	it('differs: returns an allowed URL untrimmed', () => expect(safeUrl(' https://x.y ')).toBe(' https://x.y '));
});

describe('sanitizeUrl', () => {
	it.each(SCRIPT)('rejects script scheme %j', (u) => expect(sanitizeUrl(u)).toBe('#'));
	it('rejects protocol-relative //host', () => expect(sanitizeUrl('//evil.com')).toBe('#'));
	it.each([
		['https://x.y', 'https://x.y'], ['http://x.y', 'http://x.y'], ['/path', '/path'],
		['#top', '#top'], ['mailto:a@b.c', 'mailto:a@b.c'],
	])('allows %s', (u, out) => expect(sanitizeUrl(u)).toBe(out));
	it.each(NON_STRINGS)('returns # for non-string %j', (u) => expect(sanitizeUrl(u)).toBe('#'));
	it.each(['', '   ', '\n'])('returns # for blank %j', (u) => expect(sanitizeUrl(u)).toBe('#'));

	it('differs: allows mailto:', () => expect(sanitizeUrl('mailto:a@b.c')).toBe('mailto:a@b.c'));
	it('differs: rejects ./ relative paths', () => expect(sanitizeUrl('./a')).toBe('#'));
	it('differs: returns an allowed URL trimmed', () => expect(sanitizeUrl(' https://x.y ')).toBe('https://x.y'));
});
