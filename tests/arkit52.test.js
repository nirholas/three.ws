import { describe, it, expect } from 'vitest';
import {
	ARKIT_52,
	ARKIT_VISEMES,
	MORPH_ALIASES,
	resolveMorphTargets,
	setCanonicalMorph,
	conformanceReport,
} from '../src/runtime/arkit52.js';

// Stand-in for a Three.js mesh: the resolver only walks `.traverse()` and
// reads `morphTargetDictionary` + `morphTargetInfluences`, so a plain object
// with those fields is enough for unit tests.
function fakeMesh(targetNames) {
	const dict = {};
	targetNames.forEach((n, i) => (dict[n] = i));
	return {
		isMesh: true,
		morphTargetDictionary: dict,
		morphTargetInfluences: new Array(targetNames.length).fill(0),
	};
}

function fakeScene(meshes) {
	return {
		traverse(fn) {
			for (const m of meshes) fn(m);
		},
	};
}

describe('ARKIT_52 spec', () => {
	it('lists exactly 52 canonical names', () => {
		expect(ARKIT_52).toHaveLength(52);
	});

	it('includes the named regions covering eyes, jaw, mouth, brows, cheeks, nose, tongue', () => {
		expect(ARKIT_52).toContain('eyeBlinkLeft');
		expect(ARKIT_52).toContain('eyeLookUpRight');
		expect(ARKIT_52).toContain('jawOpen');
		expect(ARKIT_52).toContain('mouthSmileLeft');
		expect(ARKIT_52).toContain('mouthSmileRight');
		expect(ARKIT_52).toContain('mouthFunnel');
		expect(ARKIT_52).toContain('browInnerUp');
		expect(ARKIT_52).toContain('cheekPuff');
		expect(ARKIT_52).toContain('noseSneerLeft');
		expect(ARKIT_52).toContain('tongueOut');
	});

	it('does not duplicate any name', () => {
		const set = new Set(ARKIT_52);
		expect(set.size).toBe(ARKIT_52.length);
	});
});

describe('ARKIT_VISEMES', () => {
	it('contains the 15 standard viseme_ shapes', () => {
		expect(ARKIT_VISEMES).toHaveLength(15);
		expect(ARKIT_VISEMES).toContain('viseme_aa');
		expect(ARKIT_VISEMES).toContain('viseme_sil');
	});
});

describe('MORPH_ALIASES', () => {
	it('maps every alias to a canonical ARKit-52 name', () => {
		for (const [alias, canonical] of Object.entries(MORPH_ALIASES)) {
			expect(
				ARKIT_52.includes(canonical),
				`alias ${alias} → ${canonical} is not in ARKIT_52`,
			).toBe(true);
		}
	});

	it('routes snake_case to camelCase', () => {
		expect(MORPH_ALIASES.mouth_smile_left).toBe('mouthSmileLeft');
		expect(MORPH_ALIASES.brow_inner_up).toBe('browInnerUp');
		expect(MORPH_ALIASES.jaw_open).toBe('jawOpen');
	});

	it('routes _L / _R suffix variants', () => {
		expect(MORPH_ALIASES.eyeBlink_L).toBe('eyeBlinkLeft');
		expect(MORPH_ALIASES.mouthSmile_R).toBe('mouthSmileRight');
	});

	it('routes combined shapes to a Left side so the auto-mirror handles the pair', () => {
		expect(MORPH_ALIASES.mouthSmile).toBe('mouthSmileLeft');
		expect(MORPH_ALIASES.mouthFrown).toBe('mouthFrownLeft');
		expect(MORPH_ALIASES.eyesClosed).toBe('eyeBlinkLeft');
	});

	it('routes mouthOpen to jawOpen for backwards-compat', () => {
		expect(MORPH_ALIASES.mouthOpen).toBe('jawOpen');
	});
});

