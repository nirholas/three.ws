// Bake a generated motion clip onto a rig and emit a self-contained animated GLB.
//
// WHY THIS EXISTS. The generated half of the animation library
// (animations/library/generated/clips/*.json) is public clip JSON: it drives
// avatars in the browser, where src/animation-retarget.js maps it onto whatever
// skeleton the page loaded. That JSON is not a product anyone would buy, because
// it is already free and it is useless outside three.ws. The sellable artifact is
// the motion baked onto the platform's own rig as one portable GLB a buyer can
// drop into Blender, Unity or Unreal. This module is the bake.
//
// HOW. A three.js AnimationClip.toJSON() track set is, channel for channel, a
// glTF animation: per-bone quaternion tracks are `rotation` channels, the root
// translation track is a `translation` channel, and the sample times are the
// sampler input. So the bake is a container edit, not a render: parse the rig's
// GLB, append the keyframe floats to the BIN chunk, add the accessors and
// bufferViews that describe them, and write one `animations` entry. Nothing is
// decoded, no mesh is touched, and a meshopt-compressed rig survives untouched
// because its bufferViews are never read.
//
// The alternative was three.js GLTFLoader plus GLTFExporter in-process, which
// needs a DOM (`self`, FileReader, createObjectURL) and would decode and
// re-encode every texture in the rig to write a few hundred KB of keyframes.
//
// THE CLIP MUST BE RETARGETED FIRST, and this is the part that is easy to get
// wrong: library clips are authored in the `cz` rig's rest basis (an A-pose),
// so their per-bone quaternions are local rotations RELATIVE TO THAT REST. Write
// them straight onto a rig that rests differently and the pose is not merely
// imprecise, it is broken. Baking one onto the Ready Player Me default rig
// without the correction puts the feet at 1.85 m and the head at 1.46 m: the
// legs fold up over the body. So the bake runs the clip through
// src/animation-retarget.js, the same retarget the browser applies before
// playing any library clip, which composes the bind correction
// (q <- L * q * R) from the source rest basis to this rig's. A rig that rests
// in the authoring basis gets an identity correction and round-trips unchanged.
//
// Retargeting also settles the track policy, which is why this module does not
// re-implement it: quaternions for every bone the rig has, translation for the
// root (Hips) only, scaled to the target's hip height, and nothing else. A
// clip's per-bone position and scale channels describe the SOURCE rig's bone
// lengths, and writing them onto another skeleton overwrites its proportions.
//
// ROOT DRIFT is removed before the bake by default. The published generated
// clips predate flattenRootDrift (api/_lib/motion-seed.js) and still carry the
// lane's constant forward ramp, so a GLB baked straight from one walks a metre
// forward while it applauds. The sellable artifact is the thing a buyer opens in
// Blender, so it gets the corrected motion whether or not the clip JSON behind
// it has been republished yet. Pass `flatten: false` to bake a clip exactly as
// given, which is what the round-trip tests do.
//
// Spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html

import { AnimationClip, Quaternion } from 'three';

import { canonicalizeBoneName } from '../../src/glb-canonicalize.js';
import { clipHipBaselineY, retargetClip } from '../../src/animation-retarget.js';
import { flattenRootDrift } from './motion-seed.js';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

const FLOAT = 5126;
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

// Every bone name a generated clip can carry is canonical (Hips, Spine, LeftArm
// ...) because the seeding gate rejects anything else, so the root track is
// found by exact name rather than by re-running canonicalization here.
const ROOT_BONE = 'Hips';

/**
 * Split a GLB into its JSON and BIN chunks.
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {{ json: any, bin: Buffer }}
 */
