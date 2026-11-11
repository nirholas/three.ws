// KTX2 texture decoding for the server.
//
// glTF assets can carry their textures as KTX2 (KHR_texture_basisu). Browsers
// transcode those on the GPU side, but a server that has to turn them into PNG
// or JPEG (the Office-safe GLB pass, api/_lib/office-glb.js) needs the pixels.
// sharp cannot read KTX2, so this decodes it to raw RGBA here:
//
//   * Basis Universal payloads (ETC1S and UASTC, the two KHR_texture_basisu
//     allows) go through the Basis transcoder three.js already ships
//     (examples/jsm/libs/basis, Apache-2.0, built by Binomial). It is an
//     Emscripten module written for Web Workers; it also has a Node branch that
//     expects CommonJS `require` and `__dirname`, which an ESM package does not
//     have, so it is evaluated once with those two supplied.
//   * Uncompressed RGBA8 KTX2 (VK_FORMAT_R8G8B8A8_UNORM / _SRGB, no
//     supercompression) is read straight from level 0 using the fixed header
//     layout in the Khronos KTX 2.0 spec. It is not valid inside
//     KHR_texture_basisu, but authoring tools emit it and it costs nothing.
//
// A Basis payload always declares vkFormat 0 (VK_FORMAT_UNDEFINED), so the
// header alone decides which path a file takes. The transcoder is never handed
// a file it cannot decode.
//
// The output is the image's stored values (sRGB stays sRGB), level 0 only.

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Basis transcoder target format: cTFRGBA32 in basisu_transcoder.h.
const BASIS_FORMAT_RGBA32 = 13;
const VK_FORMAT_R8G8B8A8_UNORM = 37;
const VK_FORMAT_R8G8B8A8_SRGB = 43;
const KTX2_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb];

export class Ktx2DecodeError extends Error {
	constructor(message) {
		super(message);
		this.name = 'Ktx2DecodeError';
	}
}

/** True when the bytes start with the KTX 2.0 file identifier. */
export function isKtx2(bytes) {
	if (!bytes || bytes.byteLength < KTX2_MAGIC.length) return false;
	return KTX2_MAGIC.every((b, i) => bytes[i] === b);
}

function basisDirectory() {
	const candidates = [];
	try {
		const threeMain = createRequire(import.meta.url).resolve('three');
		candidates.push(
			path.join(path.dirname(path.dirname(threeMain)), 'examples/jsm/libs/basis'),
		);
	} catch {
		// three not resolvable from here; the public copy below is the fallback.
	}
	candidates.push(fileURLToPath(new URL('../../public/three/basis', import.meta.url)));
	const hit = candidates.find((dir) => existsSync(path.join(dir, 'basis_transcoder.wasm')));
	if (!hit)
		throw new Ktx2DecodeError(
			'the Basis transcoder is not installed (three/examples/jsm/libs/basis)',
		);
	return hit;
}

let basisPromise = null;

function loadBasis() {
	if (!basisPromise) {
		basisPromise = (async () => {
			const dir = basisDirectory();
			const source = readFileSync(path.join(dir, 'basis_transcoder.js'), 'utf8');
			const mod = { exports: {} };
			const factory = vm.runInThisContext(
				`(function (module, exports, require, __dirname) {${source}\n})`,
				{
					filename: path.join(dir, 'basis_transcoder.js'),
				},
			);
			factory(mod, mod.exports, createRequire(path.join(dir, 'basis_transcoder.js')), dir);
			const BASIS = mod.exports;
			if (typeof BASIS !== 'function')
				throw new Ktx2DecodeError('the Basis transcoder did not load');
			const basis = await BASIS({
				wasmBinary: readFileSync(path.join(dir, 'basis_transcoder.wasm')),
			});
			basis.initializeBasis();
			return basis;
		})().catch((err) => {
			basisPromise = null;
			throw err;
		});
	}
	return basisPromise;
}

// Header offsets from the KTX 2.0 spec, section 3: vkFormat, pixelWidth,
// pixelHeight, supercompressionScheme, then the level index (byteOffset and
// byteLength of level 0, both uint64).
function decodeUncompressed(bytes) {
	if (bytes.byteLength < 104) throw new Ktx2DecodeError('truncated KTX2 header');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const vkFormat = view.getUint32(12, true);
	if (
		view.getUint32(44, true) !== 0 ||
		(vkFormat !== VK_FORMAT_R8G8B8A8_UNORM && vkFormat !== VK_FORMAT_R8G8B8A8_SRGB)
	) {
		throw new Ktx2DecodeError(
			'unsupported KTX2 encoding (only Basis ETC1S, UASTC and uncompressed RGBA8 decode)',
		);
	}
	const width = view.getUint32(20, true);
	const height = Math.max(1, view.getUint32(24, true));
	const offset = Number(view.getBigUint64(80, true));
	const size = width * height * 4;
	if (!width || Number(view.getBigUint64(88, true)) < size || offset + size > bytes.byteLength) {
		throw new Ktx2DecodeError('the KTX2 level 0 data is shorter than its declared size');
	}
	return { data: bytes.slice(offset, offset + size), width, height };
}

/**
 * Decode a KTX2 image to RGBA8.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ data: Uint8Array, width: number, height: number }>}
 */
export async function decodeKtx2(bytes) {
	if (!isKtx2(bytes)) throw new Ktx2DecodeError('not a KTX2 file');
	if (
		bytes.byteLength >= 16 &&
		new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true) !== 0
	) {
		return decodeUncompressed(bytes);
	}
	const basis = await loadBasis();
	const file = new basis.KTX2File(new Uint8Array(bytes));
	try {
		if (file.isValid() && (file.isETC1S() || file.isUASTC())) {
			const width = file.getWidth();
			const height = file.getHeight();
			if (!file.startTranscoding())
				throw new Ktx2DecodeError('the Basis transcoder rejected this KTX2 file');
			const size = file.getImageTranscodedSizeInBytes(0, 0, 0, BASIS_FORMAT_RGBA32);
			const data = new Uint8Array(size);
			if (!file.transcodeImage(data, 0, 0, 0, BASIS_FORMAT_RGBA32, 0, -1, -1)) {
				throw new Ktx2DecodeError('the Basis transcoder could not decode this KTX2 file');
			}
			return { data, width, height };
		}
	} finally {
		file.close();
		file.delete();
	}
	throw new Ktx2DecodeError(
		'unsupported KTX2 encoding (a Basis file that is neither ETC1S nor UASTC)',
	);
}