describe('resolveMorphTargets', () => {
	it('builds a canonical → [{mesh, index}] map for an ARKit-named rig', () => {
		const mesh = fakeMesh(['mouthSmileLeft', 'mouthSmileRight', 'jawOpen']);
		const resolved = resolveMorphTargets(fakeScene([mesh]));

		expect(resolved.get('mouthSmileLeft')).toHaveLength(1);
		expect(resolved.get('mouthSmileLeft')[0].mesh).toBe(mesh);
		expect(resolved.get('mouthSmileLeft')[0].index).toBe(0);
		expect(resolved.get('jawOpen')[0].index).toBe(2);
	});

	it('normalizes snake_case morph names to canonical entries', () => {
		const mesh = fakeMesh(['mouth_smile_left', 'jaw_open']);
		const resolved = resolveMorphTargets(fakeScene([mesh]));
		expect(resolved.has('mouthSmileLeft')).toBe(true);
		expect(resolved.has('jawOpen')).toBe(true);
	});

	it('handles a combined mouthSmile by registering it as mouthSmileLeft', () => {
		const mesh = fakeMesh(['mouthSmile', 'jawOpen']);
		const resolved = resolveMorphTargets(fakeScene([mesh]));
		expect(resolved.has('mouthSmileLeft')).toBe(true);
		expect(resolved.has('mouthSmileRight')).toBe(false);
	});

	it('ignores morphs that are neither canonical nor aliased', () => {
		const mesh = fakeMesh(['custom_lipPucker', 'brand_X']);
		const resolved = resolveMorphTargets(fakeScene([mesh]));
		expect(resolved.size).toBe(0);
	});

	it('aggregates slots across multiple meshes', () => {
		const a = fakeMesh(['jawOpen']);
		const b = fakeMesh(['jawOpen', 'browInnerUp']);
		const resolved = resolveMorphTargets(fakeScene([a, b]));
		expect(resolved.get('jawOpen')).toHaveLength(2);
		expect(resolved.get('browInnerUp')).toHaveLength(1);
	});

	it('returns an empty map for a null root', () => {
		expect(resolveMorphTargets(null).size).toBe(0);
	});
});

describe('setCanonicalMorph', () => {
	it('applies a weight to all mesh slots bound to that canonical name', () => {
		const a = fakeMesh(['jawOpen']);
		const b = fakeMesh(['jawOpen']);
		const resolved = resolveMorphTargets(fakeScene([a, b]));
		setCanonicalMorph(resolved, 'jawOpen', 0.7);
		expect(a.morphTargetInfluences[0]).toBeCloseTo(0.7);
		expect(b.morphTargetInfluences[0]).toBeCloseTo(0.7);
	});

	it('clamps weight to [0, 1]', () => {
		const m = fakeMesh(['jawOpen']);
		const resolved = resolveMorphTargets(fakeScene([m]));
		setCanonicalMorph(resolved, 'jawOpen', 2.5);
		expect(m.morphTargetInfluences[0]).toBe(1);
		setCanonicalMorph(resolved, 'jawOpen', -1);
		expect(m.morphTargetInfluences[0]).toBe(0);
	});

	it('mirrors a Left set to the matching Right side', () => {
		const m = fakeMesh(['mouthSmileLeft', 'mouthSmileRight']);
		const resolved = resolveMorphTargets(fakeScene([m]));
		setCanonicalMorph(resolved, 'mouthSmileLeft', 0.8);
		expect(m.morphTargetInfluences[0]).toBeCloseTo(0.8);
		expect(m.morphTargetInfluences[1]).toBeCloseTo(0.8);
	});

	it('does not mirror when opts.mirror is false', () => {
		const m = fakeMesh(['mouthSmileLeft', 'mouthSmileRight']);
		const resolved = resolveMorphTargets(fakeScene([m]));
		setCanonicalMorph(resolved, 'mouthSmileLeft', 0.6, { mirror: false });
		expect(m.morphTargetInfluences[0]).toBeCloseTo(0.6);
		expect(m.morphTargetInfluences[1]).toBe(0);
	});

	it('no-ops for unknown canonical names', () => {
		const m = fakeMesh(['jawOpen']);
		const resolved = resolveMorphTargets(fakeScene([m]));
		expect(() => setCanonicalMorph(resolved, 'doesNotExist', 1)).not.toThrow();
	});
});

describe('conformanceReport', () => {
	it('reports 100% coverage for a rig that ships every ARKit-52 morph', () => {
		const mesh = fakeMesh([...ARKIT_52]);
		const r = conformanceReport(fakeScene([mesh]));
		expect(r.coverage).toBe(1);
		expect(r.implemented).toHaveLength(52);
		expect(r.missing).toHaveLength(0);
	});

	it('reports 0% coverage for a rig with no recognized morphs', () => {
		const mesh = fakeMesh(['unrelatedMorph']);
		const r = conformanceReport(fakeScene([mesh]));
		expect(r.coverage).toBe(0);
		expect(r.missing).toHaveLength(52);
	});

	it('counts aliased shapes toward coverage', () => {
		const mesh = fakeMesh(['mouth_smile_left', 'mouth_smile_right', 'jaw_open']);
		const r = conformanceReport(fakeScene([mesh]));
		expect(r.implemented).toContain('mouthSmileLeft');
		expect(r.implemented).toContain('mouthSmileRight');
		expect(r.implemented).toContain('jawOpen');
		expect(r.coverage).toBeCloseTo(3 / 52);
	});
});
