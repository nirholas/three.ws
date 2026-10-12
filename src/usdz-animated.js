// Animated USDZ pipeline — gives iOS AR Quick Look a *living* avatar.
//
// three.js's USDZExporter drops skeletons entirely, so the static pipeline
// (usdz-pipeline.js) bakes one frozen pose. This module goes one step further:
// it drives the avatar through an animation clip, samples the skinned vertices
// at a handful of keyframes, and writes them into the USDA as time-sampled
// `point3f[] points`. Quick Look interpolates and loops those samples on its
// own, so the avatar breathes / idles / walks in the user's room instead of
// standing there as a mannequin.
//
// Design: we lean on the *proven* static exporter for everything Quick Look is
// fussy about — materials, textures, the 64-byte-aligned zip — by exporting a
// frame-0 scene through three's USDZExporter, then surgically rewriting only
// each animated mesh's `points` into `.timeSamples` and adding the stage's
// playback timing. The single hand-authored part (vertex time samples) is pure
// string work and fully unit-tested; the rest is byte-identical to the shipping
// static path. Any failure (no rig, no usable clip, format drift) throws so the
// caller can fall back to the static USDZ — AR never regresses.

import { AnimationMixer, Mesh, BufferAttribute } from 'three';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { strToU8, strFromU8, zipSync, unzipSync } from 'three/addons/libs/fflate.module.js';

import {
	_loadGlbBlob,
	_bakedLocalPositions,
	_coerceMaterialsToStandard,
	_ensureNormals,
	glbBlobToUsdzBlob,
} from './usdz-pipeline.js';
import { retargetClipToObject } from './animation-retarget.js';
import { log } from './shared/log.js';

// Default idle that ships in public/animations — a slow breathing loop that
// reads as "alive" the instant the avatar lands in AR.
export const DEFAULT_AR_ANIMATION = '/animations/Idle_Breath.glb';

const DEFAULTS = {
	targetFps: 12, // sampling density; Quick Look interpolates between samples, so an idle reads smooth here
	maxFrames: 24, // hard cap so a long clip can't balloon the .usdz over cellular (~Nverts × 24 ASCII frames)
	minFrames: 2,
	precision: 5, // ASCII float digits — 5 keeps idle silhouettes crisp at roughly a third the bytes of 7
};

/* ────────────────────────────────────────────────────────────────────────── *
 * Pure serialization helpers (unit-tested directly)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Serialize a flat [x,y,z,x,y,z,…] Float32Array into USD point-array text:
 * `(x, y, z), (x, y, z), …`.
 */
export function _vec3ArrayToUsd(flat, precision = DEFAULTS.precision) {
	const parts = new Array(flat.length / 3);
	for (let i = 0, p = 0; i < flat.length; i += 3, p++) {
		parts[p] = `(${flat[i].toPrecision(precision)}, ${flat[i + 1].toPrecision(
			precision,
		)}, ${flat[i + 2].toPrecision(precision)})`;
	}
	return parts.join(', ');
}

/**
 * Build the `point3f[] points.timeSamples = { … }` block from per-frame
 * position arrays. Frame index doubles as the USD time code; the stage's
 * timeCodesPerSecond (see _injectStageTiming) governs real playback speed.
 */
export function _pointsTimeSamplesBlock(framesPositions, precision = DEFAULTS.precision) {
	const lines = framesPositions.map(
		(flat, frame) => `\t\t\t\t${frame}: [${_vec3ArrayToUsd(flat, precision)}],`,
	);
	return `point3f[] points.timeSamples = {\n${lines.join('\n')}\n\t\t\t}`;
}

// Matches three's single-line static `point3f[] points = [ … ]` property. The
// array body holds only numbers, commas, parens and spaces — never a `]` — so a
// negated-class run is a safe, unambiguous match.
const STATIC_POINTS_RE = /point3f\[\] points = \[[^\]]*\]/;

/**
 * Replace a geometry file's static points with time-sampled animation.
 * Throws if the expected static-points property isn't present (format drift) so
 * the caller can fall back rather than ship a silently-broken file.
 */
export function _patchGeometryPoints(usda, framesPositions, precision = DEFAULTS.precision) {
	if (!STATIC_POINTS_RE.test(usda)) {
		throw new Error('animated-usdz: geometry has no static points property to animate');
	}
	return usda.replace(STATIC_POINTS_RE, _pointsTimeSamplesBlock(framesPositions, precision));
}

const HEADER_UPAXIS_RE = /\tupAxis = "Y"\n\)/;

/**
 * Add playback timing to the stage's layer metadata so Quick Look knows the
 * clip's frame range and speed. `timeCodesPerSecond` is set so the whole sample
 * set plays back over the clip's real duration (i.e. true-to-life tempo).
 */
