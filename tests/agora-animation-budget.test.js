// The /agora animation budget: which citizens run their AnimationMixer this
// frame. Pure, so the rules are pinned without a renderer.

import { describe, expect, it } from 'vitest';
import { MAX_ANIMATED, LOW_RATE_EVERY, selectAnimated } from '../src/agora/animation-budget.js';

const cam = { x: 0, y: 16, z: 30 };
const mk = (id, x, z, extra = {}) => ({ id, x, z, onScreen: true, busy: false, walking: false, ...extra });
const crowd = (n) => Array.from({ length: n }, (_, i) => mk(`c${i}`, (i % 20) * 2 - 20, Math.floor(i / 20) * 2));

describe('selectAnimated', () => {
	it('never animates more than the cap and animates everyone below it', () => {
		const out = selectAnimated({ items: crowd(200), camera: cam, cap: 40, frame: 1, prev: new Set() });
		expect(out.full.size).toBe(40);
		const few = selectAnimated({ items: crowd(10), camera: cam, cap: 40, frame: 1, prev: new Set() });
		expect(few.full.size).toBe(10);
	});

	it('prefers the nearest on-screen citizens', () => {
		const items = [mk('far', 0, -80), mk('near', 0, 25), mk('mid', 0, 0)];
		const out = selectAnimated({ items, camera: cam, cap: 2, frame: 1, prev: new Set() });
		expect([...out.full].sort()).toEqual(['mid', 'near']);
	});

	it('ranks an on-screen citizen over a nearer off-screen one', () => {
		const items = [mk('behind', 0, 29, { onScreen: false }), mk('visible', 0, -40)];
		const out = selectAnimated({ items, camera: cam, cap: 1, frame: 1, prev: new Set() });
		expect([...out.full]).toEqual(['visible']);
	});

	it('ranks a busy or walking citizen over an idle one regardless of distance', () => {
		const items = [mk('idle-near', 0, 28), mk('busy-far', 0, -60, { busy: true }), mk('walker-far', 0, -70, { walking: true })];
		const out = selectAnimated({ items, camera: cam, cap: 2, frame: 1, prev: new Set() });
		expect([...out.full].sort()).toEqual(['busy-far', 'walker-far']);
	});

	it('holds a selection against a near-tie so avatars do not flicker', () => {
		const items = [mk('a', 0, 10), mk('b', 0, 9.6)];
		const first = selectAnimated({ items, camera: cam, cap: 1, frame: 1, prev: new Set(['b']) });
		expect([...first.full]).toEqual(['b']);
		const second = selectAnimated({ items, camera: cam, cap: 1, frame: 2, prev: new Set(['a']) });
		expect([...second.full]).toEqual(['a']);
	});

	it('gives every unselected citizen a low-rate update within LOW_RATE_EVERY frames', () => {
		const items = crowd(120);
		const seen = new Set();
		let prev = new Set();
		for (let frame = 0; frame < LOW_RATE_EVERY; frame++) {
			const out = selectAnimated({ items, camera: cam, cap: 40, frame, prev });
			prev = out.full;
			for (const id of out.low) seen.add(id);
			for (const id of out.full) expect(out.low.has(id)).toBe(false);
		}
		const everyone = new Set(items.map((i) => i.id));
		for (const id of prev) everyone.delete(id);
		for (const id of everyone) expect(seen.has(id), id).toBe(true);
	});

	it('runs a bounded number of mixers per frame', () => {
		const out = selectAnimated({ items: crowd(200), camera: cam, cap: 40, frame: 3, prev: new Set() });
		expect(out.full.size + out.low.size).toBeLessThanOrEqual(40 + Math.ceil(200 / LOW_RATE_EVERY));
	});

	it('animates nobody under reduced motion', () => {
		const out = selectAnimated({ items: crowd(50), camera: cam, cap: 40, frame: 1, prev: new Set(), reducedMotion: true });
		expect(out.full.size).toBe(0);
		expect(out.low.size).toBe(0);
	});

	it('exports the documented caps', () => {
		expect(MAX_ANIMATED).toBeGreaterThanOrEqual(16);
		expect(LOW_RATE_EVERY).toBe(8);
	});
});
