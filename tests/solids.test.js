import { describe, it, expect } from 'vitest';
import { resolveSolids, insideSolids, boxSolid } from '../src/shared/solids.js';

const disc = (x, z, keepout) => ({ group: { position: { x, z } }, keepout });

describe('shared solids', () => {
	it('pushes a body radially out of a cylinder keep-out and leaves it alone outside', () => {
		const p = resolveSolids({ x: 0.5, z: 0 }, [disc(0, 0, 2)]);
		expect(p.x).toBeCloseTo(2);
		expect(p.z).toBeCloseTo(0);
		const q = resolveSolids({ x: 3, z: 0 }, [disc(0, 0, 2)]);
		expect(q).toEqual({ x: 3, z: 0 });
	});

	it('uses the caller default radius for cylinders that carry none', () => {
		const p = resolveSolids({ x: 1, z: 0 }, [{ group: { position: { x: 0, z: 0 } } }], { keepout: 2.4 });
		expect(p.x).toBeCloseTo(2.4);
	});

	it('pushes a body out of an axis-aligned wall along the nearest face', () => {
		// A 6 m wall, 0.3 m thick, padded 0.35: the body is inside and nearer the +z face.
		const wall = boxSolid(0, 0, 0, 6, 0.3);
		const p = resolveSolids({ x: 1, z: 0.2 }, [wall]);
		expect(p.x).toBeCloseTo(1);
		expect(p.z).toBeCloseTo(0.5);
		const q = resolveSolids({ x: 1, z: -0.1 }, [wall]);
		expect(q.z).toBeCloseTo(-0.5);
	});

	it('leaves the ends of a wall open so a doorway beside it is walkable', () => {
		const wall = boxSolid(0, 0, 0, 6, 0.3);
		expect(resolveSolids({ x: 3.5, z: 0 }, [wall])).toEqual({ x: 3.5, z: 0 });
		expect(insideSolids(3.5, 0, [wall])).toBe(false);
		expect(insideSolids(2.9, 0, [wall])).toBe(true);
	});

	it('resolves a rotated wall in its own frame', () => {
		// The same wall turned 90 degrees now runs along z.
		const wall = boxSolid(0, 0, Math.PI / 2, 6, 0.3);
		const p = resolveSolids({ x: 0.2, z: 1 }, [wall]);
		expect(p.z).toBeCloseTo(1);
		expect(Math.abs(p.x)).toBeCloseTo(0.5);
		expect(insideSolids(0, 2.9, [wall])).toBe(true);
		expect(insideSolids(0, 3.5, [wall])).toBe(false);
	});

	it('never leaves a body inside after one pass over a mixed list', () => {
		const solids = [disc(4, 4, 1), boxSolid(0, 0, 0.7, 3, 1)];
		for (const [x, z] of [[4.2, 4.1], [0.1, 0.1], [1, 0.3]]) {
			const p = resolveSolids({ x, z }, solids);
			expect(insideSolids(p.x, p.z, solids)).toBe(false);
		}
	});
});
