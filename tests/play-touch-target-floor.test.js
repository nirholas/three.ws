// The /play HUD controls must reach the 44 px touch-target floor (WCAG 2.5.5,
// Apple HIG) on a coarse pointer. scripts/mobile-touch-audit.mjs measures 40 px
// on production, so this reads the shipping stylesheet and fails if the
// coarse-pointer block asks for less.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'src/game/coincommunities.css'), 'utf8');

function coarseBlock() {
	const start = css.indexOf('Touch targets on a coarse pointer');
	const open = css.indexOf('@media (pointer: coarse) {', start);
	let depth = 0;
	for (let i = css.indexOf('{', open); i < css.length; i++) {
		if (css[i] === '{') depth++;
		if (css[i] === '}' && --depth === 0) return css.slice(open, i + 1);
	}
	throw new Error('unterminated coarse-pointer block');
}

describe('play HUD touch targets', () => {
	const block = coarseBlock();
	it('asks for at least 44 px on every min-height and min-width', () => {
		const sizes = [...block.matchAll(/min-(?:height|width):\s*(\d+)px/g)].map((m) => Number(m[1]));
		expect(sizes.length).toBeGreaterThan(5);
		for (const s of sizes) expect(s).toBeGreaterThanOrEqual(44);
	});
});

describe('play onboarding, concierge and minimap on a touch screen', () => {
	const onboard = readFileSync(join(ROOT, 'src/game/play-onboard.js'), 'utf8');
	const concierge = readFileSync(join(ROOT, 'src/game/npc/concierge.js'), 'utf8');
	const hud = readFileSync(join(ROOT, 'src/game/hud/world-hud.css'), 'utf8');

	it('keeps the onboarding coarse-pointer targets at 44 px', () => {
		const start = onboard.indexOf('Thumb-sized targets on a coarse pointer');
		const block = onboard.slice(start, onboard.indexOf('Reduced-motion overrides', start));
		const sizes = [...block.matchAll(/min-(?:height|width):\s*(\d+)px/g)].map((m) => Number(m[1]));
		expect(sizes.length).toBeGreaterThan(2);
		for (const s of sizes) expect(s).toBeGreaterThanOrEqual(44);
	});

	it('gives the clickable concierge name a 44 px target on a coarse pointer', () => {
		expect(concierge).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.concierge-name\s*\{[^}]*min-height:\s*44px/);
	});

	it('stops the minimap canvas from fighting the page gesture', () => {
		expect(hud).toMatch(/\.wh-minimap-canvas\s*\{[^}]*touch-action:\s*none/);
	});
});
