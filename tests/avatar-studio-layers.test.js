import { describe, it, expect } from 'vitest';
import { hydrateAppearance, collapseAppearance, cloneAppearance, appearanceEqual } from '../src/avatar-studio-utils.js';

const layer = () => ({
	id: 'lips-1', kind: 'makeup', source: 'catalog:lips', region: 'scalp', blend: 'multiply', opacity: 0.8,
	uv: { offset: [0.9, 0.5], scale: 0.1, rotation: -90 },
});

describe('studio appearance carries texture layers', () => {
	it('hydrate and collapse keep the layer stack (a PATCH replaces appearance wholesale)', () => {
		const working = hydrateAppearance({ layers: [layer()] });
		expect(working.layers).toHaveLength(1);
		expect(collapseAppearance(working).layers).toEqual([layer()]);
	});

	it('an empty stack collapses to nothing', () => {
		expect(collapseAppearance(hydrateAppearance({ layers: [] }))).toBeNull();
		expect(hydrateAppearance(null).layers).toEqual([]);
	});

	it('clone isolates layers so history snapshots are not mutated by later edits', () => {
		const a = hydrateAppearance({ layers: [layer()] });
		const b = cloneAppearance(a);
		a.layers[0].uv.offset[0] = 0.1;
		a.layers[0].opacity = 0.1;
		expect(b.layers[0].uv.offset[0]).toBe(0.9);
		expect(b.layers[0].opacity).toBe(0.8);
		expect(appearanceEqual(a, b)).toBe(false);
	});
});
