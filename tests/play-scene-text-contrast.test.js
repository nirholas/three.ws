// Meetup #3 client audit (accessibility, contrast): nameplates, verified
// handles, wanted stars and floating damage numbers are drawn straight over the
// 3D scene with only a soft text-shadow. Over a bright sky or a lit plaza floor
// they fell far below 4.5:1. Each now sits on a translucent dark scrim, and this
// test composites that scrim over the worst case (pure white) and checks every
// foreground colour against the result, reading the values from the CSS itself.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const cc = readFileSync('src/game/coincommunities.css', 'utf8');
const combat = readFileSync('src/game/combat-system.css', 'utf8');

function rule(css, selector) {
	const i = css.indexOf(`${selector} {`);
	if (i < 0) throw new Error(`no rule for ${selector}`);
	return css.slice(i, css.indexOf('}', i));
}
function prop(block, name) {
	const m = new RegExp(`(?:^|[\\s;{])${name}:\\s*([^;]+);`).exec(block);
	if (!m) throw new Error(`no ${name} in ${block.slice(0, 60)}`);
	return m[1].trim();
}
function rgba(v) {
	if (v.startsWith('#')) {
		const h = v.slice(1);
		const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
		return [0, 2, 4].map((k) => parseInt(n.slice(k, k + 2), 16)).concat(1);
	}
	const m = /rgba?\(([^)]+)\)/.exec(v);
	if (!m) throw new Error(`not a colour: ${v}`);
	const p = m[1].split(',').map((s) => Number(s.trim()));
	return [p[0], p[1], p[2], p[3] ?? 1];
}
const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
const lum = (c) => {
	const [r, g, b] = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const WHITE = [255, 255, 255];
const pairs = () => {
	const label = rule(cc, '.cc-label');
	const labelBg = over(rgba(prop(label, 'background')), WHITE);
	const dmg = rule(combat, '.combat-dmg');
	const dmgBg = over(rgba(prop(dmg, 'background')), WHITE);
	return [
		['nameplate', rgba(prop(label, 'color')), labelBg],
		['verified handle', rgba(prop(rule(cc, '.cc-label .cc-label-handle'), 'color')), labelBg],
		['wanted stars', rgba(prop(rule(cc, '.cc-label.cc-wanted::after'), 'color')), labelBg],
		['damage dealt', rgba(prop(rule(combat, '.combat-dmg.is-dealt'), 'color')), dmgBg],
		['damage taken', rgba(prop(rule(combat, '.combat-dmg.is-taken'), 'color')), dmgBg],
	];
};

describe('text drawn over the 3D scene', () => {
	for (const [name] of [['nameplate'], ['verified handle'], ['wanted stars'], ['damage dealt'], ['damage taken']]) {
		it(`${name} keeps 4.5:1 even over a white backdrop`, () => {
			const [, fg, bg] = pairs().find(([n]) => n === name);
			expect(ratio(fg.slice(0, 3), bg)).toBeGreaterThanOrEqual(4.5);
		});
	}
});
