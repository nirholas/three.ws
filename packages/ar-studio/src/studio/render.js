// Rendering defaults that make a model look like it belongs in the room.
//
// Three things separate "a 3D object pasted on a camera feed" from "an object in
// the room": filmic tone mapping (so bright materials roll off instead of
// clipping to white), correct sRGB output (so colours are the colours the artist
// authored), and image-based lighting from a real photographic environment (so
// metal and glass reflect something plausible). This module applies all three,
// picks a quality tier from real device signals, and never blocks the first
// frame on a download.
//
// Ported from the three.ws shared renderer defaults (Apache-2.0), with the HDRI
// set made configurable.

import {
	ACESFilmicToneMapping, SRGBColorSpace, VSMShadowMap, PMREMGenerator,
	Box3, PlaneGeometry, ShadowMaterial, Mesh,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THREE_WS } from '../config.js';

/** Render budgets per tier. 'mobile' matches a low-end phone profile. */
export const QUALITY_TIERS = {
	high: { pixelRatioCap: 2, shadows: true, hdri: true },
	medium: { pixelRatioCap: 1.5, shadows: true, hdri: true },
	mobile: { pixelRatioCap: 1, shadows: false, hdri: false },
};

/**
 * Pick a quality tier from real capability signals rather than a UA guess alone.
 * @param {{navigator?: object, window?: object}} [env]
 * @returns {'high'|'medium'|'mobile'}
 */
export function detectQualityTier(env = {}) {
	const nav = env.navigator ?? (typeof navigator !== 'undefined' ? navigator : {});
	const win = env.window ?? (typeof window !== 'undefined' ? window : {});
	const ua = String(nav.userAgent || '');
	const isMobile = /(iPhone|iPad|Android|Mobi)/i.test(ua);
	const lowMem = (nav.deviceMemory ?? 8) < 4;
	const lowCores = (nav.hardwareConcurrency ?? 8) < 4;
	const coarse = !!(win.matchMedia && win.matchMedia('(any-pointer: coarse)').matches);
	if (isMobile && (lowMem || lowCores)) return 'mobile';
	if (coarse || lowMem || lowCores) return 'medium';
	return 'high';
}

/**
 * Apply tone mapping, colour space, pixel-ratio cap and shadow type. Call once,
 * straight after constructing the renderer.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @param {{exposure?: number, tier?: 'high'|'medium'|'mobile'}} [opts]
 * @returns {{pixelRatioCap:number, shadows:boolean, hdri:boolean}} the applied budget
 */
export function applyCinematicDefaults(renderer, opts = {}) {
	const tier = QUALITY_TIERS[opts.tier] ? opts.tier : 'high';
	const budget = QUALITY_TIERS[tier];
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = opts.exposure ?? 1.15;
	renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, budget.pixelRatioCap));
	renderer.shadowMap.enabled = budget.shadows;
	if (budget.shadows) renderer.shadowMap.type = VSMShadowMap;
	return budget;
}

const _envCache = new Map();

/**
 * Light the scene from an environment map.
 *
 * The procedural room environment is installed FIRST, synchronously, every time:
 * it costs about a millisecond and lights the very first frame. A real HDRI (one
 * or two megabytes) then replaces it when it arrives, so the visible change is a
 * refinement of an already-correct image rather than the moment the world
 * becomes lit. It is also the permanent answer on the mobile tier and whenever
 * the fetch fails.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {string|null} preset  Key into `urls`, or null for the procedural room only.
 * @param {{urls?: Record<string,string>}} [opts]
 * @returns {Promise<import('three').Texture>} the installed environment map
 */
export async function loadEnvironment(renderer, scene, preset = 'studio', { urls = THREE_WS.hdri } = {}) {
	const pmrem = new PMREMGenerator(renderer);
	pmrem.compileEquirectangularShader();
	const roomTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
	scene.environment = roomTarget.texture;
	scene.environmentIntensity ??= 1;

	const url = preset && urls ? urls[preset] : null;
	if (!url) {
		// The render target stays valid after the generator is disposed, so this
		// frees the scratch without touching the environment map itself.
		pmrem.dispose();
		return scene.environment;
	}
	try {
		let hdr = _envCache.get(url);
		if (!hdr) {
			const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
			hdr = await new HDRLoader().loadAsync(url);
			_envCache.set(url, hdr);
		}
		const envTarget = pmrem.fromEquirectangular(hdr);
		// Another call may have re-pointed the environment while this HDRI was in
		// flight. Losing that race means ours is stale: free it rather than stamp
		// it over the newer one.
		if (scene.environment === roomTarget.texture) scene.environment = envTarget.texture;
		else envTarget.dispose();
		roomTarget.dispose();
		return scene.environment;
	} catch {
		// The room environment installed above stands, so the scene is still lit.
		return scene.environment;
	} finally {
		pmrem.dispose();
	}
}

/**
 * A shadow-catching plane: invisible except where a shadow falls on it, so a
 * model reads as resting on a surface without drawing a floor.
 *
 * @param {import('three').Scene} scene
 * @param {import('three').Object3D} target
 * @param {import('three').Mesh} [existing]  Reuse a previous catcher.
 * @param {number} [opacity]
 */
export function updateGroundContactShadow(scene, target, existing, opacity = 0.35) {
	const b = new Box3().setFromObject(target);
	if (!Number.isFinite(b.min.y)) return existing ?? null;
	const footprint = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1);
	const size = footprint * 6;
	let plane = existing;
	if (!plane) {
		plane = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity }));
		plane.rotation.x = -Math.PI / 2;
		plane.receiveShadow = true;
		scene.add(plane);
	}
	plane.scale.set(size, size, 1);
	plane.position.set((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
	return plane;
}
