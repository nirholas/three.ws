// @vitest-environment jsdom
//
// best3d order 075, task 1-3: the hand-rolled VRM support in vrm-loader.js was
// replaced with the real @pixiv/three-vrm reference implementation (wired in
// src/game/vrm-boot.js). tests/vrm-loader.test.js locks the integration SEAM
// with a fake plugin factory so it stays fast and isolated from the library;
// this file is the complementary real-package test -- it builds an actual VRM
// 1.0 glTF (humanoid + VRMC_springBone + an expression preset bound to a morph
// target) with THREE's own GLTFExporter, round-trips it through the genuine
// VRMLoaderPlugin, and asserts the three concrete DoD claims: spring-bone
// physics actually moves a bone, an expression preset actually changes a morph
// target (both directly and through the ARKit-52 bridge in
// vrm-expressions.js), and a .vrma file's humanoid track parses through the
// real VRMAnimationLoaderPlugin and retargets onto both a VRM and a non-VRM
// rig via the existing, VRM-agnostic animation-retarget.js pipeline.
//
// GLTFExporter's buffer-encoding path always round-trips through the DOM
// Blob/FileReader APIs (even for `binary: false`, since any skinned mesh has
// buffer data to embed as a data: URI), which is why this file needs the jsdom
// environment pragma above -- plain node has neither.

