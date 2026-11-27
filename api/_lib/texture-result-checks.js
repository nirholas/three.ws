// The gate a texture worker result passes before a user is handed it.
//
// The texture workers (workers/texture: full retexture and the Magic Brush
// region edit; workers/texture-ultratex) promise to change the SURFACE of a
// model and nothing else. This checks that promise against the real bytes of
// the result instead of trusting the worker's "done":
//
//   - the mesh is the one the user had: a region edit keeps topology and UVs
//     exactly; a full retexture may unwrap new UVs but keeps every triangle,
//   - the rig and every animation clip survived (a mesh library round trip
//     silently drops both),
//   - there is a base colour texture, and the new atlas is the size the caller
//     asked for and a power of two,
//   - the new atlas is used as colour data: not tagged linear by a PNG gAMA
//     chunk and not also wired into a linear data slot (normal, metallic-
//     roughness, occlusion), either of which renders it washed out or wrong.
//
// A failed check means the caller keeps the model they had; the failure list
// says why in words a user can act on.

import { createHash } from 'node:crypto';
import { readDocument } from '@three-ws/glb-diff';
import { verifyPreserved, PreserveViolationError } from './preserve-contract.js';

export const MAX_ATLAS = 2048;
const SRGB_GAMMA = 1 / 2.2;
const GAMMA_TOLERANCE = 0.02;

