// Size-first GLB optimizer behind Forge's "Optimize" (triangle mode).
//
// The remesh worker's triangle path rebuilt the mesh in open3d, which keeps
// positions and faces only: the UVs, the material, the texture and any skin were
// thrown away, so a heavy model came back grey and a rigged one lost its
// skeleton. This module does the same job on the glTF document instead, so
// everything the geometry does not own is carried through untouched:
//
//   1. repair + decimate every triangle primitive with src/mesh-ops (the same
//      meshoptimizer pass the in-browser tools run). It welds only identical
//      vertices, keeps UV seams locked, and carries JOINTS/WEIGHTS, colours and
//      morph deltas on every surviving vertex. Skins, nodes, animations and
//      materials are never touched.
//   2. cap texture resolution and re-encode with codecs every glTF reader has:
//      JPEG for colour data whose alpha is never read, PNG for normal maps and
//      anything that needs alpha. That universal file needs no extension.
//   3. optionally, a web variant (meshopt or Draco geometry, WebP textures)
//      built by glb-compress.js, labelled with the extensions a reader needs.
//
// Size contract: the result is never larger than the source. If the pipeline
// cannot save at least MIN_SAVING of the bytes, the caller gets `noop: true`
// and the original is the answer.

import { Buffer } from 'node:buffer';
import { applyMeshOp, countTriangles } from '../../src/mesh-ops/gltf.js';
import { compressGlb, COMPRESSION_MODES } from './glb-compress.js';

export const OPTIMIZE_LIMITS = Object.freeze({
	// The API process holds the whole document in memory, so its cap sits below
	// the worker's 128 MB fetch cap. Forge output is 1 to 3 MB.
	maxBytes: 64 * 1024 * 1024,
	maxTriangles: 3_000_000,
	minTargetFaces: 1_000,
	maxTargetFaces: 500_000,
});

export const COMPRESSIONS = Object.freeze(['none', ...COMPRESSION_MODES]);

// Less than this fraction saved is not worth a second file: report "already
// light" and keep the original.
export const MIN_SAVING = 0.05;

const JPEG_QUALITY = 90;
const WEBP_QUALITY = 88;
const GLB_MAGIC = 0x46546c67;
const DRACO = 'KHR_draco_mesh_compression';
const GEOMETRY_COMPRESSION = new Set([DRACO, 'EXT_meshopt_compression', 'KHR_mesh_quantization']);
const SHARP_DECODABLE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'image/tiff']);

// Slots whose alpha channel no renderer reads. A texture used only through
// these can be stored as JPEG with no visible change.
const ALPHA_FREE_SLOTS = new Set(['emissiveTexture', 'occlusionTexture', 'metallicRoughnessTexture']);

export class OptimizeError extends Error {
	constructor(message, code, status = 422) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

export function isGlb(bytes) {
	if (!bytes || bytes.byteLength < 20) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return view.getUint32(0, true) === GLB_MAGIC;
}

function readGlbJson(bytes) {
	if (!isGlb(bytes)) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const jsonLength = view.getUint32(12, true);
	try {
		return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
	} catch {
		return null;
	}
}

/**
 * What a GLB declares, read from its JSON chunk alone (no binary decode, so it
 * is cheap enough to run before handing a job to the worker). Null for a file
 * that is not a readable GLB.
 *
 * @returns {{ triangles: number, skins: number, joints: number, morphTargets: number, extensionsRequired: string[] } | null}
 */
export function glbHeaderSummary(bytes) {
	const json = readGlbJson(bytes);
	if (!json) return null;
	const accessors = json.accessors || [];
	let triangles = 0;
	let morphTargets = 0;
	for (const mesh of json.meshes || []) {
		for (const prim of mesh.primitives || []) {
			morphTargets = Math.max(morphTargets, (prim.targets || []).length);
			const mode = prim.mode ?? 4;
			if (mode !== 4) continue;
			const count = prim.indices !== undefined ? accessors[prim.indices]?.count : accessors[prim.attributes?.POSITION]?.count;
			triangles += Math.floor((count || 0) / 3);
		}
	}
	const skins = json.skins || [];
	return {
		triangles,
		skins: skins.length,
		joints: skins.reduce((n, s) => n + (s.joints || []).length, 0),
		morphTargets,
		extensionsRequired: json.extensionsRequired || [],
	};
}

let _io = null;
async function getIO() {
	if (_io) return _io;
	const { NodeIO, Logger } = await import('@gltf-transform/core');
	const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
	const { MeshoptDecoder, MeshoptSimplifier } = await import('meshoptimizer');
	await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
	const d = await import('draco3dgltf');
	const draco3d = d.default ?? d;
	_io = {
		logger: new Logger(Logger.Verbosity.WARN),
		io: new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
			'meshopt.decoder': MeshoptDecoder,
			'draco3d.decoder': await draco3d.createDecoderModule(),
		}),
		simplifier: MeshoptSimplifier,
	};
	return _io;
}

