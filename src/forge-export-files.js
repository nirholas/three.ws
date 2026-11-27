// File-level rules for every Forge download: what the file is called, what
// content type it carries, and whether the GLB a person downloads opens in a
// tool that has no special decoders.
//
// No three.js here, on purpose: the main Download button runs this on every
// click, and it must not pull a 3D engine onto the page to name a file.
//
// Why the GLB needs a pass at all. Finished models carry derived normal and
// ORM maps as WebP (api/_lib/glb-pbr-derive.js keeps them small for viewing),
// referenced only through EXT_texture_webp. A glTF importer without that
// extension still opens the file but silently drops both maps, so the model
// looks flat in that tool and nobody is told why. The download re-encodes
// those images as PNG, which every glTF 2.0 importer must read, and removes the
// extension. Geometry, materials and every other byte stay as they were.
// Files with compressed geometry (meshopt, Draco, quantized) are left alone:
// Forge never stores an original that way, so such a file is one a caller
// asked for, and the Optimize panel offers those separately with a label
// naming the decoder they need.

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/** Longest base name, in characters, before the extension. */
export const MAX_BASENAME = 60;

/** The content type each download is labeled with. */
export const FORMAT_MIME = Object.freeze({
	glb: 'model/gltf-binary',
	obj: 'model/obj',
	stl: 'model/stl',
	// PLY has no registered media type; octet-stream makes every browser save it.
	ply: 'application/octet-stream',
	usdz: 'model/vnd.usdz+zip',
});

// Windows refuses these as file names whatever the extension.
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function graphemes(s) {
	if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
		return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
	}
	return Array.from(s);
}

/**
 * A download name derived from the prompt: letters and digits in any script,
 * runs of anything else (path separators, dots, punctuation, emoji) collapsed
 * to one hyphen, capped without splitting a character, never empty and never a
 * reserved device name.
 *
 * @param {string} label  usually the prompt
 * @param {string} ext    extension without the dot
 */
export function exportFileName(label, ext) {
	let base = String(label ?? '')
		.normalize('NFC')
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '');
	base = graphemes(base).slice(0, MAX_BASENAME).join('').replace(/-+$/, '');
	if (!base) base = 'forge';
	if (RESERVED_NAME.test(base)) base = `${base}-model`;
	return `${base}.${ext}`;
}

/** The base name of a `download` attribute, without its .glb extension. */
export function exportBaseName(downloadAttr) {
	return String(downloadAttr || '').replace(/\.glb$/i, '') || 'forge';
}

// ---- GLB container ---------------------------------------------------------

function toBytes(input) {
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	throw new TypeError('expected GLB bytes');
}

/** Split a GLB into its JSON and BIN chunks. Throws on anything else. */
export function readGlb(input) {
	const bytes = toBytes(input);
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength < 20 || dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file');
	if (dv.getUint32(4, true) !== 2) throw new Error('not a glTF 2.0 binary');
	const jsonLen = dv.getUint32(12, true);
	if (dv.getUint32(16, true) !== CHUNK_JSON || 20 + jsonLen > bytes.byteLength) throw new Error('GLB has no JSON chunk');
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
	let bin = null;
	const binAt = 20 + jsonLen;
	if (binAt + 8 <= bytes.byteLength && dv.getUint32(binAt + 4, true) === CHUNK_BIN) {
		const binLen = dv.getUint32(binAt, true);
		bin = bytes.subarray(binAt + 8, binAt + 8 + binLen);
	}
	return { json, bin };
}

function writeGlb(json, bin) {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const jsonLen = text.byteLength + ((4 - (text.byteLength % 4)) % 4);
	const binLen = bin ? bin.byteLength + ((4 - (bin.byteLength % 4)) % 4) : 0;
	const total = 12 + 8 + jsonLen + (bin ? 8 + binLen : 0);
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, GLB_MAGIC, true);
	dv.setUint32(4, 2, true);
	dv.setUint32(8, total, true);
	dv.setUint32(12, jsonLen, true);
	dv.setUint32(16, CHUNK_JSON, true);
	out.set(text, 20);
	out.fill(0x20, 20 + text.byteLength, 20 + jsonLen);
	if (bin) {
		const at = 20 + jsonLen;
		dv.setUint32(at, binLen, true);
		dv.setUint32(at + 4, CHUNK_BIN, true);
		out.set(bin, at + 8);
	}
	return out;
}

