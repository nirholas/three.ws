// One call that gives a hand-built three.js scene the image pipeline every
// serious viewer ships (model-viewer, drei <Stage>, Sketchfab, Babylon's
// sandbox): sRGB output, a filmic tone curve, a studio image-based light so
// PBR materials read as metal, plastic and cloth instead of flat colour, and a
// sane pixel-ratio cap.
//
// Most of our standalone 3D pages built a WebGLRenderer, added a couple of
// direct lights, and stopped. MeshStandardMaterial without an environment map
// has nothing to reflect, so every model on those pages looked like matte clay.
// This module is the shared fix: the studio environment is generated once per
// renderer, shared by every scene drawn with it, survives a lost-and-restored
// WebGL context, and is freed when the last scene using it lets go.

import {
	ACESFilmicToneMapping,
	AgXToneMapping,
	NeutralToneMapping,
	NoToneMapping,
	PMREMGenerator,
	SRGBColorSpace,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const TONE_MAPPINGS = Object.freeze({
	neutral: NeutralToneMapping,
	agx: AgXToneMapping,
	aces: ACESFilmicToneMapping,
	none: NoToneMapping,
});

/**
 * Pick the tone mapping to use. An explicit request wins (a name from
 * TONE_MAPPINGS or a three.js constant). With no request, a page that already
 * chose a curve keeps it, and a page that never chose one gets Khronos PBR
 * Neutral, the curve built for showing products and characters at their true
 * colour (it is what model-viewer uses by default).
 *
 * @param {string|number|undefined} requested
 * @param {number} current the renderer's current toneMapping
 * @returns {number}
 */
export function resolveToneMapping(requested, current) {
	if (typeof requested === 'number') return requested;
	if (typeof requested === 'string') {
		const key = requested.toLowerCase();
		if (!(key in TONE_MAPPINGS)) {
			throw new TypeError(`Unknown tone mapping "${requested}". Use one of: ${Object.keys(TONE_MAPPINGS).join(', ')}`);
		}
		return TONE_MAPPINGS[key];
	}
	return current && current !== NoToneMapping ? current : NeutralToneMapping;
}

/** Device pixel ratio capped at `max`, never below 1. */
export function cappedPixelRatio(max = 2, devicePixelRatio = globalThis.devicePixelRatio) {
	return Math.max(1, Math.min(devicePixelRatio || 1, max));
}

// renderer -> { texture, users }
const studioEnvironments = new WeakMap();

function buildStudioEnvironment(renderer) {
	const pmrem = new PMREMGenerator(renderer);
	const room = new RoomEnvironment();
	const texture = pmrem.fromScene(room, 0.04).texture;
	room.dispose();
	pmrem.dispose();
	return texture;
}

/**
 * The shared studio environment for a renderer, generated on first use.
 * Callers that hold onto it should pair this with releaseStudioEnvironment.
 */
export function getStudioEnvironment(renderer) {
	let entry = studioEnvironments.get(renderer);
	if (!entry) {
		entry = { texture: buildStudioEnvironment(renderer), users: 0 };
		studioEnvironments.set(renderer, entry);
		// A lost context takes the render target holding the prefiltered
		// environment with it, and three.js cannot re-render it on restore.
		// Drop the cache entry so the next request rebuilds a live one.
		renderer.domElement?.addEventListener?.(
			'webglcontextlost',
			() => {
				if (studioEnvironments.get(renderer) === entry) studioEnvironments.delete(renderer);
			},
			{ once: true },
		);
	}
	entry.users += 1;
	return entry.texture;
}

export function releaseStudioEnvironment(renderer) {
	const entry = studioEnvironments.get(renderer);
	if (!entry) return;
	entry.users -= 1;
	if (entry.users <= 0) {
		entry.texture.dispose();
		studioEnvironments.delete(renderer);
	}
}

/**
 * Apply the studio image pipeline to a renderer and (optionally) a scene.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} [scene] receives the studio environment
 * @param {object} [opts]
 * @param {string|number} [opts.toneMapping] 'neutral' | 'agx' | 'aces' | 'none' or a three.js constant
 * @param {number} [opts.exposure]           toneMappingExposure (left alone when omitted)
 * @param {boolean|import('three').Texture} [opts.environment=true] true for the studio room, a texture to use your own, false for none
 * @param {number} [opts.environmentIntensity=1] scene.environmentIntensity; lower it when the page also has strong direct lights
 * @param {number|false} [opts.maxPixelRatio=2] cap for setPixelRatio, or false to leave the pixel ratio alone
 * @returns {() => void} undo the environment assignment and release the shared texture
 */
export function applyStudioLook(renderer, scene, opts = {}) {
	const { toneMapping, exposure, environment = true, environmentIntensity = 1, maxPixelRatio = 2 } = opts;

	renderer.outputColorSpace = SRGBColorSpace;
	renderer.toneMapping = resolveToneMapping(toneMapping, renderer.toneMapping);
	if (exposure != null) renderer.toneMappingExposure = exposure;
	if (maxPixelRatio !== false) renderer.setPixelRatio(cappedPixelRatio(maxPixelRatio));

	if (!scene || !environment) return () => {};

	if (environment !== true) {
		scene.environment = environment;
		scene.environmentIntensity = environmentIntensity;
		return () => {
			if (scene.environment === environment) scene.environment = null;
		};
	}

	let current = getStudioEnvironment(renderer);
	scene.environment = current;
	scene.environmentIntensity = environmentIntensity;

	const canvas = renderer.domElement;
	const onRestored = () => {
		// The lost-context handler already evicted the dead texture; this builds
		// a fresh one on the restored context and points the scene at it.
		const fresh = getStudioEnvironment(renderer);
		if (scene.environment === current) scene.environment = fresh;
		current = fresh;
	};
	canvas?.addEventListener?.('webglcontextrestored', onRestored);

	let released = false;
	return () => {
		if (released) return;
		released = true;
		canvas?.removeEventListener?.('webglcontextrestored', onRestored);
		if (scene.environment === current) scene.environment = null;
		releaseStudioEnvironment(renderer);
	};
}