async function loadSharp() {
	const mod = await import('sharp');
	return mod.default ?? mod;
}

async function textureSummary(doc, sharp) {
	const out = [];
	for (const texture of doc.getRoot().listTextures()) {
		const image = texture.getImage();
		const mimeType = texture.getMimeType();
		let width = null;
		let height = null;
		if (image?.byteLength && SHARP_DECODABLE.has(mimeType)) {
			try {
				const meta = await sharp(Buffer.from(image.buffer, image.byteOffset, image.byteLength)).metadata();
				width = meta.width ?? null;
				height = meta.height ?? null;
			} catch {
				// An image sharp cannot read keeps unknown dimensions in the summary.
			}
		}
		out.push({ mimeType, width, height, bytes: image?.byteLength || 0 });
	}
	return out;
}

/** Measured facts about a document, for the before/after numbers. */
export async function summarizeDocument(doc, byteLength, sharp) {
	const root = doc.getRoot();
	let vertices = 0;
	let morphTargets = 0;
	for (const mesh of root.listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			vertices += prim.getAttribute('POSITION')?.getCount() || 0;
			morphTargets = Math.max(morphTargets, prim.listTargets().length);
		}
	}
	const skins = root.listSkins();
	return {
		bytes: byteLength,
		triangles: countTriangles(doc),
		vertices,
		materials: root.listMaterials().length,
		textures: await textureSummary(doc, sharp ?? (await loadSharp())),
		skins: skins.length,
		joints: skins.reduce((n, s) => n + s.listJoints().length, 0),
		morphTargets,
		animations: root.listAnimations().length,
	};
}

/**
 * Clamp a requested face target into the range the tool supports, saying so
 * when the request was changed. The note is shown to the user verbatim.
 */
export function clampTarget(raw, fallback = 50_000) {
	const { minTargetFaces: min, maxTargetFaces: max } = OPTIMIZE_LIMITS;
	const n = Number(raw);
	if (raw === undefined || raw === null || raw === '') return { target: fallback, note: null };
	if (!Number.isFinite(n) || n <= 0) {
		return { target: fallback, note: `The face target was not a positive number, so ${fallback.toLocaleString('en-US')} was used.` };
	}
	const rounded = Math.round(n);
	if (rounded < min) return { target: min, note: `The face target was raised to the minimum of ${min.toLocaleString('en-US')}.` };
	if (rounded > max) return { target: max, note: `The face target was lowered to the maximum of ${max.toLocaleString('en-US')}.` };
	return { target: rounded, note: null };
}