// Geometry codecs: a plain importer cannot read the vertex data at all.
const GEOMETRY_CODECS = ['EXT_meshopt_compression', 'KHR_draco_mesh_compression', 'KHR_mesh_quantization'];
// Image codecs a canvas can decode, and so re-encode as PNG.
const IMAGE_CODECS = { EXT_texture_webp: 'image/webp', EXT_texture_avif: 'image/avif' };
// KTX2 needs a GPU transcoder; flagged, never rewritten.
const UNTRANSCODABLE_IMAGE_CODECS = ['KHR_texture_basisu'];
const PORTABLE_IMAGE = new Set(['image/png', 'image/jpeg']);

function hasPortableSource(json, texture) {
	if (typeof texture.source !== 'number') return false;
	const img = json.images?.[texture.source];
	return !!img && PORTABLE_IMAGE.has(img.mimeType || (img.uri && /\.jpe?g$/i.test(img.uri) ? 'image/jpeg' : ''));
}

function imageCodecOf(texture) {
	for (const name of Object.keys(IMAGE_CODECS)) {
		if (typeof texture.extensions?.[name]?.source === 'number') return name;
	}
	return null;
}

/**
 * The extensions this file needs before an importer can show all of it:
 * compressed geometry, or a texture that exists only in a non-PNG/JPEG codec.
 */
