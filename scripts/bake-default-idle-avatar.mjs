// Bake the house default avatar with its idle clip: public/avatars/default-idle.glb.
//
// /avatars/default.glb ships with no animation, so any viewer that only plays a
// model's own clips (Google <model-viewer> on /playground, the SDK's
// <three-ws-viewer>, link unfurls, AR Quick Look) shows it frozen in bind pose.
// This bakes the library's Idle Breath clip into a copy of it, so every such
// surface idles with no runtime retargeting.
//
// The clip goes through the same production retargeter the app uses
// (retargetClipToObject in src/animation-retarget.js, which applies the bind
// correction from the clip's authoring rest pose to default.glb's rest pose and
// keeps only rotations plus the Hips translation). The result is written onto the
// matching nodes with glTF-Transform and re-compressed with meshopt, matching the
// source asset's encoding.
//
// The shared default lives in src/default-stage-avatar.js. Re-run this whenever
// default.glb or the idle clip changes:
//
//   node scripts/bake-default-idle-avatar.mjs [--clip av-idle-breath] [--out public/avatars/default-idle.glb]

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnimationClip, PropertyBinding } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { retargetClipToObject } from '../src/animation-retarget.js';
import { parseGltfJson, buildBoneGraph } from '../tests/_helpers/glb-bone-graph.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SRC = resolve(REPO, arg('src', 'public/avatars/default.glb'));
const CLIP = arg('clip', 'av-idle-breath');
const OUT = resolve(REPO, arg('out', 'public/avatars/default-idle.glb'));

const sourceBytes = readFileSync(SRC);
const clipJson = JSON.parse(readFileSync(resolve(REPO, 'public/animations/clips', `${CLIP}.json`), 'utf8'));
const clip = AnimationClip.parse(clipJson);

const { root } = buildBoneGraph(parseGltfJson(new Uint8Array(sourceBytes)));
const result = retargetClipToObject(clip, root);
if (!result.clip) {
	throw new Error(`retarget of ${CLIP} onto ${SRC} failed: coverage ${result.coverage.toFixed(2)}, dropped ${result.dropped.join(', ')}`);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.readBinary(new Uint8Array(sourceBytes));
const gltf = doc.getRoot();
const buffer = gltf.listBuffers()[0];
// The bone graph sanitizes node names the way GLTFLoader does, so the retargeted
// track names are sanitized too; key the lookup the same way.
const nodesByName = new Map(gltf.listNodes().map((n) => [PropertyBinding.sanitizeNodeName(n.getName()), n]));

for (const old of gltf.listAnimations()) old.dispose();
const anim = doc.createAnimation('idle');
let bound = 0;
for (const track of result.clip.tracks) {
	const dot = track.name.lastIndexOf('.');
	const nodeName = track.name.slice(0, dot);
	const property = track.name.slice(dot + 1);
	const path = property === 'quaternion' ? 'rotation' : property === 'position' ? 'translation' : null;
	const node = nodesByName.get(nodeName);
	if (!path || !node) continue;
	const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(track.times)).setBuffer(buffer);
	const output = doc.createAccessor()
		.setType(path === 'rotation' ? 'VEC4' : 'VEC3')
		.setArray(new Float32Array(track.values))
		.setBuffer(buffer);
	const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
	const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler);
	anim.addSampler(sampler).addChannel(channel);
	bound++;
}
if (!bound) throw new Error('no clip track bound to a node in the source avatar');

await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(OUT, doc);

const outBytes = readFileSync(OUT).byteLength;
console.log(
	`[bake-default-idle] ${CLIP} -> ${OUT.replace(REPO + '/', '')}: ${bound} channels, ` +
	`coverage ${(result.coverage * 100).toFixed(0)}%, ${clip.duration.toFixed(2)} s loop, ${(outBytes / 1024).toFixed(0)} KB`,
);
