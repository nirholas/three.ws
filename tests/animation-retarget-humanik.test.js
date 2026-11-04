// An Autodesk HumanIK / MotionBuilder export names every joint behind a
// character namespace (`Character1:Hips`, `Character1:LeftArm`). three.js never
// shows the runtime that spelling: GLTFLoader names every node through
// PropertyBinding.sanitizeNodeName, which deletes the colon, so the retargeter
// reads `Character1Hips`. The name table resolved only the colon form, so a
// HumanIK rig passed every offline check and then stood in its bind pose on the
// page. This suite renames a real avatar's joints to the HumanIK spelling,
// loads it through the real GLTFLoader, and holds the runtime to the same bone
// set and clip coverage the untouched rig gets.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
	MIN_COVERAGE,
	canonicalNodeMapFromObject,
	parseClipJSON,
	retargetClipToObject,
	retargetClipToRig,
} from '../src/animation-retarget.js';
import { canonicalizeBoneName } from '../src/glb-canonicalize.js';
import { makeGltfRig } from '../src/pose-rig.js';

const GLB_PATH = resolve(process.cwd(), 'public/avatars/parametric-base.glb');
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

// Rewrite a GLB's JSON chunk with `rename` applied to every skin joint, keeping
// the BIN chunk byte-for-byte, so the result is a real file GLTFLoader parses.
function renameJoints(bytes, rename) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	expect(view.getUint32(0, true)).toBe(GLB_MAGIC);
	const jsonLen = view.getUint32(12, true);
	expect(view.getUint32(16, true)).toBe(CHUNK_JSON);
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
	const joints = new Set();
	for (const skin of json.skins || []) for (const j of skin.joints || []) joints.add(j);
	for (const j of joints) {
		const node = json.nodes[j];
		if (node && typeof node.name === 'string') node.name = rename(node.name);
	}
	let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
	const pad = (4 - (jsonBytes.length % 4)) % 4;
	if (pad) {
		const padded = new Uint8Array(jsonBytes.length + pad).fill(0x20);
		padded.set(jsonBytes);
		jsonBytes = padded;
	}
	const rest = bytes.subarray(20 + jsonLen);
	const out = new Uint8Array(20 + jsonBytes.length + rest.length);
	const ov = new DataView(out.buffer);
	ov.setUint32(0, GLB_MAGIC, true);
	ov.setUint32(4, 2, true);
	ov.setUint32(8, out.length, true);
	ov.setUint32(12, jsonBytes.length, true);
	ov.setUint32(16, CHUNK_JSON, true);
	out.set(jsonBytes, 20);
	out.set(rest, 20 + jsonBytes.length);
	return { buffer: out.buffer, jointNames: [...joints].map((j) => json.nodes[j]?.name) };
}

function parse(buffer) {
	return new Promise((res, rej) => new GLTFLoader().parse(buffer, '', (gltf) => res(gltf.scene), rej));
}

const loadClip = (name) =>
	parseClipJSON(
		JSON.parse(readFileSync(resolve(process.cwd(), `public/animations/clips/${name}.json`), 'utf8')),
		name,
	);

// The HumanIK spelling of a joint: its canonical stem behind `Character<n>:`.
// Joints with no canonical stem keep their name, as an exporter would leave
// helper bones alone.
const toHumanIk = (n) => (raw) => {
	const canonical = canonicalizeBoneName(raw);
	return canonical ? `Character${n}:${canonical}` : raw;
};

let baseline;
let humanIk;
let humanIkRigScene;
let humanIkJoints;

beforeAll(async () => {
	const bytes = new Uint8Array(readFileSync(GLB_PATH));
	const renamed = renameJoints(bytes, toHumanIk(1));
	humanIkJoints = renamed.jointNames;
	[baseline, humanIk, humanIkRigScene] = await Promise.all([
		parse(bytes.slice().buffer),
		parse(renamed.buffer),
		parse(renameJoints(bytes, toHumanIk(1)).buffer),
	]);
});

describe('HumanIK rig after GLTFLoader (Character1:Hips arrives as Character1Hips)', () => {
	it('loads with the colon removed, which is the spelling the runtime must resolve', () => {
		expect(humanIkJoints.some((n) => n === 'Character1:Hips')).toBe(true);
		const names = [];
		humanIk.traverse((o) => o.isBone && names.push(o.name));
		expect(names).toContain('Character1Hips');
		expect(names.some((n) => n.includes(':'))).toBe(false);
	});

	it('resolves the same canonical bone set as the untouched rig', () => {
		const want = [...canonicalNodeMapFromObject(baseline).keys()].sort();
		const got = canonicalNodeMapFromObject(humanIk);
		expect(want.length).toBeGreaterThanOrEqual(20);
		expect([...got.keys()].sort()).toEqual(want);
		expect(got.get('Hips')).toBe('Character1Hips');
		expect(got.get('LeftArm')).toBe('Character1LeftArm');
		expect(got.get('RightUpLeg')).toBe('Character1RightUpLeg');
	});

	for (const clipName of ['idle', 'walk']) {
		it(`${clipName}: clears the coverage floor with the same coverage as the untouched rig`, () => {
			const ref = retargetClipToObject(loadClip(clipName), baseline);
			const got = retargetClipToObject(loadClip(clipName), humanIk);
			expect(ref.clip).not.toBeNull();
			expect(got.clip).not.toBeNull();
			expect(got.coverage).toBeGreaterThanOrEqual(MIN_COVERAGE);
			expect(got.matched).toBe(ref.matched);
			expect(got.total).toBe(ref.total);
			expect(got.clip.tracks.some((t) => t.name === 'Character1Hips.quaternion')).toBe(true);
		});
	}

	it('the Animation Studio entry point (retargetClipToRig) binds the same bones', () => {
		const rig = makeGltfRig(humanIkRigScene);
		expect(rig).not.toBeNull();
		const viaRig = retargetClipToRig(loadClip('idle'), rig, { scaleHips: false });
		const viaObject = retargetClipToObject(loadClip('idle'), humanIk);
		expect(viaRig.clip).not.toBeNull();
		expect(viaRig.matched).toBe(viaObject.matched);
		const names = (c) => c.clip.tracks.map((t) => t.name).filter((n) => n.endsWith('.quaternion')).sort();
		expect(names(viaRig)).toEqual(names(viaObject));
	});
});
