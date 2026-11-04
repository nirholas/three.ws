// @vitest-environment jsdom
//
// The first-visit intro card must stay reachable when it is taller than the
// viewport: 200% browser zoom on a laptop (a 640x400 CSS viewport), a phone in
// landscape, or a long German string. The overlay used to centre the card with
// `align-items: center` inside a fixed box that could not scroll, so an
// oversized card was pushed above the top edge and its Skip button and heading
// could not be reached at all. The safe pattern is a scrollable overlay with
// the card centred by auto margins, which fall back to the top edge instead of
// going negative.
//
// jsdom has no layout, so this pins the CSS contract that produces the
// behaviour; the 200% zoom pass in a real browser is in the work order report.

import { describe, it, expect, beforeAll } from 'vitest';
import { makeIntroReopener } from '../src/game/play-intro.js';

function rule(css, selector) {
	const at = css.indexOf(selector + ' {');
	expect(at, `${selector} rule exists`).toBeGreaterThanOrEqual(0);
	return css.slice(at, css.indexOf('}', at));
}

describe('play intro overflow', () => {
	let css;
	beforeAll(() => {
		makeIntroReopener(() => {});
		css = document.getElementById('pi-styles').textContent;
	});

	it('lets the overlay scroll when the card is taller than the viewport', () => {
		const overlay = rule(css, '#pi-overlay');
		expect(overlay).toMatch(/overflow-y:\s*auto/);
		expect(overlay).toMatch(/overscroll-behavior:\s*contain/);
	});

	it('never centres with align-items, which pushes an oversized card off the top', () => {
		expect(rule(css, '#pi-overlay')).not.toMatch(/align-items:\s*center/);
	});

	it('centres the card with auto margins so it falls back to the top edge', () => {
		expect(rule(css, '.pi-card')).toMatch(/margin:\s*auto/);
	});
});
