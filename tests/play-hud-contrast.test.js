// WCAG contrast for the /play HUD palette, measured from the shipping tokens in
// coincommunities.css rather than from a screenshot, so a token edit that drops
// a pair below 4.5:1 fails here instead of on a venue projector.
//
// The panel is translucent (rgba .92), so the background a label sits on is the
// panel composited over whatever the 3D scene shows behind it. Every pair is
// therefore measured over the two worst scenes: pure white (a sunlit plaza) and
// pure black.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'src/game/coincommunities.css'), 'utf8');

function token(name) {
	const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
	if (!m) throw new Error(`--${name} is no longer defined in coincommunities.css`);
	return m[1].replace(/\/\*.*?\*\//g, '').trim();
}

function parseColor(value) {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
	if (hex) {
		let h = hex[1];
		if (h.length === 3) h = [...h].map((c) => c + c).join('');
		return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
	}
	const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(value);
	if (rgba) return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] };
	throw new Error(`unparseable color: ${value}`);
}

function over(fg, bg) {
	const a = fg.a;
	return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

function luminance({ r, g, b }) {
	const f = (v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg, bg) {
	const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

// The five text roles that carry the most HUD copy, each on the surface it
// actually sits on.
const PAIRS = [
	['cc-text on the panel', 'cc-text', 'cc-panel'],
	['cc-dim (secondary copy) on the panel', 'cc-dim', 'cc-panel'],
	['cc-faint (hints) on the panel', 'cc-faint', 'cc-panel'],
	['cc-warn (connecting state) on the panel', 'cc-warn', 'cc-panel'],
	['cc-ink on the white accent surface', 'cc-ink', 'cc-accent'],
];

describe('/play HUD contrast (WCAG AA, 4.5:1)', () => {
	for (const [label, fgName, bgName] of PAIRS) {
		for (const [sceneName, scene] of [['white scene', WHITE], ['black scene', BLACK]]) {
			it(`${label}, over a ${sceneName}`, () => {
				const bg = over(parseColor(token(bgName)), scene);
				const fg = over(parseColor(token(fgName)), bg);
				const r = ratio(fg, bg);
				expect(r, `${label} measures ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
			});
		}
	}
});
