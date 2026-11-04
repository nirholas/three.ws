import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// labs.js is a DOM module with top-level side effects, so read the pure
// category table out of the source rather than importing it.
const src = readFileSync(join(import.meta.dirname, '..', 'src', 'labs.js'), 'utf8');
const fn = new Function(
	`${src.slice(src.indexOf('const CATEGORIES'), src.indexOf('// Human-readable'))}; return categorize;`,
);
const categorize = fn();

describe('labs categorize()', () => {
	it('does not label an unmapped page as x402', () => {
		expect(categorize('/globe').cat).toBe('other');
		expect(categorize('/globe').label).toBe('Other');
	});
	it('maps the Animation Gallery and Character Library to 3D', () => {
		expect(categorize('/animations').cat).toBe('3d');
		expect(categorize('/character-library').cat).toBe('3d');
	});
	it('keeps real paid services under x402', () => {
		expect(categorize('/fact-checker').cat).toBe('x402');
	});
	it('contains no em-dash', () => {
		expect(src.includes(String.fromCharCode(0x2014))).toBe(false);
	});
});