function textureUse(texture, doc, listTextureSlots) {
	const slots = new Set(listTextureSlots(texture));
	const materials = texture.listParents().filter((p) => p.propertyType === 'Material');
	const baseColorNeedsAlpha =
		slots.has('baseColorTexture') && materials.some((m) => m.getBaseColorTexture() === texture && m.getAlphaMode() !== 'OPAQUE');
	let alphaIsRead = baseColorNeedsAlpha;
	for (const slot of slots) {
		if (slot !== 'baseColorTexture' && slot !== 'normalTexture' && !ALPHA_FREE_SLOTS.has(slot)) alphaIsRead = true;
	}
	return { normal: slots.has('normalTexture'), alphaIsRead };
}

/**
 * Cap each texture at `maxSize` (long edge, never enlarged) and re-encode it as
 * JPEG or PNG, keeping the original bytes whenever re-encoding would not make it
 * smaller at the same size. Textures sharp cannot decode (KTX2) are left as they
 * are and reported, since they keep the file from being extension-free.
 */
async function encodeUniversalTextures(doc, maxSize, sharp, notes) {
	const { listTextureSlots } = await import('@gltf-transform/functions');
	let changed = 0;
	for (const texture of doc.getRoot().listTextures()) {
		const src = texture.getImage();
		const mime = texture.getMimeType();
		if (!src?.byteLength) continue;
		if (!SHARP_DECODABLE.has(mime)) {
			notes.push(`A ${mime || 'non-image'} texture was kept as it is; readers need support for it.`);
			continue;
		}
		try {
			const input = Buffer.from(src.buffer, src.byteOffset, src.byteLength);
			const meta = await sharp(input).metadata();
			const longEdge = Math.max(meta.width || 0, meta.height || 0);
			const resize = longEdge > maxSize;
			let pipeline = sharp(input);
			if (resize) pipeline = pipeline.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true });
			const use = textureUse(texture, doc, listTextureSlots);
			const asJpeg = !use.normal && (!meta.hasAlpha || !use.alphaIsRead);
			const encoded = asJpeg
				? await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
				: await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
			const nextMime = asJpeg ? 'image/jpeg' : 'image/png';
			const mustChange = resize || !(mime === 'image/png' || mime === 'image/jpeg');
			if (!mustChange && encoded.byteLength >= src.byteLength) continue;
			texture.setImage(new Uint8Array(encoded)).setMimeType(nextMime);
			const uri = texture.getURI();
			if (uri) texture.setURI(uri.replace(/\.[A-Za-z0-9]+$/, asJpeg ? '.jpg' : '.png'));
			changed++;
		} catch (err) {
			notes.push('One texture could not be re-encoded and was kept as it was.');
			console.warn('[glb-optimize] texture kept:', err?.message);
		}
	}
	// No texture is WebP any more, so the file must not declare the extension.
	if (!doc.getRoot().listTextures().some((t) => t.getMimeType() === 'image/webp')) {
		for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_texture_webp') ext.dispose();
	}
	return changed;
}

function stripGeometryCompression(doc) {
	for (const ext of doc.getRoot().listExtensionsUsed()) {
		if (GEOMETRY_COMPRESSION.has(ext.extensionName)) ext.dispose();
	}
}

function requiredExtensions(doc) {
	return doc
		.getRoot()
		.listExtensionsUsed()
		.filter((e) => e.isRequired())
		.map((e) => e.extensionName);
}

/**
 * Optimize GLB bytes for size while keeping their look.
 *
 * @param {Uint8Array} bytes  source GLB
 * @param {{ targetFaces: number, operation?: 'full'|'simplify', textureSize?: number, compression?: 'none'|'meshopt'|'draco' }} opts
 * @returns {Promise<{
 *   noop: boolean, reason: string|null, notes: string[],
 *   before: object, after: object|null,
 *   universal: Uint8Array|null, compressed: Uint8Array|null,
 *   compression: string, requires: string[], geometryReduced: boolean,
 * }>}
 */
