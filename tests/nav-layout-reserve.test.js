// The shared header is injected after first paint on every page. Two things
// used to shift the page when it landed: the skip link (an in-flow 26px anchor
// until nav.css arrived) and a height reservation that was 4 to 26px short of
// the real header. These guard the fixes.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const navJs = readFileSync(new URL('../public/nav.js', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../public/tokens.css', import.meta.url), 'utf8');

describe('shared header layout reserve', () => {
	it('takes the skip link out of flow before nav.css loads', () => {
		expect(navJs).toMatch(/nav-skip-critical/);
		expect(navJs).toMatch(/\.nav-skip\{position:fixed;[^']*translateY\(calc\(-100% - 14px\)\)\}/);
	});
	it('reserves the measured header height at each width band', () => {
		expect(tokens).toMatch(/:root \{ --nav-h: 72px; \}/);
		expect(tokens).toMatch(/max-width: 880px\) \{\s*:root \{ --nav-h: 73px; \}/);
		expect(tokens).toMatch(/min-width: 881px\) and \(max-width: 1169px\) \{\s*#nav-container:empty \{ min-height: 95px; \}/);
	});
});
