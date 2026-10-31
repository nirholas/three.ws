import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
	SHAPES,
	SQUASH,
	carve,
	createMaterials,
	createShell,
	bakeGeometry,
	meshVolume,
	surfaceNormal,
	triangleCount,
} from '../src/pumpkin/geometry.js';

const materials = createMaterials();
const shell = createShell(materials, 10);

function cutAt(shape, dir, size = 0.4) {
	const point = new Vector3(...dir).normalize();
	point.y *= SQUASH;
	return { shape, point, normal: surfaceNormal(point), size };
}

describe('pumpkin shell', () => {
	it('is a hollow solid with outer skin and inner flesh groups', () => {
		const baked = bakeGeometry(shell);
		const used = new Set(baked.groups.map((g) => g.materialIndex));
		expect(used.size).toBe(2);
		expect(meshVolume(baked)).toBeGreaterThan(0.5);
	});
});

describe('carving', () => {
	it.each(SHAPES.map((s) => s.id))('a %s cut removes material and keeps a closed solid', (id) => {
		const before = meshVolume(bakeGeometry(shell));
		const carved = carve(shell, cutAt(id, [0, 0.2, 1]), materials);
		const after = meshVolume(bakeGeometry(carved));
		expect(after).toBeLessThan(before);
		expect(after).toBeGreaterThan(before * 0.8);
		expect(triangleCount(carved)).toBeGreaterThan(triangleCount(shell));
	});

	it('never mutates the brush it carves, so undo can keep it', () => {
		const tris = triangleCount(shell);
		const vol = meshVolume(bakeGeometry(shell));
		carve(shell, cutAt('star', [1, 0, 0]), materials);
		expect(triangleCount(shell)).toBe(tris);
		expect(meshVolume(bakeGeometry(shell))).toBe(vol);
	});

	it('exposes pale flesh on the cut walls', () => {
		const carved = carve(shell, cutAt('round', [0, 0, 1]), materials);
		const flesh = bakeGeometry(carved).groups.filter((g) => carved.material[g.materialIndex] === materials.flesh);
		expect(flesh.length).toBeGreaterThan(0);
	});

	it('chains several cuts and keeps removing volume', () => {
		let brush = shell;
		let last = meshVolume(bakeGeometry(brush));
		for (const dir of [[-0.4, 0.3, 1], [0.4, 0.3, 1], [0, -0.3, 1]]) {
			brush = carve(brush, cutAt('triangle', dir, 0.3), materials);
			const v = meshVolume(bakeGeometry(brush));
			expect(v).toBeLessThan(last);
			last = v;
		}
	});
});
