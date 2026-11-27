/**
 * Text to motion, from the worker's clip to tracks that play on a real rig.
 *
 * The worker (workers/model-text2motion) writes its clip on the canonical
 * Wolf3D bone names, in HumanML3D's own rest basis. Two consumers play it:
 *
 *   - /pose (src/animation-library.js) takes the converted clip from
 *     /api/forge-motion and retargets it in the browser.
 *   - the MCP `text_to_animation` tool (api/_mcp/tools/animations.js) fetches
 *     the caller's rigged GLB and retargets server side.
 *
 * These tests drive both against the platform's own published avatars, which
 * are meshopt-compressed exactly like the models the Forge auto-rig returns,
 * and against a real worker clip (tests/fixtures/text2motion-wave-clip.json,
 * the worker's output for "a person waves hello with the right hand" on
 * 2026-11-27, downsampled to every fourth frame). Only the network boundary is
 * stubbed: the model fetch, the GPU job and the clip download.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const glbBytes = (rel) => readFileSync(path.join(ROOT, rel));
const WAVE_CLIP = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/text2motion-wave-clip.json'), 'utf8'));

// ── Network boundary stubs ──────────────────────────────────────────────────
const modelBytes = { current: null };
vi.mock('../api/_lib/fetch-model.js', async (orig) => ({
	...(await orig()),
	fetchModel: vi.fn(async (url) => ({
		bytes: modelBytes.current,
		url,
		contentType: 'model/gltf-binary',
		filename: url.split('/').pop(),
	})),
}));

const workerClip = { current: null };
const submit = vi.fn(async () => ({ extJobId: 'j'.repeat(24), eta: 20 }));
const status = vi.fn(async () => ({
	status: 'done',
	resultClipUrl: 'https://storage.googleapis.com/bucket/motion-clips/mdm/test.json',
	frames: 30,
	fps: 30,
}));
vi.mock('../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		supportsMode: (m) => m === 'text2motion',
		submit,
		status,
	}),
}));
vi.mock('../api/_lib/upstream-fetch.js', async (orig) => ({
	...(await orig()),
	fetchUpstream: vi.fn(async () => new Response(JSON.stringify(workerClip.current), { status: 200 })),
}));

const { toolDefs } = await import('../api/_mcp/tools/animations.js');
const textToAnimation = toolDefs.find((t) => t.name === 'text_to_animation');
const { libraryReadyClip } = await import('../api/_lib/motion-seed.js');
const { parseClipJSON, retargetClipToObject, canonicalNodeMapFromObject } = await import('../src/animation-retarget.js');
const THREE = await import('three');

// three's loaders touch a handful of browser globals; the MCP module installs
// the same shims before it parses, and these tests load GLBs on their own too.
globalThis.self ??= globalThis;
globalThis.window ??= globalThis;
globalThis.document ??= { createElementNS: () => ({}) };

async function loadScene(rel, rename) {
	const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
	const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
	const bytes = glbBytes(rel);
	const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const gltf = await new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject));
	const scene = gltf.scene;
	if (rename) scene.traverse((n) => { if (n.isBone && rename[n.name]) n.name = rename[n.name]; });
	return scene;
}

// The worker's clip for a neutral standing frame, as the lane writes it: every
// bone at HumanML3D's raw rest (identity) except the neck, which turns
// HumanML3D's "head forward of the neck" into "up". Played on a rig it must
// read as a person standing: head above the neck, arms hanging at the sides.
const NEUTRAL_BONES = [
	'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
	'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
	'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
	'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
	'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];
function neutralWorkerClip() {
	const times = [0, 1 / 30, 2 / 30];
	const neck = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
	return {
		name: 'standing',
		duration: 2 / 30,
		tracks: [
			...NEUTRAL_BONES.map((bone) => ({
				type: 'quaternion',
				name: `${bone}.quaternion`,
				times,
				values: times.flatMap(() => (bone === 'Neck' ? neck : [0, 0, 0, 1])),
			})),
			{ type: 'vector', name: 'Hips.position', times, values: times.flatMap(() => [0, 0.92, 0]) },
		],
	};
}

// Read joint positions at the rig's rest, then with a retargeted clip's first
// frame applied. Bones resolve through the canonical map because the loader
// sanitizes node names (mixamorig:Head is bound as mixamorigHead).
function restAndFirstFrame(scene, clipJSON) {
	const canon = canonicalNodeMapFromObject(scene);
	const at = (bone) => scene.getObjectByName(canon.get(bone)).getWorldPosition(new THREE.Vector3());
	scene.updateMatrixWorld(true);
	const rest = Object.fromEntries(NEUTRAL_BONES.map((b) => [b, at(b)]));
	const mixer = new THREE.AnimationMixer(scene);
	mixer.clipAction(THREE.AnimationClip.parse(clipJSON)).play();
	mixer.update(0);
	scene.updateMatrixWorld(true);
	const posed = Object.fromEntries(NEUTRAL_BONES.map((b) => [b, at(b)]));
	return { rest, posed };
}

function expectPlayableTracks(clip, scene) {
	expect(clip).toBeTruthy();
	expect(clip.duration).toBeGreaterThan(1);
	const quatTracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion'));
	expect(quatTracks.length).toBeGreaterThanOrEqual(20);
	for (const track of clip.tracks) {
		const node = track.name.slice(0, track.name.lastIndexOf('.'));
		expect(scene.getObjectByName(node), `track ${track.name} binds to a node`).toBeTruthy();
		expect(track.times.length).toBeGreaterThan(1);
		for (let i = 1; i < track.times.length; i++) expect(track.times[i]).toBeGreaterThan(track.times[i - 1]);
		expect(Array.from(track.values).every(Number.isFinite)).toBe(true);
	}
	for (const track of quatTracks) {
		for (let i = 0; i < track.values.length; i += 4) {
			const len = Math.hypot(track.values[i], track.values[i + 1], track.values[i + 2], track.values[i + 3]);
			expect(Math.abs(len - 1)).toBeLessThan(1e-3);
		}
	}
	// The motion is real: some bone actually turns over the clip.
	const moving = quatTracks.some((t) => {
		const v = t.values;
		const n = v.length / 4;
		const dot = Math.abs(v[0] * v[(n - 1) * 4] + v[1] * v[(n - 1) * 4 + 1] + v[2] * v[(n - 1) * 4 + 2] + v[3] * v[(n - 1) * 4 + 3]);
		return 2 * Math.acos(Math.min(1, dot)) > 0.2;
	});
	expect(moving).toBe(true);
}

// Unreal-style names, to prove a third convention binds through the same map.
const UE_NAMES = {
	Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'head',
	LeftShoulder: 'clavicle_l', LeftArm: 'upperarm_l', LeftForeArm: 'lowerarm_l', LeftHand: 'hand_l',
	RightShoulder: 'clavicle_r', RightArm: 'upperarm_r', RightForeArm: 'lowerarm_r', RightHand: 'hand_r',
	LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'ball_l',
	RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'ball_r',
};

describe('retargeting a generated clip onto differently named skeletons', () => {
	const rigs = [
		['Mixamo names (mixamorig:Hips), the Forge auto-rig convention', 'public/avatars/michelle.glb', null],
		['bare Wolf3D names (Hips)', 'public/avatars/default.glb', null],
		['Unreal names (pelvis, upperarm_l)', 'public/avatars/default.glb', UE_NAMES],
	];
	for (const [label, file, rename] of rigs) {
		it(`produces valid, non-empty tracks on ${label}`, async () => {
			const scene = await loadScene(file, rename);
			const clip = parseClipJSON(libraryReadyClip(WAVE_CLIP), 'wave');
			const result = retargetClipToObject(clip, scene);
			expect(result.coverage).toBeGreaterThanOrEqual(0.9);
			expectPlayableTracks(result.clip, scene);
		});
	}
});

describe('MCP text_to_animation', () => {
	const auth = { userId: null, rateKey: 'motion-retarget-test', scope: '', source: 'free' };
	const req = { headers: { host: 'three.ws' } };

	beforeEach(() => {
		submit.mockClear();
		status.mockClear();
		workerClip.current = WAVE_CLIP;
	});

	it('refuses an unrigged model before any worker call, and says to rig it first', async () => {
		modelBytes.current = glbBytes('public/accessories/hat-beanie.glb');
		await expect(
			textToAnimation.handler(
				{ prompt: 'waving hello', model_url: 'https://three.ws/accessories/hat-beanie.glb' },
				auth,
				req,
			),
		).rejects.toMatchObject({ message: expect.stringMatching(/rig it first/i), data: { hint: expect.stringMatching(/rig_mesh/) } });
		expect(submit).not.toHaveBeenCalled();
	});

	it('refuses a prompt that is not a movement before fetching the model or the GPU', async () => {
		const { fetchModel } = await import('../api/_lib/fetch-model.js');
		fetchModel.mockClear();
		await expect(
			textToAnimation.handler({ prompt: '!!!!!!', model_url: 'https://three.ws/avatars/michelle.glb' }, auth, req),
		).rejects.toMatchObject({ message: expect.stringMatching(/describe what the body does/i) });
		expect(fetchModel).not.toHaveBeenCalled();
		expect(submit).not.toHaveBeenCalled();
	});

	it('animates a meshopt-compressed rig, the format the Forge auto-rig returns', async () => {
		modelBytes.current = glbBytes('public/avatars/michelle.glb');
		const out = await textToAnimation.handler(
			{ prompt: 'a person waves hello with the right hand', model_url: 'https://three.ws/avatars/michelle.glb' },
			auth,
			req,
		);
		expect(out.structuredContent.ok).toBe(true);
		expect(submit).toHaveBeenCalledTimes(1);
		const scene = await loadScene('public/avatars/michelle.glb');
		expectPlayableTracks(THREE.AnimationClip.parse(out.structuredContent.clip), scene);
	}, 20000);

	it('plays a standing frame upright: head above the neck, arms at the sides', async () => {
		workerClip.current = neutralWorkerClip();
		for (const file of ['public/avatars/michelle.glb', 'public/avatars/default.glb']) {
			modelBytes.current = glbBytes(file);
			const out = await textToAnimation.handler(
				{ prompt: 'standing still', model_url: `https://three.ws/${file.replace('public/', '')}` },
				auth,
				req,
			);
			expect(out.structuredContent.ok).toBe(true);
			const scene = await loadScene(file);
			const { rest, posed } = restAndFirstFrame(scene, out.structuredContent.clip);
			// Standing on its feet: the hips stay at the rig's own standing height
			// (a hip track in the wrong units sinks the body to the floor or flings it).
			expect(Math.abs(posed.Hips.y - rest.Hips.y), `${file}: hips at standing height`).toBeLessThan(0.1);
			// Upright: the torso keeps most of its rest height and the head is on top.
			const torso = rest.Neck.y - rest.Hips.y;
			expect(posed.Neck.y - posed.Hips.y, `${file}: neck above hips`).toBeGreaterThan(0.8 * torso);
			expect(posed.Head.y, `${file}: head above neck`).toBeGreaterThan(posed.Neck.y + 0.02);
			// Arms hang: each hand sits well below its shoulder joint.
			for (const side of ['Left', 'Right']) {
				const reach = rest[`${side}Arm`].distanceTo(rest[`${side}Hand`]);
				expect(posed[`${side}Arm`].y - posed[`${side}Hand`].y, `${file}: ${side} hand hangs below the shoulder`).toBeGreaterThan(0.6 * reach);
			}
		}
	}, 30000);
});