import { describe, it, expect, beforeAll } from 'vitest';
import {
	Bone, Skeleton, SkinnedMesh, BufferGeometry, BufferAttribute,
	MeshStandardMaterial, Group, AnimationClip, QuaternionKeyframeTrack,
	Uint16BufferAttribute,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { retargetClipToObject } from '../src/animation-retarget.js';
import { applyArkitWeightsToVrm } from '../src/game/vrm-expressions.js';

// VRMHumanoidLoaderPlugin throws unless every VRMRequiredHumanBoneName is
// present, so the fixture needs a full (if minimal) stick-figure humanoid,
// not just the handful of bones each test actually cares about.
function makeBone(name, parent, position) {
	const bone = new Bone();
	bone.name = name;
	bone.position.set(...position);
	if (parent) parent.add(bone);
	return bone;
}

/**
 * Build a minimal but spec-valid VRM 1.0 glTF JSON: a full humanoid skeleton,
 * one skinned triangle with a morph target bound to the 'happy' expression
 * preset, a two-joint spring-bone chain on a ponytail (bent sideways off the
 * head so gravity has something to pull against -- a chain collinear with
 * gravityDir never changes direction, only magnitude, which looked like dead
 * physics until this was worked out), and a Hips rotation clip for the
 * .vrma-equivalent humanoid-animation test.
 *
 * @returns {Promise<object>} glTF JSON (not yet GLB-encoded; GLTFLoader.parse
 *   accepts a plain object directly)
 */
async function buildVrmFixtureJson() {
	const hips = makeBone('Hips', null, [0, 1, 0]);
	const spine = makeBone('Spine', hips, [0, 0.15, 0]);
	const chest = makeBone('Chest', spine, [0, 0.15, 0]);
	const neck = makeBone('Neck', chest, [0, 0.2, 0]);
	const head = makeBone('Head', neck, [0, 0.1, 0]);
	const pony1 = makeBone('Ponytail1', head, [0, 0.05, -0.05]);
	makeBone('Ponytail2', pony1, [0, 0, -0.1]);

	const leftUpperArm = makeBone('LeftUpperArm', chest, [0.15, 0.15, 0]);
	const leftLowerArm = makeBone('LeftLowerArm', leftUpperArm, [0.25, 0, 0]);
	makeBone('LeftHand', leftLowerArm, [0.25, 0, 0]);
	const rightUpperArm = makeBone('RightUpperArm', chest, [-0.15, 0.15, 0]);
	const rightLowerArm = makeBone('RightLowerArm', rightUpperArm, [-0.25, 0, 0]);
	makeBone('RightHand', rightLowerArm, [-0.25, 0, 0]);

	const leftUpperLeg = makeBone('LeftUpperLeg', hips, [0.1, -0.05, 0]);
	const leftLowerLeg = makeBone('LeftLowerLeg', leftUpperLeg, [0, -0.4, 0]);
	makeBone('LeftFoot', leftLowerLeg, [0, -0.4, 0]);
	const rightUpperLeg = makeBone('RightUpperLeg', hips, [-0.1, -0.05, 0]);
	const rightLowerLeg = makeBone('RightLowerLeg', rightUpperLeg, [0, -0.4, 0]);
	makeBone('RightFoot', rightLowerLeg, [0, -0.4, 0]);

	hips.updateWorldMatrix(true, true);

	const skeleton = new Skeleton(hips.children.length ? collectBones(hips) : [hips]);

	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]), 3));
	geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
	geometry.setIndex([0, 1, 2]);
	geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
	geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
	geometry.morphAttributes.position = [
		new BufferAttribute(new Float32Array([0, 0.2, 0, 0.1, 0.2, 0, 0, 0.3, 0]), 3),
	];

	const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
	mesh.name = 'Face';
	mesh.morphTargetInfluences = [0];
	mesh.morphTargetDictionary = { happyMorph: 0 };
	mesh.bind(skeleton);
	mesh.add(hips);

	const scene = new Group();
	scene.name = 'VrmFixture';
	scene.add(mesh);

	const hipsSpinTrack = new QuaternionKeyframeTrack(
		'Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.7071, 0, 0.7071],
	);
	const clip = new AnimationClip('wave', 1, [hipsSpinTrack]);

	const json = await new GLTFExporter().parseAsync(scene, { animations: [clip], binary: false });
	const nodeIndex = (name) => json.nodes.findIndex((n) => n.name === name);
	const faceNodeIndex = nodeIndex('Face');

	const humanBoneMap = {
		hips: 'Hips', spine: 'Spine', chest: 'Chest', neck: 'Neck', head: 'Head',
		leftUpperArm: 'LeftUpperArm', leftLowerArm: 'LeftLowerArm', leftHand: 'LeftHand',
		rightUpperArm: 'RightUpperArm', rightLowerArm: 'RightLowerArm', rightHand: 'RightHand',
		leftUpperLeg: 'LeftUpperLeg', leftLowerLeg: 'LeftLowerLeg', leftFoot: 'LeftFoot',
		rightUpperLeg: 'RightUpperLeg', rightLowerLeg: 'RightLowerLeg', rightFoot: 'RightFoot',
	};
	const humanBones = {};
	for (const [vrmName, boneName] of Object.entries(humanBoneMap)) {
		humanBones[vrmName] = { node: nodeIndex(boneName) };
	}

	json.extensionsUsed = [...(json.extensionsUsed || []), 'VRMC_vrm', 'VRMC_springBone', 'VRMC_vrm_animation'];
	json.extensions = {
		...(json.extensions || {}),
		VRMC_vrm: {
			specVersion: '1.0',
			meta: {
				name: 'three.ws test fixture', version: '1.0', authors: ['three.ws'],
				licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'onlyAuthor',
			},
			humanoid: { humanBones },
			expressions: {
				preset: { happy: { morphTargetBinds: [{ node: faceNodeIndex, index: 0, weight: 1 }] } },
			},
		},
		VRMC_springBone: {
			specVersion: '1.0',
			colliderGroups: [],
			springs: [{
				name: 'ponytail',
				joints: [
					{
						node: nodeIndex('Ponytail1'), hitRadius: 0.02, stiffness: 0.5,
						gravityPower: 0.8, gravityDir: [0, -1, 0], dragForce: 0.3,
					},
					{
						node: nodeIndex('Ponytail2'), hitRadius: 0.02, stiffness: 0.5,
						gravityPower: 0.8, gravityDir: [0, -1, 0], dragForce: 0.3,
					},
				],
			}],
		},
		// Body motion only (task 3's scope -- see animation-manager.js's
		// loadVrmaAnimation doc comment): one humanoid rotation track, same
		// shape a real .vrma's humanoidTracks.rotation carries.
		VRMC_vrm_animation: {
			specVersion: '1.0',
			humanoid: { humanBones: { hips: { node: nodeIndex('Hips') } } },
		},
	};
	return json;
}

function collectBones(root) {
	const out = [];
	root.traverse((o) => { if (o.isBone) out.push(o); });
	return out;
}

async function loadVrm(json) {
	const loader = new GLTFLoader();
	loader.register((parser) => new VRMLoaderPlugin(parser));
	const gltf = await loader.parseAsync(json, '');
	return { gltf, vrm: gltf.userData.vrm };
}

async function loadVrmAnimation(json) {
	const loader = new GLTFLoader();
	loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
	const gltf = await loader.parseAsync(json, '');
	return gltf.userData.vrmAnimations[0];
}

/**
 * Exactly the clip-building logic in AnimationManager.loadVrmaAnimation
 * (src/animation-manager.js), extracted so this test exercises the identical
 * transform without needing a network URL for GLTFLoader.loadAsync.
 */
