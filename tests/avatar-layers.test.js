// The texture-layer compositor (src/avatar-layers.js): pure RGBA maths, so every
// property the bake relies on is checked here with small hand-built inputs.

import { describe, it, expect } from 'vitest';
import {
	compositeLayers,
	layerRegionError,
	layerSources,
	parseLayerSource,
	MAX_LAYERS,
} from '../src/avatar-layers.js';
import { REGION_MASK_VALUES } from '../src/garment-taxonomy.js';

const SIZE = 64;

/** Left half torso, right half scalp, one byte per pixel at the output size. */
function halfMask() {
	const data = new Uint8Array(SIZE * SIZE);
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) data[y * SIZE + x] = x < SIZE / 2 ? REGION_MASK_VALUES.torso : REGION_MASK_VALUES.scalp;
	}
	return { width: SIZE, height: SIZE, data };
}

function solid(w, h, [r, g, b, a = 255]) {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < w * h; i++) data.set([r, g, b, a], i * 4);
	return { width: w, height: h, data };
}

const layer = (over = {}) => ({
	id: 'l1',
	kind: 'makeup',
	source: 'catalog:red',
	region: 'all',
	opacity: 1,
	blend: 'normal',
	uv: { offset: [0.5, 0.5], scale: 2, rotation: 0 },
	...over,
});

const px = (out, x, y) => [...out.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)];

