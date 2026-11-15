// Measured on a Pixel 5 / slow 4G profile against production on 2026-11-15:
// every page that touched three.js (the site-wide walk companion, /play,
// /forge, the coin and home pages once the companion auto-summoned) downloaded
// one 2.4 MB chunk (664 KB gzip). Its source map showed why: the vendor rule
// sent EVERY module under three/examples to a single 'three-addons' group, so
// three's WebGPU and TSL builds (700 KB), chevrotain (148 KB, only for VRML),
// and the FBX, USD, Collada, LDraw and 3DM loaders all landed in the same chunk
// as GLTFLoader, and every lazy import('.../FBXLoader.js') became a facade
// into it. These tests pin the narrower rule: only three's WebGL build is a
// shared vendor chunk; addons and the WebGPU/TSL builds follow the import graph.

import { describe, expect, it } from 'vitest';
import { vendorChunkFor } from '../scripts/vite/vendor-chunks.mjs';

const nm = (p) => `/home/user/three.ws/node_modules/${p}`;

describe('vendorChunkFor', () => {
	it("keeps three's WebGL build in one shared vendor chunk", () => {
		expect(vendorChunkFor(nm('three/build/three.core.js'))).toBe('three-core');
		expect(vendorChunkFor(nm('three/build/three.module.js'))).toBe('three-core');
	});

	it('lets three addons follow the import graph so lazy loaders stay lazy', () => {
		for (const p of [
			'three/examples/jsm/loaders/GLTFLoader.js',
			'three/examples/jsm/loaders/FBXLoader.js',
			'three/examples/jsm/loaders/VRMLLoader.js',
			'three/examples/jsm/libs/chevrotain.module.min.js',
			'three/examples/jsm/loaders/usd/USDComposer.js',
			'three/examples/jsm/exporters/GLTFExporter.js',
			'three/addons/controls/OrbitControls.js',
		]) {
			expect(vendorChunkFor(nm(p)), p).toBeUndefined();
		}
	});

	it("never groups three's WebGPU or TSL builds with the WebGL renderer", () => {
		expect(vendorChunkFor(nm('three/build/three.webgpu.js'))).toBeUndefined();
		expect(vendorChunkFor(nm('three/build/three.tsl.js'))).toBeUndefined();
	});

	it('keeps the other vendor groups', () => {
		expect(vendorChunkFor(nm('buffer/index.js'))).toBe('node-polyfills');
		expect(vendorChunkFor(nm('process/browser.js'))).toBe('node-polyfills');
		expect(vendorChunkFor(nm('ethers/lib.esm/index.js'))).toBe('ethers');
		expect(vendorChunkFor(nm('@solana/web3.js/lib/index.browser.esm.js'))).toBe('solana');
		expect(vendorChunkFor(nm('@coral-xyz/anchor/dist/browser/index.js'))).toBe('solana');
		expect(vendorChunkFor(nm('@mediapipe/tasks-vision/vision_bundle.mjs'))).toBe('mediapipe');
		expect(vendorChunkFor(nm('@dimforge/rapier3d-compat/rapier.mjs'))).toBe('rapier');
	});

	it('leaves application code to the import graph', () => {
		expect(vendorChunkFor('/home/user/three.ws/src/game/coincommunities.js')).toBeUndefined();
	});
});