function vrmAnimationToClip(vrmAnimation, name) {
	const tracks = [];
	for (const [boneName, track] of vrmAnimation.humanoidTracks.rotation.entries()) {
		const next = track.clone();
		next.name = `${boneName}.quaternion`;
		tracks.push(next);
	}
	for (const [boneName, track] of vrmAnimation.humanoidTracks.translation.entries()) {
		const next = track.clone();
		next.name = `${boneName}.position`;
		tracks.push(next);
	}
	return new AnimationClip(name, vrmAnimation.duration, tracks);
}

describe('real @pixiv/three-vrm integration', () => {
	let fixtureJson;

	beforeAll(async () => {
		fixtureJson = await buildVrmFixtureJson();
	});

	it('parses a VRM 1.0 file into a VRM instance with humanoid, spring-bone and expression managers', async () => {
		const { vrm } = await loadVrm(fixtureJson);
		expect(vrm.constructor.name).toBe('VRM');
		expect(vrm.humanoid).toBeTruthy();
		expect(vrm.springBoneManager.joints.size).toBe(1);
		expect(Object.keys(vrm.expressionManager.expressionMap)).toEqual(['happy']);
	});

	it('moves a spring-bone joint under gravity when ticked, instead of staying in its bind pose', async () => {
		const { gltf, vrm } = await loadVrm(fixtureJson);
		const ponytail1 = gltf.scene.getObjectByName('Ponytail1');
		const rest = ponytail1.quaternion.clone();

		const seen = [rest.clone()];
		for (let i = 0; i < 5; i++) {
			vrm.update(1 / 30);
			seen.push(ponytail1.quaternion.clone());
		}

		// Every tick's quaternion differs from the one before it: continuous
		// motion, not a single snap-and-hold.
		for (let i = 1; i < seen.length; i++) {
			expect(seen[i].equals(seen[i - 1])).toBe(false);
		}
		expect(seen.at(-1).equals(rest)).toBe(false);
	});

	it('changes a bound morph target when an expression preset is set', async () => {
		const { gltf, vrm } = await loadVrm(fixtureJson);
		const face = gltf.scene.getObjectByName('Face');
		expect(face.morphTargetInfluences[0]).toBe(0);

		vrm.expressionManager.setValue('happy', 1);
		vrm.update(1 / 30);

		expect(face.morphTargetInfluences[0]).toBeCloseTo(1, 5);
	});

	it('drives the same expression through the ARKit-52 bridge, the real path face-mocap.js uses', async () => {
		const { gltf, vrm } = await loadVrm(fixtureJson);
		const face = gltf.scene.getObjectByName('Face');

		const applied = applyArkitWeightsToVrm(vrm, {
			mouthSmileLeft: 1, mouthSmileRight: 1, cheekSquintLeft: 1, cheekSquintRight: 1,
		});
		vrm.update(1 / 30);

		expect(applied).toBe(true);
		expect(face.morphTargetInfluences[0]).toBeGreaterThan(0);
	});

	it('parses a .vrma-equivalent humanoid track through the real VRMAnimationLoaderPlugin', async () => {
		const vrmAnimation = await loadVrmAnimation(fixtureJson);
		expect(vrmAnimation.duration).toBe(1);
		expect([...vrmAnimation.humanoidTracks.rotation.keys()]).toEqual(['hips']);

		const track = vrmAnimation.humanoidTracks.rotation.get('hips');
		expect(track.name).toBe('Hips.quaternion');
		expect([...track.times]).toEqual([0, 1]);
	});

	it('retargets the resulting clip onto a non-VRM (Mixamo-named) rig', async () => {
		const vrmAnimation = await loadVrmAnimation(fixtureJson);
		const clip = vrmAnimationToClip(vrmAnimation, 'wave-vrma');

		const mixamoHips = new Bone();
		mixamoHips.name = 'mixamorig:Hips';
		const mixamoRoot = new Group();
		mixamoRoot.add(mixamoHips);
		mixamoHips.updateWorldMatrix(true, true);

		const { clip: retargeted, coverage } = retargetClipToObject(clip, mixamoRoot);
		expect(coverage).toBe(1);
		expect(retargeted.tracks.map((t) => t.name)).toEqual(['mixamorig:Hips.quaternion']);
	});

	it('retargets the same clip onto the VRM avatar itself', async () => {
		const vrmAnimation = await loadVrmAnimation(fixtureJson);
		const clip = vrmAnimationToClip(vrmAnimation, 'wave-vrma');
		const { gltf } = await loadVrm(fixtureJson);

		const { clip: retargeted, coverage } = retargetClipToObject(clip, gltf.scene);
		expect(coverage).toBe(1);
		expect(retargeted.tracks.map((t) => t.name)).toEqual(['Hips.quaternion']);
	});
});
