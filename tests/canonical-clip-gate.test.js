// The bone-count gate and the retargeter's coverage floor must give the same
// answer. A library clip carries 53 retargetable tracks, 30 of them finger
// joints. Counting only all 53 put every complete fingerless body (a Meshy AI
// biped, a Mixamo export without hands) at 23 of 53, under the 50% floor: the
// retargeter built no action and the creator's avatar stood in its bind pose.
// The floor now passes on all tracks or on the 23 body tracks, whichever is
// higher, so that body animates and a Ready Player Me half-body (head, spine and
// fingered hands, no arms or legs) keeps the coverage it always had. A rig short
// on both measures still falls back.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Bone, BufferGeometry, Object3D, Skeleton, SkinnedMesh } from 'three';
import { CANONICAL_BONES } from '../src/glb-canonicalize.js';
import {
	MIN_CANONICAL_BONES,
	MIN_COVERAGE,
	canonicalClipGate,
	clearsCoverageFloor,
	predictLibraryCoverage,
} from '../src/canonical-clip-gate.js';
import { MIN_COVERAGE as RETARGET_MIN_COVERAGE, parseClipJSON, retargetClipToObject } from '../src/animation-retarget.js';
import { AnimationManager } from '../src/animation-manager.js';
import { decideRigMode, inspectRig } from '../src/embodiment/rig-mode.js';
import { analyzeGlb } from '../src/rig-report.js';

const FINGER = /Hand(Index|Middle|Ring|Pinky|Thumb)\d$/;
const FULL = [...CANONICAL_BONES];
const NO_FINGERS = CANONICAL_BONES.filter((b) => !FINGER.test(b));
// Body plus the index and middle chains.
const PARTIAL_FINGERS = CANONICAL_BONES.filter((b) => !FINGER.test(b) || /Hand(Index|Middle)\d$/.test(b));
// A Ready Player Me half-body, the shape public/avatars/realistic-halfbody.glb
// ships: 7 of 23 body tracks, but 37 of 53 with its fingers. It has always
// animated (head, torso and hands) and must keep doing so.
const HALF_BODY = [
	'Hips', 'Spine', 'Neck', 'Head', 'LeftHand', 'RightHand',
	...CANONICAL_BONES.filter((b) => FINGER.test(b)),
];
// Arms and legs on a torso missing its spine, shoulders and feet: 11 of 23 body
// tracks and 11 of 53 overall, under the floor either way.
const ARMS_AND_LEGS = [
	'Hips', 'Spine', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm',
	'LeftUpLeg', 'RightUpLeg',
];

const loadClip = (name) =>
	parseClipJSON(
		JSON.parse(readFileSync(resolve(process.cwd(), `public/animations/clips/${name}.json`), 'utf8')),
		name,
	);

function threeRig(names) {
	const root = new Object3D();
	const bones = names.map((name) => {
		const b = new Bone();
		b.name = name;
		return b;
	});
	for (let i = 1; i < bones.length; i++) bones[0].add(bones[i]);
	const mesh = new SkinnedMesh(new BufferGeometry());
	mesh.add(bones[0]);
	mesh.bind(new Skeleton(bones));
	root.add(mesh);
	root.updateMatrixWorld(true);
	return root;
}

// A JSON-only GLB: one skinned mesh node bound to a skin over `names`.
function glbRig(names) {
	const json = {
		asset: { version: '2.0', generator: 'canonical-clip-gate test' },
		nodes: [
			{ name: 'Body', mesh: 0, skin: 0 },
			...names.map((name) => ({ name })),
		],
		meshes: [{ name: 'Body', primitives: [{ attributes: {} }] }],
		skins: [{ joints: names.map((_, i) => i + 1) }],
		scenes: [{ nodes: [0, 1] }],
	};
	json.nodes[1].children = names.slice(1).map((_, i) => i + 2);
	let bytes = new TextEncoder().encode(JSON.stringify(json));
	const pad = (4 - (bytes.length % 4)) % 4;
	if (pad) {
		const padded = new Uint8Array(bytes.length + pad).fill(0x20);
		padded.set(bytes);
		bytes = padded;
	}
	const out = new Uint8Array(20 + bytes.length);
	const v = new DataView(out.buffer);
	v.setUint32(0, 0x46546c67, true);
	v.setUint32(4, 2, true);
	v.setUint32(8, out.length, true);
	v.setUint32(12, bytes.length, true);
	v.setUint32(16, 0x4e4f534a, true);
	out.set(bytes, 20);
	return out.buffer;
}

function managerSupports(names) {
	const mgr = new AnimationManager();
	mgr.attach(threeRig(names));
	try {
		return mgr.supportsCanonicalClips();
	} finally {
		mgr.detach();
	}
}

