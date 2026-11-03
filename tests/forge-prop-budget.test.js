// Size budget for props entering a shared world (src/game/prop-budget.js).
// A placed prop is delivered raw to every player, so the ceiling is the line
// between a demo moment and a crashed phone. Pins: the tiers (and that a phone
// is held one tier lower than the same hardware on a desktop), the over-budget
// decision, the simplify target, and the GLB triangle counter.

import { describe, it, expect } from 'vitest';
import {
	MB, CROWD_MODEL_BYTES, PROP_TRIANGLES, budgetTier, propBudget, overBudget,
	simplifyTarget, countGlbTriangles, describeSize,
} from '../src/game/prop-budget.js';
import { makeGlb } from './helpers/make-glb.js';

describe('budgetTier / propBudget', () => {
	it('steps a coarse pointer down exactly one tier and never past low', () => {
		expect(budgetTier('high', false)).toBe('high');
		expect(budgetTier('high', true)).toBe('medium');
		expect(budgetTier('medium', true)).toBe('low');
		expect(budgetTier('low', true)).toBe('low');
	});

	it('is stricter on a coarse pointer than on desktop for the same profile', () => {
		const desktop = propBudget({ profile: 'medium', coarse: false });
		const phone = propBudget({ profile: 'medium', coarse: true });
		expect(phone.maxTriangles).toBeLessThan(desktop.maxTriangles);
		expect(phone.maxBytes).toBeLessThan(desktop.maxBytes);
	});

	it('derives byte ceilings from the crowd tiers, capped at the room prop limit', () => {
		expect(propBudget({ profile: 'high', coarse: false }).maxBytes).toBe(8 * MB);
		expect(propBudget({ profile: 'medium', coarse: false }).maxBytes).toBe(CROWD_MODEL_BYTES.medium);
		expect(propBudget({ profile: 'low', coarse: false }).maxBytes).toBe(CROWD_MODEL_BYTES.low);
		expect(propBudget({ profile: 'high', coarse: false }).maxTriangles).toBe(PROP_TRIANGLES.high);
	});
});

describe('overBudget / simplifyTarget', () => {
	const budget = propBudget({ profile: 'medium', coarse: false });
	it('passes a model inside the ceiling untouched', () => {
		expect(overBudget({ triangles: 10_000, bytes: 1 * MB }, budget)).toEqual([]);
	});
	it('names each ceiling that is exceeded', () => {
		expect(overBudget({ triangles: budget.maxTriangles + 1, bytes: 1 * MB }, budget)).toEqual(['triangles']);
		expect(overBudget({ triangles: 10, bytes: budget.maxBytes + 1 }, budget)).toEqual(['bytes']);
		expect(overBudget({ triangles: budget.maxTriangles + 1, bytes: budget.maxBytes + 1 }, budget)).toEqual(['triangles', 'bytes']);
	});
	it('aims the simplify pass under the ceiling and above the worker floor', () => {
		expect(simplifyTarget(budget)).toBeLessThan(budget.maxTriangles);
		expect(simplifyTarget({ maxTriangles: 500 })).toBe(1_000);
	});
	it('describes a size for user-facing copy', () => {
		expect(describeSize({ triangles: 48200, bytes: 9.4 * MB })).toBe('48,200 triangles, 9.4 MB');
	});
});

describe('countGlbTriangles', () => {
	it('counts indexed triangles from the JSON chunk', () => {
		expect(countGlbTriangles(makeGlb({ triangles: 4321 }))).toBe(4321);
	});
	it('counts every node instancing the mesh', () => {
		expect(countGlbTriangles(makeGlb({ triangles: 100, instances: 3 }))).toBe(300);
	});
	it('refuses a file that is not a GLB', () => {
		expect(() => countGlbTriangles(new TextEncoder().encode('{"not":"glb","padding":"xxxxxxxxxxxxxxxx"}').buffer)).toThrow(/not a GLB/);
	});
});
