// Real-world occlusion helper (src/ar/depth-occlusion.js).
//
// The helper sits on top of three's built-in depth-sensing path: three pulls the
// per-frame depth texture and renders the fullscreen occluder quad itself, so the
// helper's whole job is to (1) gate on the feature being negotiated, (2) configure
// three's occluder material to write depth but no colour (or it paints garbage
// over the camera passthrough), and (3) free that mesh on exit — three's own
// session-end reset() never disposes it. It deliberately never adds the mesh to a
// scene (three already draws it). These tests pin exactly that contract with a
// fake renderer; the live occlusion itself only happens on AR hardware.

import { describe, expect, it, vi } from 'vitest';

import { DepthOcclusion } from '../packages/ar-studio/src/studio/depth-occlusion.js';

// A minimal stand-in for three's cached depth-sensing occluder mesh: a material
// with the renderer defaults (colour ON, depth test ON) plus disposable resources.
function fakeOccluderMesh() {
	return {
		frustumCulled: true,
		geometry: { dispose: vi.fn() },
		material: { colorWrite: true, depthWrite: true, depthTest: true, dispose: vi.fn() },
	};
}

// A fake WebGLRenderer.xr exposing only the depth surface the helper reads.
function fakeRenderer({ hasDepth = false, mesh = null } = {}) {
	return {
		xr: {
			hasDepthSensing: () => hasDepth,
			getDepthSensingMesh: () => mesh,
		},
	};
}

describe('DepthOcclusion.sessionHasDepth', () => {
	it('is true only when the session negotiated depth-sensing', () => {
		expect(DepthOcclusion.sessionHasDepth({ enabledFeatures: ['hit-test', 'depth-sensing'] })).toBe(true);
		expect(DepthOcclusion.sessionHasDepth({ enabledFeatures: ['hit-test', 'anchors'] })).toBe(false);
	});

	it('guards UAs that omit enabledFeatures and a missing session', () => {
		expect(DepthOcclusion.sessionHasDepth({})).toBe(false);
		expect(DepthOcclusion.sessionHasDepth(null)).toBe(false);
		expect(DepthOcclusion.sessionHasDepth(undefined)).toBe(false);
	});
});

describe('DepthOcclusion.update', () => {
	it('is a no-op when the renderer reports no depth (cpu-optimized / unsupported)', () => {
		const occ = new DepthOcclusion(fakeRenderer({ hasDepth: false }));
		occ.update();
		expect(occ.enabled).toBe(false);
	});

	it('is a no-op when the renderer lacks the depth API entirely (older three)', () => {
		const occ = new DepthOcclusion({ xr: {} });
		expect(() => occ.update()).not.toThrow();
		expect(occ.enabled).toBe(false);
	});

	it('configures three occluder material for depth-only output', () => {
		const mesh = fakeOccluderMesh();
		const occ = new DepthOcclusion(fakeRenderer({ hasDepth: true, mesh }));

		occ.update();

		// Depth written, colour suppressed (the passthrough must stay untouched).
		expect(mesh.material.colorWrite).toBe(false);
		expect(mesh.material.depthWrite).toBe(true);
		expect(mesh.material.depthTest).toBe(false);
		expect(mesh.frustumCulled).toBe(false);
		expect(occ.enabled).toBe(true);
	});

	it('configures the mesh exactly once, then is a cheap no-op each later frame', () => {
		const mesh = fakeOccluderMesh();
		const getMesh = vi.fn(() => mesh);
		const renderer = { xr: { hasDepthSensing: () => true, getDepthSensingMesh: getMesh } };
		const occ = new DepthOcclusion(renderer);

		occ.update();
		occ.update();
		occ.update();

		expect(getMesh).toHaveBeenCalledTimes(1);
	});
});

describe('DepthOcclusion.dispose', () => {
	it('frees the occluder geometry + material that three never disposes', () => {
		const mesh = fakeOccluderMesh();
		const occ = new DepthOcclusion(fakeRenderer({ hasDepth: true, mesh }));
		occ.update();

		occ.dispose();

		expect(mesh.geometry.dispose).toHaveBeenCalledTimes(1);
		expect(mesh.material.dispose).toHaveBeenCalledTimes(1);
		expect(occ.enabled).toBe(false);
	});

	it('is safe when the occluder was never configured (non-depth device)', () => {
		const occ = new DepthOcclusion(fakeRenderer({ hasDepth: false }));
		expect(() => occ.dispose()).not.toThrow();
		expect(occ.enabled).toBe(false);
	});
});
