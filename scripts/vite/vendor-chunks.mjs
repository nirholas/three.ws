// Vendor chunk assignment for the production build (vite.config.js ->
// build.rollupOptions.output.manualChunks). Kept in its own module so the
// rules are unit-tested (tests/vite-vendor-chunks.test.js): a too-broad group
// here silently drags megabytes onto every page that touches the library.

/**
 * @param {string} id  absolute module id as the bundler sees it
 * @returns {string | undefined}  chunk name, or undefined to let the import graph decide
 */
export function vendorChunkFor(id) {
	// Node polyfills (buffer/process shims) get their own tiny chunk.
	// Without this, Rollup colocates the `buffer` module inside the
	// 1 MB `solana` chunk, and any chunk that needs the injected
	// Buffer global (e.g. three-addons via its exporters) then
	// imports the whole solana chunk, which transitively chains
	// ethers too. That single colocation put ~1.4 MB of crypto code
	// on the home page's critical path.
	if (
		id.includes('node_modules/buffer/') ||
		id.includes('node_modules/process/') ||
		id.includes('vite-plugin-node-polyfills')
	)
		return 'node-polyfills';
	// three's WebGL build (core + WebGLRenderer) is shared by every 3D surface,
	// so it gets one long-cached vendor chunk. Nothing else under three/ is
	// grouped. This rule used to send every three/examples module to a single
	// 'three-addons' group, and rolldown then built one 2.4 MB chunk (664 KB
	// gzip) holding the WebGPU and TSL builds, chevrotain (VRML only) and the
	// FBX, USD, Collada, LDraw and 3DM loaders next to GLTFLoader: every lazy
	// loader import became a facade into it, and the site-wide walk companion
	// downloaded all of it on every page. Addons and the WebGPU/TSL builds now
	// land wherever the import graph puts them, so a lazy import stays lazy.
	if (/node_modules\/three\/build\/three\.(core|module)(\.min)?\.js$/.test(id)) return 'three-core';
	if (id.includes('node_modules/ethers/')) return 'ethers';
	if (id.includes('node_modules/@solana/') || id.includes('node_modules/@coral-xyz/')) return 'solana';
	if (id.includes('node_modules/@mediapipe/')) return 'mediapipe';
	// Rapier is 2.2 MB of WASM glue and is ALWAYS loaded through a
	// dynamic import (see src/physics/physics-world.js). Left to
	// Rollup's automatic grouping it gets folded into whichever
	// shared chunk happens to also be statically reachable, and on
	// /play it was: it rode a shared world-HUD chunk onto the
	// critical path and cost the world 800 KB gzip before the first
	// frame. Pinning it here means no future static import can drag
	// the physics engine back in front of the world.
	if (id.includes('node_modules/@dimforge/')) return 'rapier';
	return undefined;
}