export function _injectStageTiming(modelUsda, { frameCount, durationSeconds }) {
	if (!HEADER_UPAXIS_RE.test(modelUsda)) {
		throw new Error('animated-usdz: unexpected USDA header — cannot inject timing');
	}
	const endTimeCode = Math.max(0, frameCount - 1);
	// frames are evenly spaced over the clip; codes/sec = (count-1)/duration keeps
	// real-time tempo. Guard a zero/tiny duration so we never divide by ~0.
	const tps = durationSeconds > 1e-3 ? endTimeCode / durationSeconds : DEFAULTS.targetFps;
	const timing = [
		'\tupAxis = "Y"',
		'\tstartTimeCode = 0',
		`\tendTimeCode = ${endTimeCode}`,
		`\ttimeCodesPerSecond = ${tps.toPrecision(6)}`,
		`\tframesPerSecond = ${tps.toPrecision(6)}`,
		')',
	].join('\n');
	return modelUsda.replace(HEADER_UPAXIS_RE, timing);
}

/**
 * Re-pack a USDZ from a {filename: Uint8Array} map, mirroring three's
 * USDZExporter exactly: model.usda first, stored (level 0), each entry padded so
 * its payload starts on a 64-byte boundary (required for mmap'd USD reads).
 */
export function _packUsdz(files) {
	// model.usda must be the first archive entry.
	const ordered = {};
	if (files['model.usda']) ordered['model.usda'] = files['model.usda'];
	for (const name in files) {
		if (name !== 'model.usda') ordered[name] = files[name];
	}

	let offset = 0;
	for (const filename in ordered) {
		const file = ordered[filename];
		const headerSize = 34 + filename.length;
		offset += headerSize;
		const offsetMod64 = offset & 63;
		if (offsetMod64 !== 4) {
			const padding = new Uint8Array(64 - offsetMod64);
			ordered[filename] = [file, { extra: { 12345: padding } }];
		}
		offset = file.length;
	}
	return zipSync(ordered, { level: 0 });
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Sampling
 * ────────────────────────────────────────────────────────────────────────── */

function collectSkinnedMeshes(root) {
	const out = [];
	root.traverse((o) => {
		if (o.isSkinnedMesh && o.skeleton?.bones?.length && o.geometry?.getAttribute('position')) {
			out.push(o);
		}
	});
	return out;
}

/**
 * Drive `mixer` through `clip` and capture each skinned mesh's deformed
 * local-space vertices at `frameCount` evenly-spaced times across the clip.
 *
 * @returns {Map<SkinnedMesh, Float32Array[]>} mesh → array of per-frame positions
 */
export function _sampleSkinnedFrames(scene, mixer, action, meshes, { frameCount, duration }) {
	const perMesh = new Map(meshes.map((m) => [m, []]));
	action.play();
	for (let f = 0; f < frameCount; f++) {
		const t = (f / frameCount) * duration; // [0, duration) so frame N wraps to frame 0
		mixer.setTime(t);
		scene.updateMatrixWorld(true);
		for (const mesh of meshes) {
			perMesh.get(mesh).push(_bakedLocalPositions(mesh));
		}
	}
	return perMesh;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Orchestration
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Resolve an AnimationClip that targets `scene`'s nodes. Priority:
 *   1. an explicit clip passed by the caller (retargeted onto the avatar),
 *   2. a clip loaded from `animationGlbBlob` (retargeted),
 *   3. a clip already embedded in the avatar GLB (used as-is).
 * Returns null if nothing usable is found.
 */
async function resolveClip(scene, avatarGltf, { clip, animationGlbBlob }) {
	if (clip) {
		const { clip: retargeted } = retargetClipToObject(clip, scene);
		if (retargeted) return retargeted;
	}
	if (animationGlbBlob) {
		const animGltf = await _loadGlbBlob(animationGlbBlob);
		const source = animGltf.animations?.[0];
		if (source) {
			const { clip: retargeted } = retargetClipToObject(source, scene);
			if (retargeted) return retargeted;
		}
	}
	// Already authored against this rig — no retarget needed.
	if (avatarGltf.animations?.length) return avatarGltf.animations[0];
	return null;
}

/**
 * Replace skinned meshes with frame-0 static meshes for the base export, and
 * record each one's geometry id alongside its captured frames so we can find
 * and rewrite the matching `geometries/Geometry_<id>.usda` after export. Static
 * (non-skinned) meshes are left untouched and simply stay un-animated.
 */
function buildFrame0Scene(scene, framesByMesh) {
	const animated = []; // { geomId, frames }
	for (const [skinned, frames] of framesByMesh) {
		const geo = skinned.geometry.clone();
		geo.setAttribute('position', new BufferAttribute(frames[0], 3));
		geo.deleteAttribute('skinIndex');
		geo.deleteAttribute('skinWeight');
		geo.computeVertexNormals();

		const mesh = new Mesh(geo, skinned.material);
		mesh.name = skinned.name;
		mesh.visible = skinned.visible;
		mesh.position.copy(skinned.position);
		mesh.quaternion.copy(skinned.quaternion);
		mesh.scale.copy(skinned.scale);

		(skinned.parent || scene).add(mesh);
		(skinned.parent || scene).remove(skinned);

		animated.push({ geomId: geo.id, frames });
	}
	return animated;
}

/**
 * Convert a GLB Blob to an *animated* USDZ Blob for iOS Quick Look.
 *
 * @param {Blob} glbBlob — the avatar GLB
 * @param {object} [opts]
 * @param {Blob}  [opts.animationGlbBlob] — clip source GLB (e.g. Idle_Breath.glb)
 * @param {import('three').AnimationClip} [opts.clip] — pre-loaded clip (alternative to a blob)
 * @param {number} [opts.targetFps]
 * @param {number} [opts.maxFrames]
 * @param {number} [opts.precision]
 * @returns {Promise<Blob>} an animated .usdz blob
 */
export async function glbBlobToAnimatedUsdzBlob(glbBlob, opts = {}) {
	const cfg = { ...DEFAULTS, ...opts };

	const avatarGltf = await _loadGlbBlob(glbBlob);
	const scene = avatarGltf.scene || avatarGltf.scenes?.[0];
	if (!scene) throw new Error('animated-usdz: glb contained no scene');

	const meshes = collectSkinnedMeshes(scene);
	if (!meshes.length) throw new Error('animated-usdz: avatar has no skinned meshes to animate');

	const clip = await resolveClip(scene, avatarGltf, opts);
	if (!clip || !(clip.duration > 0)) {
		throw new Error('animated-usdz: no usable animation clip for this avatar');
	}

	const frameCount = Math.min(
		cfg.maxFrames,
		Math.max(cfg.minFrames, Math.round(clip.duration * cfg.targetFps)),
	);

	const mixer = new AnimationMixer(scene);
	const action = mixer.clipAction(clip);
	const framesByMesh = _sampleSkinnedFrames(scene, mixer, action, meshes, {
		frameCount,
		duration: clip.duration,
	});

	const animated = buildFrame0Scene(scene, framesByMesh);
	_coerceMaterialsToStandard(scene);
	// Cover any non-skinned meshes (static props/accessories) that ship without
	// normals so the base export doesn't warn or render them flat in Quick Look.
	_ensureNormals(scene);

	// Base export: proven materials / textures / alignment from the static path.
	const exporter = new USDZExporter();
	const baseBytes = await exporter.parseAsync(scene);

	// Rewrite only the animated geometry + stage timing, then re-pack.
	const files = unzipSync(baseBytes);
	if (!files['model.usda']) throw new Error('animated-usdz: base export missing model.usda');

	for (const { geomId, frames } of animated) {
		const name = `geometries/Geometry_${geomId}.usda`;
		const usda = files[name];
		if (!usda) throw new Error(`animated-usdz: missing geometry file ${name}`);
		files[name] = strToU8(_patchGeometryPoints(strFromU8(usda), frames, cfg.precision));
	}

	files['model.usda'] = strToU8(
		_injectStageTiming(strFromU8(files['model.usda']), {
			frameCount,
			durationSeconds: clip.duration,
		}),
	);

	return new Blob([_packUsdz(files)], { type: 'model/vnd.usdz+zip' });
}

/**
 * Best-effort USDZ for iOS Quick Look: prefer a living, animated avatar;
 * fall back to the proven static bake if the avatar can't be animated (no
 * rig, clip won't retarget, fetch fails). Either way the caller gets a
 * correct USDZ: animation is upside, never a gate. Shared by `<agent-3d>`'s
 * own AR wiring and anything else that needs on-device USDZ from a GLB.
 *
 * @param {Blob} glbBlob
 * @param {object} [opts]
 * @param {(message: string) => void} [opts.onStatus] progress text for a host UI
 * @returns {Promise<Blob>}
 */
export async function buildBestEffortArUsdz(glbBlob, { onStatus } = {}) {
	try {
		onStatus?.('Bringing your avatar to life…');
		const animResp = await fetch(DEFAULT_AR_ANIMATION);
		if (!animResp.ok) throw new Error(`animation fetch ${animResp.status}`);
		const animationGlbBlob = await animResp.blob();
		return await glbBlobToAnimatedUsdzBlob(glbBlob, { animationGlbBlob });
	} catch (err) {
		log.warn('[usdz-animated] animated USDZ unavailable, using static:', err?.message);
		onStatus?.('Generating AR preview…');
		return glbBlobToUsdzBlob(glbBlob);
	}
}