export function readGlbChunks(buf) {
	if (!buf || typeof buf.length !== 'number' || buf.length < HEADER_BYTES + CHUNK_HEADER_BYTES) {
		throw new Error('not a glb: too short');
	}
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a glb: bad magic');
	if (view.getUint32(4, true) !== 2) throw new Error('not a glb: unsupported version');

	let json = null;
	let bin = null;
	let offset = HEADER_BYTES;
	while (offset + CHUNK_HEADER_BYTES <= buf.length) {
		const length = view.getUint32(offset, true);
		const type = view.getUint32(offset + 4, true);
		const start = offset + CHUNK_HEADER_BYTES;
		const end = start + length;
		if (end > buf.length) throw new Error('not a glb: chunk overruns the file');
		if (type === CHUNK_JSON && json === null) {
			json = JSON.parse(Buffer.from(buf.buffer, buf.byteOffset + start, length).toString('utf8'));
		} else if (type === CHUNK_BIN && bin === null) {
			bin = Buffer.from(Buffer.from(buf.buffer, buf.byteOffset + start, length));
		}
		offset = end + padding(length);
	}
	if (!json) throw new Error('not a glb: no JSON chunk');
	return { json, bin: bin || Buffer.alloc(0) };
}

/**
 * Re-assemble a GLB from a JSON chunk and a BIN chunk, padding both to the
 * 4-byte boundary the spec requires (JSON with spaces, BIN with zeros).
 *
 * @param {any} json
 * @param {Buffer} bin
 * @returns {Buffer}
 */
export function writeGlbChunks(json, bin) {
	const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
	const jsonPad = Buffer.alloc(padding(jsonBytes.length), 0x20);
	const binPad = Buffer.alloc(padding(bin.length), 0x00);

	const jsonLength = jsonBytes.length + jsonPad.length;
	const binLength = bin.length + binPad.length;
	const total =
		HEADER_BYTES +
		CHUNK_HEADER_BYTES +
		jsonLength +
		(binLength > 0 ? CHUNK_HEADER_BYTES + binLength : 0);

	const head = Buffer.alloc(HEADER_BYTES + CHUNK_HEADER_BYTES);
	head.writeUInt32LE(GLB_MAGIC, 0);
	head.writeUInt32LE(2, 4);
	head.writeUInt32LE(total, 8);
	head.writeUInt32LE(jsonLength, 12);
	head.writeUInt32LE(CHUNK_JSON, 16);

	const parts = [head, jsonBytes, jsonPad];
	if (binLength > 0) {
		const binHead = Buffer.alloc(CHUNK_HEADER_BYTES);
		binHead.writeUInt32LE(binLength, 0);
		binHead.writeUInt32LE(CHUNK_BIN, 4);
		parts.push(binHead, bin, binPad);
	}
	return Buffer.concat(parts, total);
}

function padding(length) {
	return (4 - (length % 4)) % 4;
}

/**
 * World-space rest height of a rig's root bone, walking the node hierarchy and
 * accumulating each ancestor's translation and uniform Y scale. This is the
 * number a clip's root-motion track is rescaled against.
 *
 * @param {any} gltf parsed glTF JSON
 * @param {string} [boneName]
 * @returns {number|null} null when the rig has no such bone
 */
export function restBoneHeight(gltf, boneName = ROOT_BONE) {
	const nodes = Array.isArray(gltf?.nodes) ? gltf.nodes : [];
	const index = nodes.findIndex((n) => n?.name === boneName);
	if (index === -1) return null;

	const parents = new Map();
	nodes.forEach((node, i) => {
		for (const child of node?.children || []) parents.set(child, i);
	});

	let height = 0;
	let cursor = index;
	const seen = new Set();
	while (cursor !== undefined && !seen.has(cursor)) {
		seen.add(cursor);
		const node = nodes[cursor];
		if (!node) break;
		const scaleY = Array.isArray(node.scale) ? node.scale[1] : 1;
		const translateY = Array.isArray(node.translation) ? node.translation[1] : 0;
		height = translateY + height * scaleY;
		cursor = parents.get(cursor);
	}
	return height;
}

// glTF animation target path for a three.js track property, or null to drop it.
// Only the channels the retarget already decided to keep reach this, so there is
// no bone-name test here: a `.position` track that survived the retarget is the
// root's by construction.
function targetPathFor(property) {
	if (property === 'quaternion') return 'rotation';
	if (property === 'position') return 'translation';
	return null;
}

function componentsFor(path) {
	return path === 'rotation' ? 4 : 3;
}

function typeFor(path) {
	return path === 'rotation' ? 'VEC4' : 'VEC3';
}

