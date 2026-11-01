/**
 * White text on the accent colour must stay readable for every accent a visitor
 * can pick. None of the accents in the palette reaches WCAG AA (4.5:1) under
 * white text when used raw, so solid fills that carry white labels paint with
 * --accent-fill, a shaded mix of the accent defined once on .os. These tests
 * hold both halves: the token clears 4.5:1 for every accent (and the Halloween
 * season's orange), and no desktop stylesheet pairs white text with a raw
 * var(--accent) background again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ACCENTS } from '../src/desktop/layout.js';

const ROOT = join(import.meta.dirname, '..', 'src', 'desktop');

function cssFiles(dir) {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) return cssFiles(p);
		return name.endsWith('.css') ? [p] : [];
	});
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const luminance = (rgb) => {
	const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastOnWhite = (rgb) => 1.05 / (luminance(rgb) + 0.05);

/** The mix percentage --accent-fill (and its hover) use, read from desktop.css so the test tracks the real value. */
function fillMix(token) {
	const css = readFileSync(join(ROOT, 'desktop.css'), 'utf8');
	const m = css.match(new RegExp(`${token}:\\s*color-mix\\(in srgb, var\\(--accent\\) (\\d+)%, #000\\)`));
	expect(m, `${token} is defined as a mix of --accent with black in desktop.css`).toBeTruthy();
	return Number(m[1]) / 100;
}

const SEASON_ORANGE = '#ff7a1a';

describe('accent fills under white text', () => {
	it('--accent-fill and its hover clear 4.5:1 under white for every accent and the season orange', () => {
		for (const token of ['--accent-fill', '--accent-fill-hover']) {
			const k = fillMix(token);
			for (const accent of [...ACCENTS, SEASON_ORANGE]) {
				const ratio = contrastOnWhite(hex(accent).map((v) => v * k));
				expect(ratio, `${token} on ${accent}`).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it('no desktop rule sets white text on a raw var(--accent) background', () => {
		const offenders = [];
		for (const file of cssFiles(ROOT)) {
			const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
			for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
				const body = m[2];
				if (/background(-color)?\s*:\s*var\(--accent\)/.test(body) && /(^|[;\s])color\s*:\s*(#fff\b|#ffffff|white)/i.test(body)) {
					const line = css.slice(0, m.index + m[1].length).split('\n').length;
					offenders.push(`${file.slice(ROOT.length + 1)}:${line} ${m[1].trim().split(/\s+/).join(' ')}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
