/**
 * Thumbnail rest pose (src/thumbnail-pose.js): unit tests.
 *
 * Every avatar poster the platform renders (the server's CPU rasterizer, its
 * chromium failover, the browser's offscreen capture) is posed by this module.
 * These tests pin the contract at that seam, against the real pose clip from
 * the motion library rather than a hand-built stand-in:
 *  - a T-posed humanoid comes out with its arms hanging, under Mixamo and
 *    VRoid bone naming alike, and restore() puts every bone back exactly;
 *  - a rig already authored with its arms down, and a non-humanoid rig, are
 *    left exactly as authored;
 *  - the frozen pose carries joint rotations only (a translation track once
 *    launched a centimetre-scale rig a hundred units into the air);
 *  - a real Mixamo GLB renders narrower once posed (the arms are no longer
 *    spreading the frame), and the CPU lane's cached model is left at bind;
 *  - the chromium lane's module map resolves every import the stack makes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Bone, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, MeshBasicMaterial, Object3D, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { AvatarModel } from '@three-ws/render';
import {
	applyThumbnailPose,
	armsAlreadyHanging,
	armsPointBelow,
	sampleClipPose,
	THUMBNAIL_POSE_CLIP,
} from '../src/thumbnail-pose.js';
import { thumbnailPoseClip, thumbnailPoseModules, THUMBNAIL_POSE_SPECIFIER } from '../api/_lib/pose-runtime.js';

const MIXAMO = (n) => `mixamorig${n}`;
const VROID = {
	Hips: 'J_Bip_C_Hips',
	Spine: 'J_Bip_C_Spine',
	Spine1: 'J_Bip_C_Chest',
	Spine2: 'J_Bip_C_UpperChest',
	Neck: 'J_Bip_C_Neck',
	Head: 'J_Bip_C_Head',
	LeftShoulder: 'J_Bip_L_Shoulder',
	LeftArm: 'J_Bip_L_UpperArm',
	LeftForeArm: 'J_Bip_L_LowerArm',
	LeftHand: 'J_Bip_L_Hand',
	RightShoulder: 'J_Bip_R_Shoulder',
	RightArm: 'J_Bip_R_UpperArm',
	RightForeArm: 'J_Bip_R_LowerArm',
	RightHand: 'J_Bip_R_Hand',
	LeftUpLeg: 'J_Bip_L_UpperLeg',
	LeftLeg: 'J_Bip_L_LowerLeg',
	LeftFoot: 'J_Bip_L_Foot',
	RightUpLeg: 'J_Bip_R_UpperLeg',
	RightLeg: 'J_Bip_R_LowerLeg',
	RightFoot: 'J_Bip_R_Foot',
};

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const VROID_FINGER = { Thumb: 'Thumb', Index: 'Index', Middle: 'Middle', Ring: 'Ring', Pinky: 'Little' };
for (const side of ['Left', 'Right']) {
	for (const f of FINGERS) {
		for (const j of [1, 2, 3]) {
			VROID[`${side}Hand${f}${j}`] = `J_Bip_${side[0]}_${VROID_FINGER[f]}${j}`;
		}
	}
}

// A metre-scale humanoid skeleton bound to a skinned mesh, facing +Z with its
// left arm along +X. `armsDown` authors the arms hanging instead of in a T;
// `fingers` gives each hand three-joint fingers, as production rigs carry.
function makeHumanoid(name = MIXAMO, { armsDown = false, fingers = true } = {}) {
	const root = new Object3D();
	const bones = [];
	const bone = (key, parent, x, y, z) => {
		const b = new Bone();
		b.name = typeof name === 'function' ? name(key) : name[key];
		b.position.set(x, y, z);
		if (parent) parent.add(b);
		bones.push(b);
		return b;
	};
	const hips = bone('Hips', null, 0, 1, 0);
	const spine = bone('Spine', hips, 0, 0.1, 0);
	const spine1 = bone('Spine1', spine, 0, 0.12, 0);
	const spine2 = bone('Spine2', spine1, 0, 0.12, 0);
	const neck = bone('Neck', spine2, 0, 0.15, 0);
	bone('Head', neck, 0, 0.1, 0);
	for (const [side, sx] of [['Left', 1], ['Right', -1]]) {
		const shoulder = bone(`${side}Shoulder`, spine2, 0.05 * sx, 0.1, 0);
		const arm = bone(`${side}Arm`, shoulder, 0.1 * sx, 0, 0);
		const fore = armsDown ? bone(`${side}ForeArm`, arm, 0, -0.26, 0) : bone(`${side}ForeArm`, arm, 0.26 * sx, 0, 0);
		const hand = armsDown ? bone(`${side}Hand`, fore, 0, -0.24, 0) : bone(`${side}Hand`, fore, 0.24 * sx, 0, 0);
		if (fingers) {
			FINGERS.forEach((f, k) => {
				let parent = hand;
				for (const j of [1, 2, 3]) {
					parent = armsDown
						? bone(`${side}Hand${f}${j}`, parent, (k - 2) * 0.01 * sx, -0.03, 0)
						: bone(`${side}Hand${f}${j}`, parent, 0.03 * sx, 0, (k - 2) * 0.01);
				}
			});
		}
		const upLeg = bone(`${side}UpLeg`, hips, 0.09 * sx, -0.05, 0);
		const leg = bone(`${side}Leg`, upLeg, 0, -0.42, 0);
		bone(`${side}Foot`, leg, 0, -0.42, 0);
	}
	root.add(hips);

	// One weighted vertex per bone is enough for a real SkinnedMesh + Skeleton.
	const geometry = new BufferGeometry();
	const positions = [];
	const indices = [];
	const weights = [];
	root.updateMatrixWorld(true);
	bones.forEach((b, i) => {
		const p = b.getWorldPosition(new Vector3());
		positions.push(p.x, p.y, p.z);
		indices.push(i, 0, 0, 0);
		weights.push(1, 0, 0, 0);
	});
	geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
	geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
	const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
	root.add(mesh);
	mesh.bind(new Skeleton(bones));
	root.updateMatrixWorld(true);
	return root;
}

// Unit vector y of shoulder→elbow: about 0 in a T-pose, near -1 hanging.
function armDropY(root, armName, foreArmName) {
	const a = root.getObjectByName(armName).getWorldPosition(new Vector3());
	const b = root.getObjectByName(foreArmName).getWorldPosition(new Vector3());
	return b.sub(a).normalize().y;
}

function snapshot(root) {
	const out = [];
	root.traverse((n) => out.push([n.name, ...n.quaternion.toArray(), ...n.position.toArray()]));
	return out;
}

let poseClip;
beforeAll(async () => {
	poseClip = await thumbnailPoseClip();
});

describe('sampleClipPose', () => {
	it('freezes one instant of the library clip as joint rotations only', () => {
		const source = JSON.parse(readFileSync(`public/animations/clips/${THUMBNAIL_POSE_CLIP}.json`, 'utf8'));
		const frozen = sampleClipPose(source, 0);
		expect(frozen.duration).toBe(1);
		expect(frozen.tracks.length).toBeGreaterThan(20);
		for (const track of frozen.tracks) {
			expect(track.name.endsWith('.quaternion')).toBe(true);
			expect(track.times).toEqual([0, 1]);
			// Two identical keys: the pose holds whatever time the mixer lands on.
			expect(track.values.slice(0, 4)).toEqual(track.values.slice(4, 8));
		}
		// No translation track survives, the hip one included.
		expect(source.tracks.some((t) => t.name.endsWith('.position'))).toBe(true);
	});

	it('wraps the sample time by the clip duration', () => {
		const source = JSON.parse(readFileSync('public/animations/clips/idle.json', 'utf8'));
		const a = sampleClipPose(source, 1);
		const b = sampleClipPose(source, 1 + source.duration);
		expect(b.tracks[0].values).toEqual(a.tracks[0].values);
	});
});

describe('applyThumbnailPose', () => {
	it('drops a T-posed Mixamo rig\'s arms to its sides, and restore() undoes it exactly', async () => {
		const root = makeHumanoid(MIXAMO);
		const before = snapshot(root);
		expect(armDropY(root, 'mixamorigLeftArm', 'mixamorigLeftForeArm')).toBeCloseTo(0, 5);

		const result = await applyThumbnailPose(root, poseClip);
		expect(result).toMatchObject({ posed: true, mode: 'rest' });
		expect(armDropY(root, 'mixamorigLeftArm', 'mixamorigLeftForeArm')).toBeLessThan(-0.8);
		expect(armDropY(root, 'mixamorigRightArm', 'mixamorigRightForeArm')).toBeLessThan(-0.8);
		// Rotations only: the hips stay at the rig's own height.
		expect(root.getObjectByName('mixamorigHips').position.y).toBe(1);

		result.restore();
		expect(snapshot(root)).toEqual(before);
	});

	it('poses a VRoid-named rig through the same canonical mapping', async () => {
		const root = makeHumanoid(VROID);
		const result = await applyThumbnailPose(root, poseClip);
		expect(result).toMatchObject({ posed: true, mode: 'rest' });
		expect(armDropY(root, 'J_Bip_L_UpperArm', 'J_Bip_L_LowerArm')).toBeLessThan(-0.8);
		expect(armDropY(root, 'J_Bip_R_UpperArm', 'J_Bip_R_LowerArm')).toBeLessThan(-0.8);
	});

	it('still lowers the arms of a rig too sparse for the clip (no finger bones)', async () => {
		// Without fingers fewer than half the clip's joints map, so the retarget
		// declines; the geometric fallback must still take the arms out of the T.
		const root = makeHumanoid(MIXAMO, { fingers: false });
		const result = await applyThumbnailPose(root, poseClip);
		expect(result).toMatchObject({ posed: true, mode: 'arms-relaxed' });
		expect(armDropY(root, 'mixamorigLeftArm', 'mixamorigLeftForeArm')).toBeLessThan(-0.8);
		expect(armDropY(root, 'mixamorigRightArm', 'mixamorigRightForeArm')).toBeLessThan(-0.8);
	});

	it('keeps the stance of a rig authored with its arms already down', async () => {
		const root = makeHumanoid(MIXAMO, { armsDown: true });
		expect(armsAlreadyHanging(root)).toBe(true);
		const before = snapshot(root);
		const result = await applyThumbnailPose(root, poseClip);
		expect(result).toMatchObject({ posed: false, mode: 'authored-rest' });
		expect(snapshot(root)).toEqual(before);
	});

	it('accepts arms that hang and refuses arms left out or raised over the head', () => {
		expect(armsPointBelow(makeHumanoid(MIXAMO, { armsDown: true }), -0.5)).toBe(true);
		expect(armsPointBelow(makeHumanoid(MIXAMO), -0.5)).toBe(false);
		const raised = makeHumanoid(MIXAMO);
		raised.getObjectByName('mixamorigLeftArm').rotation.z = Math.PI / 2;
		raised.getObjectByName('mixamorigRightArm').rotation.z = -Math.PI / 2;
		expect(armDropY(raised, 'mixamorigLeftArm', 'mixamorigLeftForeArm')).toBeGreaterThan(0.9);
		expect(armsPointBelow(raised, -0.5)).toBe(false);
	});

	it('leaves a non-humanoid rig exactly as authored', async () => {
		const root = makeHumanoid((key) => `tentacle_${key.length}_${key}`.replace(/(Left|Right|Arm|Leg|Hand|Foot|Hips|Spine|Neck|Head|Shoulder)/g, 'seg'));
		const before = snapshot(root);
		const result = await applyThumbnailPose(root, poseClip);
		expect(result).toMatchObject({ posed: false, mode: 'not-humanoid' });
		expect(snapshot(root)).toEqual(before);
	});

	it('is a no-op without a pose clip', async () => {
		const root = makeHumanoid(MIXAMO);
		const result = await applyThumbnailPose(root, null);
		expect(result).toMatchObject({ posed: false, mode: 'no-pose' });
	});
});

describe('the CPU render lane on a real GLB', () => {
	it('frames a posed Mixamo avatar narrower than its T-pose, then returns it to bind', async () => {
		const bytes = readFileSync('public/avatars/xbot.glb');
		const model = await AvatarModel.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
		const bindWidth = model.bounds.size[0];

		const result = await applyThumbnailPose(model.scene, poseClip);
		expect(result.posed).toBe(true);
		const posedWidth = model.updateBounds().size[0];
		// Arms spread a T-pose to roughly its height; hanging, they span the shoulders.
		expect(posedWidth).toBeLessThan(bindWidth * 0.5);

		result.restore();
		expect(model.updateBounds().size[0]).toBeCloseTo(bindWidth, 4);
	});
});

describe('the chromium lane module map', () => {
	it('ships the whole posing stack with every relative import rewritten to a mapped specifier', () => {
		const modules = thumbnailPoseModules();
		expect(Object.keys(modules)).toContain(THUMBNAIL_POSE_SPECIFIER);
		expect(Object.keys(modules)).toContain('tws/animation-manager.js');
		for (const [specifier, url] of Object.entries(modules)) {
			const code = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8');
			expect(code, specifier).not.toMatch(/from\s*['"]\.{1,2}\//);
			for (const [, dep] of code.matchAll(/from\s*['"](tws\/[^'"]+)['"]/g)) {
				expect(modules, `${specifier} imports ${dep}`).toHaveProperty([dep]);
			}
		}
	});
});
