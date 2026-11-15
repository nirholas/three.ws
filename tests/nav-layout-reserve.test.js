// The shared header is injected after first paint on every page. Two things
// used to shift the page when it landed: the skip link (an in-flow 26px anchor
// until nav.css arrived) and a height reservation that was 4 to 26px short of
// the real header. These guard the fixes.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const navJs = readFileSync(new URL('../public/nav.js', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../public/tokens.css', import.meta.url), 'utf8');
const navCss = readFileSync(new URL('../public/nav.css', import.meta.url), 'utf8');

describe('shared header layout reserve', () => {
	it('takes the skip link out of flow before nav.css loads', () => {
		expect(navJs).toMatch(/nav-skip-critical/);
		expect(navJs).toMatch(/\.nav-skip\{position:fixed;[^']*translateY\(calc\(-100% - 14px\)\)\}/);
	});
	it('reserves the measured header height at each width band', () => {
		// Single row at every width: 73px drawer bar at 1080px and below, the
		// full bar above. No two-row band exists any more, so none is reserved.
		expect(tokens).toMatch(/:root \{ --nav-h: 72px; \}/);
		expect(tokens).toMatch(/max-width: 1080px\) \{\s*:root \{ --nav-h: 73px; \}/);
		expect(tokens).not.toMatch(/#nav-container:empty \{ min-height: 95px; \}/);
	});
	it('switches to the drawer at the same width in CSS, JS and the reserve', () => {
		// The desktop row needs ~1040px; below the drawer breakpoint it ran off
		// the viewport. nav.css, nav.js and tokens.css must agree on it.
		expect(navCss).toMatch(/max-width: 1080px\) \{\s*\.nav-main \{ display: none; \}/);
		expect(navCss).toMatch(/max-width: 1080px\) \{\s*\.nav-toggle \{ display: flex; \}\s*\.nav-end \{ display: none; \}/);
		expect(navJs).toMatch(/window\.innerWidth > 1080 && isOpen\(\)/);
		expect(navCss).not.toMatch(/max-width: 880px/);
	});
});