describe('predictLibraryCoverage', () => {
	it('is the coverage the retargeter actually reports for a library clip', () => {
		for (const names of [FULL, NO_FINGERS, PARTIAL_FINGERS, HALF_BODY, ARMS_AND_LEGS]) {
			for (const clipName of ['idle', 'walk']) {
				const real = retargetClipToObject(loadClip(clipName), threeRig(names), { minCoverage: 0 });
				const predicted = predictLibraryCoverage(names);
				expect(predicted.total, clipName).toBe(real.total);
				expect(predicted.matched, clipName).toBe(real.matched);
				expect(predicted.bodyTotal, clipName).toBe(real.bodyTotal);
				expect(predicted.bodyMatched, clipName).toBe(real.bodyMatched);
				expect(predicted.bodyCoverage, clipName).toBeCloseTo(real.bodyCoverage, 10);
			}
		}
	});

	it('shares one coverage floor with the retargeter', () => {
		expect(RETARGET_MIN_COVERAGE).toBe(MIN_COVERAGE);
	});
});

describe('every "does this rig animate" surface agrees with the retargeter', () => {
	const cases = [
		['a full canonical skeleton', FULL, true],
		['a full body with no finger joints', NO_FINGERS, true],
		['a body with index and middle fingers', PARTIAL_FINGERS, true],
		['a half-body avatar: head, torso and fingered hands', HALF_BODY, true],
		['arms and legs on a torso missing its spine and feet', ARMS_AND_LEGS, false],
	];

	it.each(cases)('%s', (_label, names, animates) => {
		const idle = retargetClipToObject(loadClip('idle'), threeRig(names));
		expect(idle.clip !== null, 'retargeter').toBe(animates);
		expect(names.length).toBeGreaterThanOrEqual(MIN_CANONICAL_BONES);

		expect(canonicalClipGate({ hasSkinnedMesh: true, canonical: names }).ok, 'gate').toBe(animates);
		expect(managerSupports(names), 'AnimationManager').toBe(animates);
		expect(decideRigMode(inspectRig(threeRig(names))).mode, 'rig-mode').toBe(animates ? 'canonical' : 'fallback');
		expect(analyzeGlb(glbRig(names)).verdict.drivable, 'Rig Doctor').toBe(animates);
	});

	it('binds the finger tracks a rig has and animates the body of one that has none', () => {
		const bare = retargetClipToObject(loadClip('idle'), threeRig(NO_FINGERS));
		expect(bare.bodyCoverage).toBe(1);
		expect(bare.clip.tracks.some((t) => /HandIndex/.test(t.name))).toBe(false);
		const partial = retargetClipToObject(loadClip('idle'), threeRig(PARTIAL_FINGERS));
		expect(partial.clip.tracks.some((t) => /HandIndex1\.quaternion$/.test(t.name))).toBe(true);
		expect(partial.matched).toBeGreaterThan(bare.matched);
	});

	it('names both shortfalls when that is the reason a rig falls back', () => {
		const gate = canonicalClipGate({ hasSkinnedMesh: true, canonical: ARMS_AND_LEGS });
		expect(gate.why).toBe('low-coverage');
		expect([gate.bodyMatched, gate.bodyTotal, gate.matched, gate.total]).toEqual([11, 23, 11, 53]);
		expect(decideRigMode(inspectRig(threeRig(ARMS_AND_LEGS))).reason).toMatch(/11 of 23 body clip tracks and 11 of 53 overall/);
		const verdict = analyzeGlb(glbRig(ARMS_AND_LEGS)).verdict;
		expect(verdict.level).toBe('fail');
		expect(verdict.headline).toMatch(/11 of 23 body tracks \(11 of 53 with fingers\)/);
	});

	it('passes a half-body on its finger tracks without needing body ones', () => {
		const gate = canonicalClipGate({ hasSkinnedMesh: true, canonical: HALF_BODY });
		expect(gate.bodyCoverage).toBeLessThan(MIN_COVERAGE);
		expect(gate.coverage).toBeGreaterThanOrEqual(MIN_COVERAGE);
		expect(clearsCoverageFloor(gate)).toBe(true);
		expect(clearsCoverageFloor({ coverage: 0.49, bodyCoverage: 0.49 })).toBe(false);
	});

	it('still refuses a skinless model and a near-empty rig for their own reasons', () => {
		expect(canonicalClipGate({ hasSkinnedMesh: false, canonical: FULL }).why).toBe('no-skin');
		expect(canonicalClipGate({ hasSkinnedMesh: true, canonical: ['Hips', 'Spine', 'Head'] }).why).toBe('too-few-bones');
	});
});
