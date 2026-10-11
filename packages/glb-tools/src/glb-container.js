// Minimal GLB 2.0 binary container reader/writer.
//
// gltf-transform's public Document API has no way to attach an unregistered
// extension (MSFT_lod is archived, not one of the extensions gltf-transform
// ships a class for), so buildLodChain() in lod.js writes its GLB with
// gltf-transform and then uses these two functions to patch the JSON chunk
// directly. Spec: https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/README.md#binary-gltf-layout

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_TYPE_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_TYPE_BIN = 0x004e4942; // 'BIN\0'
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/**
 * @param {Uint8Array} glb
 * @returns {{ json: object, binChunk: Uint8Array | null }}
 */
export function readGlbChunks(glb) {
	const buf = glb instanceof Uint8Array ? glb : new Uint8Array(glb);
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	if (buf.byteLength < HEADER_BYTES || view.getUint32(0, true) !== GLB_MAGIC) {
		throw new Error('readGlbChunks: not a GLB container (bad magic)');
	}
	const totalLength = view.getUint32(8, true);
	if (totalLength > buf.byteLength) {
		throw new Error('readGlbChunks: declared length exceeds buffer size');
	}

	let offset = HEADER_BYTES;
	let json = null;
	let binChunk = null;
	while (offset + CHUNK_HEADER_BYTES <= totalLength) {
		const chunkLength = view.getUint32(offset, true);
		const chunkType = view.getUint32(offset + 4, true);
		const chunkStart = offset + CHUNK_HEADER_BYTES;
		const chunkEnd = chunkStart + chunkLength;
		if (chunkEnd > totalLength) throw new Error('readGlbChunks: chunk overruns container');
		const chunkData = buf.subarray(chunkStart, chunkEnd);
		if (chunkType === CHUNK_TYPE_JSON) {
			json = JSON.parse(new TextDecoder('utf-8').decode(chunkData));
		} else if (chunkType === CHUNK_TYPE_BIN) {
			binChunk = chunkData;
		}
		offset = chunkEnd;
	}
	if (!json) throw new Error('readGlbChunks: no JSON chunk found');
	return { json, binChunk };
}

function pad4(buf, fillByte) {
	const remainder = buf.byteLength % 4;
	if (remainder === 0) return buf;
	const padded = new Uint8Array(buf.byteLength + (4 - remainder));
	padded.set(buf);
	padded.fill(fillByte, buf.byteLength);
	return padded;
}

/**
 * @param {{ json: object, binChunk?: Uint8Array | null }} parts
 * @returns {Uint8Array}
 */
export function writeGlb({ json, binChunk = null }) {
	const jsonBytes = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20); // space-pad JSON
	const binBytes = binChunk ? pad4(binChunk, 0x00) : null; // zero-pad BIN

	const totalLength =
		HEADER_BYTES + CHUNK_HEADER_BYTES + jsonBytes.byteLength + (binBytes ? CHUNK_HEADER_BYTES + binBytes.byteLength : 0);

	const out = new Uint8Array(totalLength);
	const view = new DataView(out.buffer);
	view.setUint32(0, GLB_MAGIC, true);
	view.setUint32(4, 2, true); // version
	view.setUint32(8, totalLength, true);

	let offset = HEADER_BYTES;
	view.setUint32(offset, jsonBytes.byteLength, true);
	view.setUint32(offset + 4, CHUNK_TYPE_JSON, true);
	out.set(jsonBytes, offset + CHUNK_HEADER_BYTES);
	offset += CHUNK_HEADER_BYTES + jsonBytes.byteLength;

	if (binBytes) {
		view.setUint32(offset, binBytes.byteLength, true);
		view.setUint32(offset + 4, CHUNK_TYPE_BIN, true);
		out.set(binBytes, offset + CHUNK_HEADER_BYTES);
	}

	return out;
}
