import { describe, it, expect } from 'vitest';
import {
	SANCTIONED_COUNTRIES,
	isSanctionedTerritory,
	normalizeDetectedBoxes,
	parseUserBoxes,
} from '../api/_lib/forge-objects.js';

describe('isSanctionedTerritory', () => {
	it('blocks only positively resolved comprehensively sanctioned countries', () => {
		for (const c of SANCTIONED_COUNTRIES) expect(isSanctionedTerritory(c)).toBe(true);
		expect(isSanctionedTerritory('ir')).toBe(true);
		expect(isSanctionedTerritory('US')).toBe(false);
		expect(isSanctionedTerritory('DE')).toBe(false);
	});
	it('does not turn away an unresolved country', () => {
		expect(isSanctionedTerritory(null)).toBe(false);
		expect(isSanctionedTerritory(undefined)).toBe(false);
		expect(isSanctionedTerritory('')).toBe(false);
	});
});

describe('normalizeDetectedBoxes', () => {
	it('converts [ymin, xmin, ymax, xmax] on 0..1000 to [x0, y0, x1, y1] fractions', () => {
		const out = normalizeDetectedBoxes({ objects: [{ label: 'chair', box_2d: [200, 100, 800, 500] }] });
		expect(out).toEqual([{ label: 'chair', box: [0.1, 0.2, 0.5, 0.8] }]);
	});
	it('orders largest first, drops slivers and near-duplicates, and honours the cap', () => {
		const out = normalizeDetectedBoxes(
			{
				objects: [
					{ label: 'small', box_2d: [0, 0, 100, 100] },
					{ label: 'big', box_2d: [0, 0, 900, 900] },
					{ label: 'big again', box_2d: [10, 10, 900, 900] },
					{ label: 'sliver', box_2d: [0, 0, 500, 10] },
					{ label: 'inverted', box_2d: [500, 500, 400, 400] },
				],
			},
			5,
		);
		expect(out.map((o) => o.label)).toEqual(['big', 'small']);
		expect(normalizeDetectedBoxes({ objects: [{ box_2d: [0, 0, 500, 500] }, { box_2d: [500, 500, 1000, 1000] }] }, 1)).toHaveLength(1);
	});
	it('clamps to the frame and tolerates junk', () => {
		expect(normalizeDetectedBoxes({ objects: [{ label: 'x', box_2d: [-50, -50, 1200, 1200] }] })[0].box).toEqual([0, 0, 1, 1]);
		expect(normalizeDetectedBoxes(null)).toEqual([]);
		expect(normalizeDetectedBoxes({ objects: [{ box_2d: ['a', 1, 2, 3] }, { box_2d: [1, 2] }, null, 7] })).toEqual([]);
	});
	it('accepts a bare array and trims labels', () => {
		const out = normalizeDetectedBoxes([{ label: '  red   mug ', box_2d: [100, 100, 400, 400] }]);
		expect(out[0].label).toBe('red mug');
	});
});

describe('parseUserBoxes', () => {
	it('accepts valid boxes untouched and in order', () => {
		const r = parseUserBoxes([[0.1, 0.1, 0.4, 0.5], [0.6, 0.6, 0.9, 0.9]]);
		expect(r.boxes).toEqual([[0.1, 0.1, 0.4, 0.5], [0.6, 0.6, 0.9, 0.9]]);
	});
	it('names the offending box', () => {
		expect(parseUserBoxes([[0.1, 0.1, 0.4, 0.5], [0.5, 0.5, 0.4, 0.4]]).error).toMatch(/boxes\[1\]/);
		expect(parseUserBoxes([[0, 0, 2, 1]]).error).toMatch(/boxes\[0\]/);
		expect(parseUserBoxes([['0', 0, 1, 1]]).error).toMatch(/four numbers/);
		expect(parseUserBoxes([[0.1, 0.1, 0.12, 0.9]]).error).toMatch(/too small/);
	});
	it('rejects two boxes that name the same object, an empty list and too many boxes', () => {
		expect(parseUserBoxes([[0.1, 0.1, 0.5, 0.5], [0.11, 0.11, 0.5, 0.5]]).error).toMatch(/same object/);
		expect(parseUserBoxes([]).error).toBeTruthy();
		expect(parseUserBoxes([[0, 0, 0.5, 0.5], [0.5, 0.5, 1, 1]], 1).error).toMatch(/max_objects/);
	});
});
