// The agent editor is a fixed-height app shell: at desktop widths <body> is a
// 100svh flex column with overflow hidden and .unified-layout takes `flex: 1`
// with `min-height: 0`. The sitewide footer is ~1000px tall, so mounting it in
// flow inside that shell squeezed .unified-layout to 0px and the whole editor
// (persona, brain, autopilot, wallet) rendered as an empty strip under the
// header. The footer can never be scrolled to inside an overflow-hidden shell,
// so the desktop shell must take it out of the layout; the mobile layout
// (max-width: 800px) scrolls normally and keeps it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../pages/agent-edit.html', import.meta.url), 'utf8');
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

describe('agent editor app shell', () => {
	it('is a fixed-height, overflow-hidden shell (the premise of this guard)', () => {
		const body = css.match(/(^|\n)\s*body\s*\{([^}]*)\}/)[2];
		expect(body).toMatch(/overflow:\s*hidden/);
		expect(body).toMatch(/height:\s*100s?vh/);
		expect(html).toContain('id="footer-container"');
	});

	it('takes the footer out of the desktop shell so the editor keeps its height', () => {
		const desktop = [...css.matchAll(/@media\s*\(min-width:\s*801px\)\s*\{([\s\S]*?)\n\t\t\t\}/g)].map((m) => m[1]).join('\n');
		expect(desktop).toMatch(/#footer-container\s*\{[^}]*display:\s*none/);
	});
});
