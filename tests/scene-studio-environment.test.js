// The Scene Studio viewport applied the "Default" environment through the PMREM
// generator, which only exists once the renderer has been created. The renderer
// is created asynchronously (WebGPURenderer awaits init()), and the stored
// project or the first-run default can request the environment first, so /scene
// threw "Cannot read properties of null (reading 'fromScene')" in production on
// 2026-11-25 and aborted the rest of the load (model import from the query, the
// handoff animation). The environment must defer until a generator exists.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applySceneEnvironment } from '../src/scene-studio/vendor/js/Viewport.Environment.js';

function fakePmrem() {
	const calls = [];
	return {
		calls,
		fromScene(source, sigma) {
			calls.push({ source, sigma });
			return { texture: { isTexture: true, fromPmrem: true } };
		},
	};
}

describe('scene studio applySceneEnvironment', () => {
	it('defers the Default environment instead of throwing when the renderer is not ready', () => {
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x202020);
		const out = applySceneEnvironment(scene, 'Default', undefined, null);
		expect(out).toEqual({ useBackgroundAsEnvironment: true, deferred: true });
		expect(scene.environment).toBeNull();
	});

	it('defers the room environment for a scene with no background when the renderer is not ready', () => {
		const scene = new THREE.Scene();
		const out = applySceneEnvironment(scene, 'Default', undefined, null);
		expect(out.deferred).toBe(true);
		expect(scene.environment).toBeNull();
	});

	it('builds the color environment once the generator exists', () => {
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x202020);
		const pmrem = fakePmrem();
		const out = applySceneEnvironment(scene, 'Default', undefined, pmrem);
		expect(out.deferred).toBe(false);
		expect(pmrem.calls).toHaveLength(1);
		expect(pmrem.calls[0].sigma).toBe(0.04);
		expect(scene.environment.fromPmrem).toBe(true);
	});

	it('builds the room environment for a scene with no background once the generator exists', () => {
		const scene = new THREE.Scene();
		const pmrem = fakePmrem();
		applySceneEnvironment(scene, 'Default', undefined, pmrem);
		expect(pmrem.calls).toHaveLength(1);
		expect(scene.environment.fromPmrem).toBe(true);
	});

	it('uses a texture background directly without needing the generator', () => {
		const scene = new THREE.Scene();
		scene.background = new THREE.Texture();
		scene.backgroundRotation.y = 1.25;
		const out = applySceneEnvironment(scene, 'Default', undefined, null);
		expect(out.deferred).toBe(false);
		expect(scene.environment).toBe(scene.background);
		expect(scene.environment.mapping).toBe(THREE.EquirectangularReflectionMapping);
		expect(scene.environmentRotation.y).toBe(1.25);
	});

	it('applies an equirectangular texture without needing the generator', () => {
		const scene = new THREE.Scene();
		const tex = new THREE.Texture();
		const out = applySceneEnvironment(scene, 'Equirectangular', tex, null);
		expect(out).toEqual({ useBackgroundAsEnvironment: false, deferred: false });
		expect(scene.environment).toBe(tex);
		expect(tex.mapping).toBe(THREE.EquirectangularReflectionMapping);
	});

	it('clears the environment for None', () => {
		const scene = new THREE.Scene();
		scene.environment = new THREE.Texture();
		applySceneEnvironment(scene, 'None', undefined, fakePmrem());
		expect(scene.environment).toBeNull();
	});
});
