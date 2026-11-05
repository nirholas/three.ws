// Studio avatar lane (api/_lib/studio-avatar.js) — the free, self-owned seeder
// engine. Recoloring a rigged Wolf3D/RPM base keeps it a valid, rigged GLB while
// genuinely changing complexion (head-to-toe), hair, outfit and size.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	pickBaseBody,
	pickColorway,
	pickScale,
	recolorGlb,
	BASE_BODIES,
} from '../api/_lib/studio-avatar.js';
import { inspectGlb } from '../api/_lib/glb-inspect.js';

const AV = (f) => resolve(process.cwd(), 'public/avatars', f);

describe('pickBaseBody', () => {
	it('matches the profile gender and is deterministic', () => {
		const p = { gender: 'female' };
		expect(pickBaseBody(p, 'seed-1')).toEqual(pickBaseBody(p, 'seed-1'));
		expect(pickBaseBody(p, 'seed-1').gender).toBe('female');
	});
	it('falls back to the full set for an unknown gender', () => {
		expect(BASE_BODIES).toContainEqual(pickBaseBody({ gender: undefined }, 's'));
	});
});

describe('pickColorway', () => {
	it('is deterministic and maps ethnicity to complexion', () => {
		const p = { gender: 'male', ethnicityKey: 'black-african', grayBias: 0 };
		expect(pickColorway(p, 'k')).toEqual(pickColorway(p, 'k'));
		expect(pickColorway(p, 'k').skin[0]).toBeLessThan(0.6);
	});
	it('gives seniors gray hair when grayBias is high', () => {
		const g = pickColorway({ gender: 'female', ethnicityKey: 'nordic', grayBias: 1 }, 's');
		expect(Math.abs(g.hair[0] - g.hair[2])).toBeLessThan(0.1);
		expect(g.hair[0]).toBeGreaterThan(0.5);
	});
	it('never gives identical top and bottom', () => {
		for (let i = 0; i < 30; i++) {
			const c = pickColorway({ gender: 'male', ethnicityKey: 'latino' }, `m-${i}`);
			expect(c.top).not.toEqual(c.bottom);
		}
	});
});

describe('pickScale', () => {
	it('is deterministic and stays in a believable band', () => {
		const p = { gender: 'male', ageKey: 'adult', build: 'average' };
		expect(pickScale(p, 'z')).toBe(pickScale(p, 'z'));
		for (let i = 0; i < 100; i++) {
			const s = pickScale({ gender: i % 2 ? 'male' : 'female', build: 'stocky' }, `sc-${i}`);
			expect(s).toBeGreaterThanOrEqual(0.88);
			expect(s).toBeLessThanOrEqual(1.12);
		}
	});
	it('trends women shorter than men for the same seed', () => {
		let shorter = 0;
		for (let i = 0; i < 60; i++) {
			const m = pickScale({ gender: 'male', build: 'average' }, `g-${i}`);
			const f = pickScale({ gender: 'female', build: 'average' }, `g-${i}`);
			if (f < m) shorter++;
		}
		expect(shorter).toBe(60);
	});
});

describe('recolorGlb', () => {
	it('keeps every base body a valid, rigged GLB with the skeleton intact', () => {
		for (const body of BASE_BODIES) {
			const glb = readFileSync(AV(body.file));
			const before = inspectGlb(glb);
			const cw = pickColorway({ gender: body.gender, ethnicityKey: 'south-asian' }, body.id);
			const { buffer, recolored, scale } = recolorGlb(
				glb,
				cw,
				pickScale({ gender: body.gender }, body.id),
			);
			const after = inspectGlb(buffer);
			expect(after?.valid).toBe(true);
			expect(after?.isRigged).toBe(true);
			expect(after?.skeletonJointCount).toBe(before?.skeletonJointCount);
			expect(recolored.length).toBeGreaterThan(0);
			expect(scale).toBeGreaterThan(0);
		}
	});
	it('tints face and body skin the same for head-to-toe complexion', () => {
		const glb = readFileSync(AV('realistic-male.glb'));
		const cw = pickColorway({ gender: 'male', ethnicityKey: 'black-african' }, 'x');
		const { buffer, recolored } = recolorGlb(glb, cw);
		// realistic-male has both Wolf3D_Skin (face) and Wolf3D_Body (limbs)
		expect(recolored).toEqual(expect.arrayContaining(['Wolf3D_Skin', 'Wolf3D_Body']));
		const gltf = JSON.parse(buffer.slice(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
		const skin = gltf.materials.find((m) => m.name === 'Wolf3D_Skin');
		const bodyMat = gltf.materials.find((m) => m.name === 'Wolf3D_Body');
		// The face's tone lives in its texture (white factor); the untextured
		// body keeps its tone in the factor. The complexion multiplies both, so
		// hands match the face. Overwriting the body factor gave flat white hands.
		const orig = JSON.parse(glb.slice(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
		const origBody = orig.materials.find((m) => m.name === 'Wolf3D_Body').pbrMetallicRoughness.baseColorFactor;
		expect(skin.pbrMetallicRoughness.baseColorFactor.slice(0, 3)).toEqual(cw.skin);
		const got = bodyMat.pbrMetallicRoughness.baseColorFactor;
		for (let c = 0; c < 3; c++) expect(got[c]).toBeCloseTo(origBody[c] * cw.skin[c], 6);
	});
	it('applies a uniform scale to the scene roots', () => {
		const glb = readFileSync(AV('realistic-female.glb'));
		const { buffer } = recolorGlb(glb, pickColorway({ gender: 'female' }, 's'), 1.1);
		const gltf = JSON.parse(buffer.slice(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
		const roots = (gltf.scenes[gltf.scene ?? 0].nodes || []).map((i) => gltf.nodes[i]);
		// at least one root now carries a ~1.1 scale
		const scaled = roots.some(
			(n) => Array.isArray(n.scale) && Math.abs(n.scale[1] - 1.1) < 0.02,
		);
		expect(scaled).toBe(true);
	});
	it('rejects non-GLB input', () => {
		expect(() => recolorGlb(Buffer.from('not a glb'), pickColorway({}, 's'))).toThrow();
	});
});
