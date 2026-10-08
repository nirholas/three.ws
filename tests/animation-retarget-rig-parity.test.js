// The Animation Studio (/pose) previews and exports clips through
// retargetClipToRig, while the viewer and the server go through retargetClip
// with the rig's limb rest directions. The A-pose re-aim (commit 8561d5c5d)
// reached only the second pair, so an A-posed body animated correctly on its
// page and drove its arms through the torso in the studio and in the GLB it
// exported. Both entry points must produce the same tracks for the same rig.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseClipJSON, retargetClipToObject, retargetClipToRig } from '../src/animation-retarget.js';
import { makeGltfRig } from '../src/pose-rig.js';

// MakeHuman-derived: rests in an A-pose with bent elbows, the case the re-aim exists for.
const GLB_PATH = resolve(process.cwd(), 'public/avatars/parametric-base.glb');

function loadScene() {
	const bytes = readFileSync(GLB_PATH);
	return new Promise((res, rej) => {
		new GLTFLoader().parse(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
			'',
			(gltf) => res(gltf.scene),
			rej,
		);
	});
}

const loadClip = (name) =>
	parseClipJSON(
		JSON.parse(readFileSync(resolve(process.cwd(), `public/animations/clips/${name}.json`), 'utf8')),
		name,
	);

const LIMBS = ['LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg'];

let objectScene;
let rigScene;

beforeAll(async () => {
	[objectScene, rigScene] = await Promise.all([loadScene(), loadScene()]);
});

describe('retargetClipToRig matches the viewer path on an A-posed rig', () => {
	for (const clipName of ['idle', 'walk']) {
		it(`${clipName}: limb tracks agree`, () => {
			const viaObject = retargetClipToObject(loadClip(clipName), objectScene).clip;
			const rig = makeGltfRig(rigScene);
			expect(rig).not.toBeNull();
			const viaRig = retargetClipToRig(loadClip(clipName), rig, { scaleHips: false }).clip;
			expect(viaObject).not.toBeNull();
			expect(viaRig).not.toBeNull();

			const byName = (clip) => new Map(clip.tracks.map((t) => [t.name, t]));
			const a = byName(viaObject);
			const b = byName(viaRig);
			let compared = 0;
			for (const [name, track] of a) {
				if (!name.endsWith('.quaternion')) continue;
				if (!LIMBS.some((bone) => name.toLowerCase().includes(bone.toLowerCase()))) continue;
				const other = b.get(name);
				expect(other, name).toBeDefined();
				expect(other.values.length).toBe(track.values.length);
				// q and -q are the same rotation; compare by |dot| per keyframe.
				for (let i = 0; i < track.values.length; i += 4) {
					let dot = 0;
					for (let k = 0; k < 4; k++) dot += track.values[i + k] * other.values[i + k];
					expect(Math.abs(dot), `${name} key ${i / 4}`).toBeGreaterThan(0.9999);
				}
				compared++;
			}
			expect(compared).toBeGreaterThanOrEqual(LIMBS.length);
		});
	}
});
