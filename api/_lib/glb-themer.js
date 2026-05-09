// Procedural GLB synthesis — "mint to mesh".
//
// Builds a unit-cube glTF 2.0 binary with a single PBR material, an optional
// baseColor texture (typically the token's off-chain image), and a hashed
// baseColorFactor derived from the mint address. The resulting GLB is small
// (typically 1–60 KB) and a fully-conformant glTF 2.0 file — any Three.js,
// Babylon.js, or model-viewer instance renders it directly.
//
// Used by /api/x402/mint-to-mesh to produce a 3D representation of a Solana
// fungible token on demand.

import { Document, NodeIO } from '@gltf-transform/core';

// Cube centered at origin with side 1. 24 verts (6 faces × 4 corners) so each
// face has its own face normal and UV island. 36 indices (6 × 2 triangles).
//
// UV layout: each face occupies the full [0,1]² square, so a single 2D image
// shows on every face. Wound CCW when viewed from outside.
const CUBE = {
	positions: new Float32Array([
		// +X
		0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
		// -X
		-0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5,
		// +Y
		-0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
		// -Y
		-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5,
		// +Z
		-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
		// -Z
		0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
	]),
	normals: new Float32Array([
		1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
		-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
		0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
		0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
		0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
		0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
	]),
	uvs: new Float32Array([
		0, 1, 1, 1, 1, 0, 0, 0,
		0, 1, 1, 1, 1, 0, 0, 0,
		0, 1, 1, 1, 1, 0, 0, 0,
		0, 1, 1, 1, 1, 0, 0, 0,
		0, 1, 1, 1, 1, 0, 0, 0,
		0, 1, 1, 1, 1, 0, 0, 0,
	]),
	indices: new Uint16Array([
		0, 1, 2, 0, 2, 3,
		4, 5, 6, 4, 6, 7,
		8, 9, 10, 8, 10, 11,
		12, 13, 14, 12, 14, 15,
		16, 17, 18, 16, 18, 19,
		20, 21, 22, 20, 22, 23,
	]),
};

// Stable color-from-string. Returns [r, g, b] in [0,1] — saturated, mid-light.
// Built so visually-similar mints (shared prefix, same script) still get
// distinct hues; tiny edits to the input change the hash a lot.
export function colorFromMint(mint) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < mint.length; i++) {
		h ^= mint.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const hue = (h >>> 0) % 360;
	return hslToRgb(hue / 360, 0.7, 0.55);
}

function hslToRgb(h, s, l) {
	if (s === 0) return [l, l, l];
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function hueToRgb(p, q, t) {
	if (t < 0) t += 1;
	if (t > 1) t -= 1;
	if (t < 1 / 6) return p + (q - p) * 6 * t;
	if (t < 1 / 2) return q;
	if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
	return p;
}

/**
 * Build a binary glTF 2.0 (GLB) cube themed for a Solana token.
 *
 * @param {object} opts
 * @param {string} opts.mint        Solana mint address (used as fallback name + color seed)
 * @param {string|null} [opts.name] Token name from on-chain Metaplex metadata
 * @param {string|null} [opts.symbol] Token symbol from on-chain Metaplex metadata
 * @param {Uint8Array|null} [opts.image] Image bytes (PNG/JPEG). When omitted, the cube is color-only.
 * @param {string|null}     [opts.imageMimeType] Image MIME type (image/png or image/jpeg). Required iff `image` is set.
 * @param {[number,number,number]} [opts.color] RGB in [0,1]. Defaults to colorFromMint(mint).
 * @param {object} [opts.extras] Additional asset.extras key/values to include.
 * @returns {Promise<Uint8Array>} GLB bytes.
 */
export async function createThemedGLB({
	mint,
	name = null,
	symbol = null,
	image = null,
	imageMimeType = null,
	color = null,
	extras = {},
}) {
	if (!mint) throw new Error('createThemedGLB: mint is required');
	const rgb = color || colorFromMint(mint);
	const safeName = (name || symbol || mint.slice(0, 8)).toString().trim().slice(0, 64);
	const safeSymbol = (symbol || mint.slice(0, 6)).toString().trim().slice(0, 16);

	const doc = new Document();
	doc.createBuffer();

	doc.getRoot().getAsset().generator = 'three.ws mint-to-mesh / @gltf-transform';
	doc.getRoot().getAsset().extras = {
		mint,
		name: safeName,
		symbol: safeSymbol,
		generatedAt: new Date().toISOString(),
		generator: 'https://three.ws/api/x402/mint-to-mesh',
		...extras,
	};

	const positions = doc
		.createAccessor('cube_positions')
		.setType('VEC3')
		.setArray(CUBE.positions);
	const normals = doc.createAccessor('cube_normals').setType('VEC3').setArray(CUBE.normals);
	const uvs = doc.createAccessor('cube_uvs').setType('VEC2').setArray(CUBE.uvs);
	const indices = doc.createAccessor('cube_indices').setType('SCALAR').setArray(CUBE.indices);

	const material = doc
		.createMaterial(safeSymbol)
		.setBaseColorFactor([rgb[0], rgb[1], rgb[2], 1])
		.setMetallicFactor(0.05)
		.setRoughnessFactor(0.6)
		.setDoubleSided(false);

	if (image && imageMimeType) {
		const tex = doc.createTexture(safeSymbol).setImage(image).setMimeType(imageMimeType);
		material.setBaseColorTexture(tex);
	}

	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', positions)
		.setAttribute('NORMAL', normals)
		.setAttribute('TEXCOORD_0', uvs)
		.setIndices(indices)
		.setMaterial(material);

	const mesh = doc.createMesh(safeSymbol).addPrimitive(prim);
	const node = doc.createNode(safeSymbol).setMesh(mesh);
	const scene = doc.createScene(safeName).addChild(node);
	doc.getRoot().setDefaultScene(scene);

	const io = new NodeIO();
	return io.writeBinary(doc);
}