export function glbDecodersNeeded(input) {
	const { json } = readGlb(input);
	const used = json.extensionsUsed || [];
	const needed = used.filter((e) => GEOMETRY_CODECS.includes(e) || UNTRANSCODABLE_IMAGE_CODECS.includes(e));
	for (const name of Object.keys(IMAGE_CODECS)) {
		if (!used.includes(name)) continue;
		const onlyThere = (json.textures || []).some((t) => t.extensions?.[name] && !hasPortableSource(json, t));
		if (onlyThere) needed.push(name);
	}
	return needed;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Re-encode every texture that exists only as WebP or AVIF into PNG, so the
 * file opens fully in any glTF 2.0 importer.
 *
 * @param {ArrayBuffer|Uint8Array} input  a GLB
 * @param {{ transcode: (bytes: Uint8Array, mimeType: string) => Promise<Uint8Array> }} opts
 *   `transcode` decodes the image and returns PNG bytes (in the page: the
 *   browser's own image codec through a canvas).
 * @returns {Promise<{ bytes: ArrayBuffer|Uint8Array, transcoded: number, reason?: string }>}
 *   `bytes` is the input itself, untouched, whenever nothing needed changing.
 */
export async function makeGlbPortable(input, { transcode }) {
	const { json, bin } = readGlb(input);
	const used = json.extensionsUsed || [];
	if (used.some((e) => GEOMETRY_CODECS.includes(e))) {
		return { bytes: input, transcoded: 0, reason: 'compressed geometry, an encoding the caller chose' };
	}
	const textures = json.textures || [];
	const needy = textures.filter((t) => imageCodecOf(t) && !hasPortableSource(json, t));
	if (needy.length === 0) return { bytes: input, transcoded: 0 };

	// Rewriting the binary chunk is safe only when every byte belongs to a
	// plain bufferView in the one embedded buffer.
	const buffers = json.buffers || [];
	if (!bin || buffers.length !== 1 || buffers[0].uri || (json.bufferViews || []).some((v) => v.extensions || v.buffer !== 0)) {
		return { bytes: input, transcoded: 0, reason: 'textures live outside the embedded buffer' };
	}

	const views = json.bufferViews || [];
	const replacedView = new Map(); // bufferView index -> PNG bytes
	const replacedImage = new Set();
	for (const tex of needy) {
		const codec = imageCodecOf(tex);
		const imgIndex = tex.extensions[codec].source;
		const img = json.images?.[imgIndex];
		if (!img || typeof img.bufferView !== 'number') {
			return { bytes: input, transcoded: 0, reason: 'a texture image is not embedded' };
		}
		if (!replacedImage.has(imgIndex)) {
			const view = views[img.bufferView];
			const src = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
			const png = await transcode(src, img.mimeType || IMAGE_CODECS[codec]);
			if (!(png instanceof Uint8Array) || !PNG_SIGNATURE.every((b, i) => png[i] === b)) {
				throw new Error('image transcoder did not return a PNG');
			}
			replacedView.set(img.bufferView, png);
			replacedImage.add(imgIndex);
			img.mimeType = 'image/png';
		}
		tex.source = imgIndex;
	}

	// No texture may still point a WebP/AVIF extension at an image that is now
	// PNG, and an extension nothing references is dropped from the file.
	for (const tex of textures) {
		const codec = imageCodecOf(tex);
		if (!codec) continue;
		if (replacedImage.has(tex.extensions[codec].source)) {
			delete tex.extensions[codec];
			if (Object.keys(tex.extensions).length === 0) delete tex.extensions;
		}
	}
	for (const codec of Object.keys(IMAGE_CODECS)) {
		if (textures.some((t) => t.extensions?.[codec])) continue;
		for (const key of ['extensionsUsed', 'extensionsRequired']) {
			if (!json[key]) continue;
			json[key] = json[key].filter((e) => e !== codec);
			if (json[key].length === 0) delete json[key];
		}
	}

	// Lay the binary chunk out again, view by view, 4-byte aligned. View and
	// accessor indices are unchanged, so nothing else needs remapping.
	let size = 0;
	const layout = views.map((v, i) => {
		size += (4 - (size % 4)) % 4;
		const len = replacedView.has(i) ? replacedView.get(i).byteLength : v.byteLength;
		const at = size;
		size += len;
		return at;
	});
	const outBin = new Uint8Array(size);
	views.forEach((v, i) => {
		const data = replacedView.get(i) || bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
		outBin.set(data, layout[i]);
		v.byteOffset = layout[i];
		v.byteLength = data.byteLength;
	});
	buffers[0].byteLength = size;
	return { bytes: writeGlb(json, outBin), transcoded: replacedImage.size };
}

const TEXTURE_EXTENSIONS = ['EXT_texture_webp', 'EXT_texture_avif', 'KHR_texture_basisu', 'KHR_texture_transform'];

function dropTextureRefs(node) {
	if (!node || typeof node !== 'object') return;
	for (const key of Object.keys(node)) {
		const v = node[key];
		if (/Texture$/.test(key) && v && typeof v === 'object' && typeof v.index === 'number') delete node[key];
		else if (v && typeof v === 'object') dropTextureRefs(v);
	}
}

/**
 * The same GLB with every texture, image and sampler removed, for geometry-only
 * exports (OBJ, STL, PLY): nothing has to decode a 2K atlas just to throw it
 * away, and a worker, which has no DOM image loader, can parse the file.
 * Image bytes stay in the binary chunk unreferenced, which glTF allows.
 *
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {Uint8Array|ArrayBuffer}  the input itself when it has no textures
 */
export function withoutTextures(input) {
	const { json, bin } = readGlb(input);
	if (!json.textures && !json.images && !json.samplers) return input;
	delete json.textures;
	delete json.images;
	delete json.samplers;
	for (const m of json.materials || []) dropTextureRefs(m);
	for (const key of ['extensionsUsed', 'extensionsRequired']) {
		if (!json[key]) continue;
		json[key] = json[key].filter((e) => !TEXTURE_EXTENSIONS.includes(e));
		if (json[key].length === 0) delete json[key];
	}
	return writeGlb(json, bin);
}

// ---- in the browser --------------------------------------------------------

/** Decode any image the browser can read and re-encode it as PNG, unaltered. */
export async function browserPngTranscode(bytes, mimeType) {
	// No colour management and no premultiplication: these are normal and
	// ORM data maps, where a "corrected" value is a wrong value.
	const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }), {
		premultiplyAlpha: 'none',
		colorSpaceConversion: 'none',
	});
	try {
		let blob;
		if (typeof OffscreenCanvas === 'function') {
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			canvas.getContext('2d').drawImage(bitmap, 0, 0);
			blob = await canvas.convertToBlob({ type: 'image/png' });
		} else {
			const canvas = document.createElement('canvas');
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			canvas.getContext('2d').drawImage(bitmap, 0, 0);
			blob = await new Promise((resolve, reject) =>
				canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas could not encode PNG'))), 'image/png'),
			);
		}
		return new Uint8Array(await blob.arrayBuffer());
	} finally {
		bitmap.close?.();
	}
}

/**
 * The bytes the Download button hands over: the portable form when the file
 * needs one, otherwise the original. Never throws: a failed re-encode still
 * delivers the original file, and says why in the returned `reason`.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ buffer: ArrayBuffer, transcoded: number, reason?: string }>}
 */
export async function prepareGlbDownload(buffer, { transcode = browserPngTranscode } = {}) {
	try {
		const out = await makeGlbPortable(buffer, { transcode });
		const bytes = out.bytes;
		const ab =
			bytes instanceof ArrayBuffer
				? bytes
				: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		return { buffer: ab, transcoded: out.transcoded, reason: out.reason };
	} catch (err) {
		return { buffer, transcoded: 0, reason: `kept the original: ${err?.message || err}` };
	}
}