export async function optimizeGlb(bytes, opts) {
	const { targetFaces, operation = 'full', textureSize = 1024, compression = 'none' } = opts;
	const notes = [];
	if (!isGlb(bytes)) throw new OptimizeError('The model is not a binary glTF (GLB) file.', 'not_glb', 400);
	if (bytes.byteLength > OPTIMIZE_LIMITS.maxBytes) {
		throw new OptimizeError(
			`This model is ${(bytes.byteLength / 1048576).toFixed(1)} MB. Optimize accepts models up to ${OPTIMIZE_LIMITS.maxBytes / 1048576} MB.`,
			'mesh_too_large',
			413,
		);
	}
	const header = glbHeaderSummary(bytes);
	if (header && header.triangles > OPTIMIZE_LIMITS.maxTriangles) {
		throw new OptimizeError(
			`This model has ${header.triangles.toLocaleString('en-US')} triangles. Optimize accepts up to ${OPTIMIZE_LIMITS.maxTriangles.toLocaleString('en-US')}.`,
			'mesh_too_large',
			413,
		);
	}

	const [{ io, simplifier, logger }, sharp] = await Promise.all([getIO(), loadSharp()]);
	const { dequantize, prune } = await import('@gltf-transform/functions');
	const doc = await io.readBinary(bytes);
	doc.setLogger(logger);
	const before = await summarizeDocument(doc, bytes.byteLength, sharp);
	await doc.transform(dequantize());
	stripGeometryCompression(doc);

	let geometryReduced = false;
	if (before.triangles > targetFaces) {
		if (operation === 'full') applyMeshOp(doc, 'repair', {}, { simplifier });
		applyMeshOp(doc, 'decimate', { targetTriangles: targetFaces }, { simplifier });
		geometryReduced = countTriangles(doc) < before.triangles;
	} else {
		notes.push(
			`The model already has ${before.triangles.toLocaleString('en-US')} triangles, at or under the ${targetFaces.toLocaleString('en-US')} target, so its geometry was kept.`,
		);
	}
	await doc.transform(prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }));
	const geometryOnly = await io.writeBinary(doc);

	await encodeUniversalTextures(doc, textureSize, sharp, notes);
	const universal = await io.writeBinary(doc);
	const after = await summarizeDocument(doc, universal.byteLength, sharp);

	if (universal.byteLength > bytes.byteLength * (1 - MIN_SAVING)) {
		return {
			noop: true,
			reason: `This model is already light (${before.triangles.toLocaleString('en-US')} triangles, ${formatBytes(bytes.byteLength)}). Optimizing would not make it meaningfully smaller, so the original is kept.`,
			notes,
			before,
			after: null,
			universal: null,
			compressed: null,
			compression: 'none',
			requires: [],
			geometryReduced: false,
		};
	}

	let compressed = null;
	let usedCompression = 'none';
	let requires = requiredExtensions(doc);
	if (compression !== 'none') {
		try {
			const result = await compressGlb(geometryOnly, { mode: compression, textures: { maxSize: textureSize, quality: WEBP_QUALITY } });
			if (result.outputBytes < universal.byteLength) {
				compressed = new Uint8Array(result.buffer);
				usedCompression = compression;
				const variant = await io.readBinary(compressed);
				requires = requiredExtensions(variant);
			} else {
				notes.push(`${compression === 'draco' ? 'Draco' : 'Meshopt'} compression did not beat the universal file, so only that file is offered.`);
			}
		} catch (err) {
			notes.push('Compression failed, so only the universal file is offered.');
			console.warn('[glb-optimize] compression failed:', err?.message);
		}
	}

	return {
		noop: false,
		reason: null,
		notes,
		before,
		after,
		universal,
		compressed,
		compression: usedCompression,
		requires,
		geometryReduced,
	};
}

export function formatBytes(n) {
	if (n >= 1048576) return `${(n / 1048576).toFixed(2)} MB`;
	if (n >= 1024) return `${Math.round(n / 1024)} KB`;
	return `${n} B`;
}