describe('compositeLayers', () => {
	const base = [200, 150, 120];
	const sources = new Map([['catalog:red', solid(8, 8, [255, 0, 0])]]);

	it('returns the flat skin colour with no layers', () => {
		const out = compositeLayers({ size: SIZE, base, layers: [], sources, mask: halfMask() });
		expect(px(out, 3, 3)).toEqual([200, 150, 120, 255]);
		expect(px(out, 60, 60)).toEqual([200, 150, 120, 255]);
	});

	it('is deterministic: the same input gives byte-identical pixels', () => {
		const args = { size: SIZE, base, layers: [layer({ blend: 'overlay', opacity: 0.6, uv: { offset: [0.4, 0.5], scale: 0.7, rotation: 33 } })], sources, mask: halfMask() };
		expect(Buffer.from(compositeLayers(args))).toEqual(Buffer.from(compositeLayers(args)));
	});

	it('clips a layer to its region so it cannot spill onto the face', () => {
		const out = compositeLayers({ size: SIZE, base, layers: [layer({ kind: 'tattoo', region: 'torso' })], sources, mask: halfMask() });
		expect(px(out, 10, 32)).toEqual([255, 0, 0, 255]);
		expect(px(out, 50, 32)).toEqual([200, 150, 120, 255]);
	});

	it('scalp also covers unassigned pixels so makeup reaches the jaw and mouth', () => {
		const data = new Uint8Array(SIZE * SIZE); // all unassigned (code 0)
		const mask = { width: SIZE, height: SIZE, data };
		const head = compositeLayers({ size: SIZE, base, layers: [layer({ region: 'scalp' })], sources, mask });
		expect(px(head, 10, 10)).toEqual([255, 0, 0, 255]);
		const arm = compositeLayers({ size: SIZE, base, layers: [layer({ region: 'upperArms' })], sources, mask });
		expect(px(arm, 10, 10)).toEqual([200, 150, 120, 255]);
	});

	it('region all paints everywhere', () => {
		const out = compositeLayers({ size: SIZE, base, layers: [layer()], sources, mask: halfMask() });
		expect(px(out, 50, 32)).toEqual([255, 0, 0, 255]);
	});

	it('applies opacity, multiply and tint', () => {
		const half = compositeLayers({ size: SIZE, base, layers: [layer({ opacity: 0.5 })], sources, mask: halfMask() });
		expect(px(half, 5, 5)).toEqual([228, 75, 60, 255]);
		const mul = compositeLayers({ size: SIZE, base, layers: [layer({ blend: 'multiply' })], sources, mask: halfMask() });
		expect(px(mul, 5, 5)).toEqual([200, 0, 0, 255]);
		const white = new Map([['catalog:white', solid(4, 4, [255, 255, 255])]]);
		const tinted = compositeLayers({ size: SIZE, base, layers: [layer({ source: 'catalog:white', tint: '#336699' })], sources: white, mask: halfMask() });
		expect(px(tinted, 5, 5)).toEqual([51, 102, 153, 255]);
	});

	it('honours sprite alpha and leaves transparent texels alone', () => {
		const half = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 0]) };
		const out = compositeLayers({
			size: SIZE, base,
			layers: [layer({ source: 'catalog:half', uv: { offset: [0.5, 0.5], scale: 1, rotation: 0 } })],
			sources: new Map([['catalog:half', half]]), mask: halfMask(),
		});
		expect(px(out, 4, 32)).toEqual([255, 0, 0, 255]);
		expect(px(out, 60, 32)).toEqual([200, 150, 120, 255]);
	});

	it('rotates and scales about the offset centre', () => {
		// A 2x1 sprite, left texel red, right texel blue, rotated 90 degrees clockwise:
		// red ends up on top and blue underneath.
		const rb = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) };
		const out = compositeLayers({
			size: SIZE, base,
			layers: [layer({ source: 'catalog:rb', uv: { offset: [0.5, 0.5], scale: 0.5, rotation: 90 } })],
			sources: new Map([['catalog:rb', rb]]), mask: { width: SIZE, height: SIZE, data: new Uint8Array(SIZE * SIZE) },
		});
		expect(px(out, 32, 19)).toEqual([255, 0, 0, 255]);
		expect(px(out, 32, 45)).toEqual([0, 0, 255, 255]);
		expect(px(out, 8, 8)).toEqual([200, 150, 120, 255]);
	});

	it('stacks layers bottom first', () => {
		const sources2 = new Map([['catalog:red', solid(4, 4, [255, 0, 0])], ['catalog:green', solid(4, 4, [0, 255, 0])]]);
		const out = compositeLayers({ size: SIZE, base, layers: [layer(), layer({ id: 'l2', source: 'catalog:green' })], sources: sources2, mask: halfMask() });
		expect(px(out, 5, 5)).toEqual([0, 255, 0, 255]);
	});

	it('fails loudly on a missing source or a bad size', () => {
		expect(() => compositeLayers({ size: SIZE, base, layers: [layer()], sources: new Map(), mask: halfMask() })).toThrow(/not provided/);
		expect(() => compositeLayers({ size: 3, base, layers: [], sources, mask: halfMask() })).toThrow(RangeError);
	});
});

describe('layer rules', () => {
	it('parses sources and refuses URLs', () => {
		expect(parseLayerSource('catalog:freckles')).toEqual({ type: 'catalog', id: 'freckles' });
		expect(parseLayerSource('upload:ab12')).toEqual({ type: 'upload', id: 'ab12' });
		expect(parseLayerSource('https://evil.test/a.png')).toBeNull();
		expect(parseLayerSource('data:image/png;base64,AAAA')).toBeNull();
	});

	it('keeps tattoos and decals off the head', () => {
		expect(layerRegionError({ kind: 'tattoo', region: 'scalp' })).toMatch(/head/);
		expect(layerRegionError({ kind: 'decal', region: 'all' })).toMatch(/whole body/);
		expect(layerRegionError({ kind: 'tattoo', region: 'upperArms' })).toBeNull();
		expect(layerRegionError({ kind: 'makeup', region: 'scalp' })).toBeNull();
	});

	it('lists distinct sources in first-use order', () => {
		expect(layerSources([{ source: 'catalog:a' }, { source: 'catalog:b' }, { source: 'catalog:a' }])).toEqual(['catalog:a', 'catalog:b']);
		expect(MAX_LAYERS).toBe(8);
	});
});