/**
 * The rig's rest basis, read straight out of the glTF JSON: for every node whose
 * name canonicalizes to a known humanoid bone, its local rest rotation and its
 * world (model-frame) rest rotation. These are the two maps `retargetClip` needs
 * to build the bind correction, and deriving them from the container means the
 * bake never has to instantiate a three.js scene graph.
 *
 * First name wins, matching canonicalNodeMapFromObject's traversal order.
 *
 * @param {any} gltf parsed glTF JSON
 */
export function restBasisFromGltf(gltf) {
	const nodes = Array.isArray(gltf?.nodes) ? gltf.nodes : [];
	const parents = new Map();
	nodes.forEach((node, i) => {
		for (const child of node?.children || []) parents.set(child, i);
	});

	const localOf = (i) => {
		const r = nodes[i]?.rotation;
		return Array.isArray(r) ? new Quaternion(r[0], r[1], r[2], r[3]) : new Quaternion();
	};
	// worldRestQuat(node, null): the node's own rotation with every ancestor's
	// premultiplied onto it, walking to the top of the graph.
	const worldOf = (i) => {
		const q = localOf(i);
		for (let cursor = parents.get(i); cursor !== undefined; cursor = parents.get(cursor)) {
			q.premultiply(localOf(cursor));
		}
		return q;
	};

	const canonicalToNode = new Map();
	const targetRest = new Map();
	const targetWorldRest = new Map();
	let hipsParentWorldQuat = null;

	nodes.forEach((node, i) => {
		const name = node?.name;
		if (!name) return;
		const canonical = canonicalizeBoneName(name);
		if (!canonical || canonicalToNode.has(canonical)) return;
		canonicalToNode.set(canonical, name);
		targetRest.set(canonical, localOf(i));
		targetWorldRest.set(canonical, worldOf(i));
		if (canonical === ROOT_BONE) {
			const parent = parents.get(i);
			if (parent !== undefined) hipsParentWorldQuat = worldOf(parent);
		}
	});

	return { canonicalToNode, targetRest, targetWorldRest, hipsParentWorldQuat };
}

/**
 * Bake one clip onto one rig.
 *
 * @param {{
 *   rig: Buffer|Uint8Array,
 *   clip: { name?: string, duration?: number, tracks: Array<{ name: string, type?: string, times: number[], values: number[] }> },
 *   name?: string,
 *   flatten?: boolean,
 *   retarget?: boolean,
 * }} input
 * @returns {{ glb: Buffer, channels: number, droppedTracks: string[], hipScale: number, duration: number, driftRemoved: number, coverage: number }}
 */