export function isPowerOfTwo(n) {
	return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

function nextPowerOfTwo(n) {
	let p = 1;
	while (p < n) p *= 2;
	return p;
}

/**
 * The atlas size a worker must hand back.
 * Full retexture: exactly the requested size. Region edit: the larger of the
 * requested size and the source atlas (rounded up to a power of two, capped at
 * MAX_ATLAS), so a 1024 edit on a 2048 atlas never throws the rest of the
 * surface's detail away. workers/texture/glb_region.py region_atlas_size mirrors
 * this, keyed on the atlas of the material it repainted.
 */
export function expectedAtlasSize({ mode, requested, sourceSize = 0 }) {
	if (mode !== 'region' || !sourceSize) return requested;
	return Math.max(requested, Math.min(nextPowerOfTwo(sourceSize), MAX_ATLAS));
}

/** gAMA chunk value of a PNG (e.g. 0.45455 for sRGB), or null when absent / not a PNG. */
export function pngGamma(bytes) {
	if (!bytes || bytes.length < 16 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let off = 8;
	while (off + 8 <= bytes.length) {
		const len = dv.getUint32(off);
		const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
		if (type === 'gAMA' && len === 4 && off + 12 <= bytes.length) return dv.getUint32(off + 8) / 100000;
		if (type === 'IDAT' || type === 'IEND') return null;
		off += 12 + len;
	}
	return null;
}

const hashImage = (bytes) => (bytes ? createHash('sha1').update(bytes).digest('hex') : null);

function baseColorTextures(doc) {
	const out = new Set();
	for (const m of doc.getRoot().listMaterials()) {
		const t = m.getBaseColorTexture();
		if (t) out.add(t);
	}
	return [...out];
}

function linearSlotTextures(doc) {
	const out = new Set();
	for (const m of doc.getRoot().listMaterials()) {
		for (const t of [m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getOcclusionTexture()]) {
			if (t) out.add(t);
		}
	}
	return out;
}

const triangles = (doc) =>
	doc
		.getRoot()
		.listMeshes()
		.flatMap((m) => m.listPrimitives())
		.reduce((sum, p) => {
			const count = p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0;
			return sum + Math.floor(count / 3);
		}, 0);

const RIG_WORDS = { skeleton: 'skeleton', skin: 'skin weights', clips: 'animation clips' };

async function preservationFailures(source, result, mode) {
	const kinds = mode === 'region' ? ['topology', 'uv', 'skeleton', 'skin', 'clips'] : ['skeleton', 'skin', 'clips'];
	try {
		await verifyPreserved(source, result, kinds, { label: 'texture result' });
		return [];
	} catch (err) {
		if (!(err instanceof PreserveViolationError)) throw err;
		const hit = new Set(err.violations.map((v) => v.kind));
		const failures = [];
		if (hit.has('topology') || hit.has('uv')) {
			failures.push({
				code: 'mesh_changed',
				message: 'The texture result changed the model shape or its UV map instead of only repainting it.',
			});
		}
		const rig = ['skeleton', 'skin', 'clips'].filter((k) => hit.has(k));
		if (rig.length) {
			failures.push({
				code: 'rig_changed',
				message: `The texture result lost or changed the model's ${rig.map((k) => RIG_WORDS[k]).join(' and ')}.`,
			});
		}
		return failures;
	}
}

/**
 * @param {{ source: Uint8Array, result: Uint8Array, mode: 'region'|'full', textureSize: number }} args
 * @returns {Promise<{ ok: boolean, failures: {code:string,message:string}[], atlas: {width:number,height:number,expected:number}|null }>}
 */
export async function checkTextureResult({ source, result, mode, textureSize }) {
	let srcDoc;
	let outDoc;
	try {
		srcDoc = await readDocument(source);
	} catch (err) {
		throw new Error(`source model is unreadable: ${err.message}`);
	}
	try {
		outDoc = await readDocument(result);
	} catch {
		return {
			ok: false,
			failures: [{ code: 'unreadable', message: 'The texture worker returned a file that is not a readable 3D model.' }],
			atlas: null,
		};
	}

	const failures = await preservationFailures(source, result, mode);
	if (mode !== 'region' && triangles(srcDoc) !== triangles(outDoc) && !failures.some((f) => f.code === 'mesh_changed')) {
		failures.push({
			code: 'mesh_changed',
			message: 'The texture result changed the number of triangles instead of only repainting the model.',
		});
	}

	const outBase = baseColorTextures(outDoc);
	if (!outBase.length) {
		failures.push({ code: 'no_texture', message: 'The texture result has no colour texture.' });
		return { ok: false, failures, atlas: null };
	}

	const srcBase = baseColorTextures(srcDoc);
	const srcHashes = new Set(srcBase.map((t) => hashImage(t.getImage())));
	const sizeOf = (tex) => Math.max(...(tex?.getSize() || [0, 0]));
	const srcMaterials = srcDoc.getRoot().listMaterials();

	// The atlases the worker actually wrote: anything not byte-identical to a
	// source atlas. A region edit leaves every other material's map untouched.
	// A region atlas is sized from the map it repainted (the same material in
	// the source, since materials keep their order), as the worker does.
	const fresh = new Map();
	outDoc
		.getRoot()
		.listMaterials()
		.forEach((m, i) => {
			const tex = m.getBaseColorTexture();
			if (!tex || srcHashes.has(hashImage(tex.getImage())) || fresh.has(tex)) return;
			const sourceSize = sizeOf(srcMaterials[i]?.getBaseColorTexture());
			fresh.set(tex, expectedAtlasSize({ mode, requested: textureSize, sourceSize }));
		});
	const linear = linearSlotTextures(outDoc);
	let atlas = null;
	for (const [tex, expected] of fresh) {
		const size = tex.getSize();
		if (!size) {
			failures.push({ code: 'unreadable', message: 'The new colour texture could not be decoded.' });
			continue;
		}
		const [width, height] = size;
		atlas ??= { width, height, expected };
		if (!isPowerOfTwo(width) || !isPowerOfTwo(height)) {
			failures.push({
				code: 'texture_not_pow2',
				message: `The new texture is ${width}x${height}; it must be a power of two.`,
			});
		} else if (width !== expected || height !== expected) {
			failures.push({
				code: 'texture_size',
				message: `The new texture is ${width}x${height}, not the ${expected}x${expected} that was requested.`,
			});
		}
		const gamma = tex.getMimeType() === 'image/png' ? pngGamma(tex.getImage()) : null;
		if (linear.has(tex) || (gamma != null && Math.abs(gamma - SRGB_GAMMA) > GAMMA_TOLERANCE)) {
			failures.push({
				code: 'color_space',
				message: 'The new colour texture is stored as linear data, so it would render washed out.',
			});
		}
	}

	const unique = [...new Map(failures.map((f) => [f.code, f])).values()];
	return { ok: unique.length === 0, failures: unique, atlas };
}
