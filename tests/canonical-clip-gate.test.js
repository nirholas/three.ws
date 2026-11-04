// The bone-count gate and the retargeter's coverage floor must give the same
// answer. A full-body rig with no finger joints maps 23 of a library clip's 53
// tracks: the retargeter builds no action for it, so every surface that decides
// "does this rig animate" has to say no and fall back to the default body,
// instead of keeping the creator's mesh frozen in its bind pose.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Bone, BufferGeometry, Object3D, Skeleton, SkinnedMesh } from 'three';
import { CANONICAL_BONES } from '../src/glb-canonicalize.js';
import {
	MIN_CANONICAL_BONES,
	MIN_COVERAGE,
	canonicalClipGate,
	predictLibraryCoverage,
} from '../src/canonical-clip-gate.js';
import { MIN_COVERAGE as RETARGET_MIN_COVERAGE, parseClipJSON, retargetClipToObject } from '../src/animation-retarget.js';
import { AnimationManager } from '../src/animation-manager.js';
import { decideRigMode, inspectRig } from '../src/embodiment/rig-mode.js';
import { analyzeGlb } from '../src/rig-report.js';

const FINGER = /Hand(Index|Middle|Ring|Pinky|Thumb)\d$/;
const FULL = [...CANONICAL_BONES];
const NO_FINGERS = CANONICAL_BONES.filter((b) => !FINGER.test(b));
// Body plus the index and middle chains: enough tracks to clear the floor.
const PARTIAL_FINGERS = CANONICAL_BONES.filter((b) => !FINGER.test(b) || /Hand(Index|Middle)\d$/.test(b));

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
		for (const names of [FULL, NO_FINGERS, PARTIAL_FINGERS, NO_FINGERS.slice(0, 10)]) {
			for (const clipName of ['idle', 'walk']) {
				const real = retargetClipToObject(loadClip(clipName), threeRig(names), { minCoverage: 0 });
				const predicted = predictLibraryCoverage(names);
				expect(predicted.total, clipName).toBe(real.total);
				expect(predicted.matched, clipName).toBe(real.matched);
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
		['a full body with no finger joints', NO_FINGERS, false],
		['a body with index and middle fingers', PARTIAL_FINGERS, true],
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

	it('names the coverage shortfall rather than the bone count when that is the reason', () => {
		const gate = canonicalClipGate({ hasSkinnedMesh: true, canonical: NO_FINGERS });
		expect(gate.why).toBe('low-coverage');
		expect(decideRigMode(inspectRig(threeRig(NO_FINGERS))).reason).toMatch(/23 of 53/);
		const verdict = analyzeGlb(glbRig(NO_FINGERS)).verdict;
		expect(verdict.level).toBe('fail');
		expect(verdict.headline).toMatch(/23 of 53/);
		expect(verdict.notes.join(' ')).toMatch(/finger/i);
	});

	it('still refuses a skinless model and a near-empty rig for their own reasons', () => {
		expect(canonicalClipGate({ hasSkinnedMesh: false, canonical: FULL }).why).toBe('no-skin');
		expect(canonicalClipGate({ hasSkinnedMesh: true, canonical: ['Hips', 'Spine', 'Head'] }).why).toBe('too-few-bones');
	});
});