export function bakeMotionGlb({ rig, clip: input, name, flatten = true, retarget = true }) {
	if (!input || !Array.isArray(input.tracks) || input.tracks.length === 0) {
		throw new Error('clip has no tracks');
	}
	const drift = flatten ? flattenRootDrift(input) : { clip: input, removed: 0 };
	const { json, bin } = readGlbChunks(rig);
	const nodes = Array.isArray(json.nodes) ? json.nodes : [];
	if (nodes.length === 0) throw new Error('rig has no nodes');

	const nodeIndex = new Map();
	nodes.forEach((node, i) => {
		if (node?.name && !nodeIndex.has(node.name)) nodeIndex.set(node.name, i);
	});

	const { clip, hipScale, coverage, droppedTracks } = prepareClip(drift.clip, json, { retarget, name });

	const chunks = [bin];
	let cursor = bin.length;
	const bufferViews = Array.isArray(json.bufferViews) ? json.bufferViews : (json.bufferViews = []);
	const accessors = Array.isArray(json.accessors) ? json.accessors : (json.accessors = []);

	/** Append float data to the BIN chunk and return its accessor index. */
	const pushAccessor = (values, count, type, bounds) => {
		const pad = padding(cursor);
		if (pad) {
			chunks.push(Buffer.alloc(pad));
			cursor += pad;
		}
		const data = Buffer.from(new Float32Array(values).buffer);
		chunks.push(data);
		bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: data.length });
		cursor += data.length;
		accessors.push({
			bufferView: bufferViews.length - 1,
			componentType: FLOAT,
			count,
			type,
			...(bounds ? { min: bounds.min, max: bounds.max } : {}),
		});
		return accessors.length - 1;
	};

	const samplers = [];
	const channels = [];
	// One clip resamples every track on the same grid, so identical time arrays
	// are shared rather than written once per bone.
	const timeAccessors = new Map();
	let duration = Number(clip.duration) || 0;

	for (const track of clip.tracks) {
		const rawName = String(track?.name || '');
		const dot = rawName.lastIndexOf('.');
		const bone = dot === -1 ? rawName : rawName.slice(0, dot);
		const property = dot === -1 ? '' : rawName.slice(dot + 1);
		const path = targetPathFor(property);
		const node = nodeIndex.get(bone);

		if (path === null || node === undefined) {
			droppedTracks.push(rawName);
			continue;
		}
		const times = Array.from(track.times || []);
		const stride = componentsFor(path);
		const values = Array.from(track.values || []);
		if (times.length === 0 || values.length !== times.length * stride) {
			droppedTracks.push(rawName);
			continue;
		}

		const key = `${times.length}:${times[0]}:${times[times.length - 1]}`;
		let input_ = timeAccessors.get(key);
		if (input_ === undefined) {
			// The spec requires min and max on an animation sampler's input.
			input_ = pushAccessor(times, times.length, 'SCALAR', {
				min: [times[0]],
				max: [times[times.length - 1]],
			});
			timeAccessors.set(key, input_);
		}
		duration = Math.max(duration, times[times.length - 1]);

		const output = pushAccessor(values, times.length, typeFor(path));
		samplers.push({ input: input_, output, interpolation: 'LINEAR' });
		channels.push({ sampler: samplers.length - 1, target: { node, path } });
	}

	if (channels.length === 0) throw new Error('no clip track matched a bone on this rig');

	const animations = Array.isArray(json.animations) ? json.animations : (json.animations = []);
	animations.push({ name: name || clip.name || 'motion', channels, samplers });

	const merged = Buffer.concat(chunks, cursor);
	json.buffers = Array.isArray(json.buffers) ? json.buffers : [];
	if (json.buffers.length === 0) json.buffers.push({ byteLength: merged.length });
	else json.buffers[0] = { ...json.buffers[0], byteLength: merged.length };

	return {
		glb: writeGlbChunks(json, merged),
		channels: channels.length,
		droppedTracks,
		hipScale,
		duration,
		driftRemoved: drift.removed,
		coverage,
	};
}

/**
 * Run the clip through the platform retarget so its rotations are expressed in
 * THIS rig's rest basis, and its root translation in this rig's scale. Returns
 * the clip in the shape the writer above consumes: track names are target node
 * names, and only retargetable channels survive.
 */
function prepareClip(source, gltf, { retarget, name }) {
	if (!retarget) {
		return { clip: source, hipScale: 1, coverage: 1, droppedTracks: [] };
	}
	const basis = restBasisFromGltf(gltf);
	const parsed = AnimationClip.parse({ ...source, name: name || source.name || 'motion' });

	// Root translation is authored around the source rig's hip height; scale it
	// onto this one, clamped exactly as retargetClipToRig clamps it so a
	// near-zero baseline on an in-place clip cannot fling the root away.
	let hipScale = 1;
	const targetY = restBoneHeight(gltf, ROOT_BONE);
	const sourceY = clipHipBaselineY(parsed);
	if (targetY > 0.05 && sourceY > 0.05) hipScale = Math.min(5, Math.max(0.2, targetY / sourceY));

	const result = retargetClip(parsed, basis.canonicalToNode, {
		hipScale,
		targetRest: basis.targetRest,
		targetWorldRest: basis.targetWorldRest,
		hipsParentWorldQuat: basis.hipsParentWorldQuat,
	});
	if (!result.clip) {
		throw new Error(
			`retarget covered only ${(result.coverage * 100).toFixed(0)}% of the clip's bones on this rig`,
		);
	}
	return {
		clip: result.clip,
		hipScale,
		coverage: result.coverage,
		droppedTracks: Array.isArray(result.dropped) ? [...result.dropped] : [],
	};
}
