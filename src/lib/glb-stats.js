/**
 * Parse stats from a GLB (binary glTF) file using only the structured JSON
 * chunk: no THREE.js, no model-viewer internals, no full scene
 * reconstruction. We download the file with a Range request first to grab
 * the JSON header, falling back to a full fetch if the server doesn't
 * honor ranges.
 *
 * Returns: { sizeBytes, vertices, triangles, materials, animations, nodes,
 *            meshes, primitives, hasMorphTargets, extensionsUsed }
 *
 * GLB layout (spec https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#binary-gltf-layout):
 *   bytes  0..3   magic   "glTF" (0x46546C67 little-endian)
 *   bytes  4..7   version uint32 (== 2)
 *   bytes  8..11  length  uint32: total size of the file
 *   bytes 12..15  chunk0Length uint32
 *   bytes 16..19  chunk0Type   "JSON" (0x4E4F534A)
 *   bytes 20..    JSON payload
 *   ...           subsequent chunks (BIN)
 *
 * For stats we only need the JSON. accessor.count gives vertex/index counts;
 * primitive.indices/.attributes.POSITION resolve to those accessors.
 */

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'

// First range window. A GLB's JSON chunk is usually a few KB (the forge avatar
// measured on 2026-11-15 was 1,324 bytes in a 1.5 MB file); rigged avatars with
// long bone and clip lists run larger and get exactly the missing bytes in one
// follow-up request. The window used to be 256 KB plus a HEAD for the size,
// which raced <model-viewer>'s download of the same file on slow mobile links.
const FIRST_WINDOW = 16 * 1024;

const u32 = (view, offset) => view.getUint32(offset, true);

export async function fetchGlbStats(url, { signal, maxBytes = 4 * 1024 * 1024 } = {}) {
	const first = await fetchRange(url, 0, FIRST_WINDOW - 1, { signal });
	if (!first) throw new Error('Cannot read GLB header');

	let buf = first.body;
	// The GLB header's own length field is authoritative; Content-Range and the
	// full-body length are only cross-checks for a truncated or non-GLB body.
	let sizeBytes = first.total;

	const view = new DataView(buf);
	if (view.byteLength < 20) throw new Error('GLB header truncated');
	if (u32(view, 0) !== MAGIC) throw new Error('Not a GLB');
	if (u32(view, 4) !== 2) throw new Error(`Unsupported GLB version ${u32(view, 4)}`);
	sizeBytes = u32(view, 8) || sizeBytes;

	const chunk0Length = u32(view, 12);
	const chunk0Type = u32(view, 16);
	if (chunk0Type !== JSON_CHUNK_TYPE) throw new Error('First GLB chunk is not JSON');

	const jsonStart = 20;
	const jsonEnd = jsonStart + chunk0Length;
	if (jsonEnd > maxBytes) throw new Error(`GLB JSON chunk too large (${chunk0Length} bytes)`);
	if (jsonEnd > buf.byteLength) {
		// JSON chunk is larger than the first window: fetch only what is missing.
		const rest = await fetchRange(url, buf.byteLength, jsonEnd - 1, { signal });
		if (!rest) throw new Error('Cannot read JSON chunk');
		if (rest.full) {
			buf = rest.body;
		} else {
			const joined = new Uint8Array(buf.byteLength + rest.body.byteLength);
			joined.set(new Uint8Array(buf), 0);
			joined.set(new Uint8Array(rest.body), buf.byteLength);
			buf = joined.buffer;
		}
		if (jsonEnd > buf.byteLength) throw new Error('GLB JSON chunk truncated');
	}

	const jsonBytes = new Uint8Array(buf, jsonStart, chunk0Length);
	const jsonStr = new TextDecoder('utf-8').decode(jsonBytes);
	const gltf = JSON.parse(jsonStr);

	return analyseGltfJson(gltf, { sizeBytes });
}

function analyseGltfJson(gltf, { sizeBytes }) {
	const accessors = gltf.accessors || [];
	const meshes = gltf.meshes || [];
	const materials = gltf.materials || [];
	const animations = gltf.animations || [];
	const nodes = gltf.nodes || [];

	let vertices = 0;
	let triangles = 0;
	let primitives = 0;
	let hasMorphTargets = false;

	for (const mesh of meshes) {
		for (const prim of mesh.primitives || []) {
			primitives += 1;
			const posIdx = prim.attributes?.POSITION;
			if (Number.isInteger(posIdx) && accessors[posIdx]) {
				vertices += accessors[posIdx].count || 0;
			}
			const idxIdx = prim.indices;
			if (Number.isInteger(idxIdx) && accessors[idxIdx]) {
				const count = accessors[idxIdx].count || 0;
				const mode = prim.mode == null ? 4 : prim.mode; // 4 = TRIANGLES (default)
				triangles += primitiveTriangleCount(mode, count);
			} else if (Number.isInteger(posIdx) && accessors[posIdx]) {
				const count = accessors[posIdx].count || 0;
				const mode = prim.mode == null ? 4 : prim.mode;
				triangles += primitiveTriangleCount(mode, count);
			}
			if (prim.targets && prim.targets.length > 0) hasMorphTargets = true;
		}
	}

	return {
		sizeBytes,
		vertices,
		triangles: Math.round(triangles),
		materials: materials.length,
		animations: animations.length,
		animationNames: animations.map((a) => a.name).filter(Boolean),
		nodes: nodes.length,
		meshes: meshes.length,
		primitives,
		hasMorphTargets,
		extensionsUsed: gltf.extensionsUsed || [],
	};
}

function primitiveTriangleCount(mode, indexCount) {
	switch (mode) {
		case 0: return 0;                              // POINTS
		case 1: case 2: case 3: return 0;              // LINES variants
		case 4: return indexCount / 3;                 // TRIANGLES
		case 5: case 6: return Math.max(0, indexCount - 2); // TRIANGLE_STRIP / FAN
		default: return 0;
	}
}

// Returns { body, total, full } or null. `full` is true when the server ignored
// the Range header and sent the whole file with a 200; the body then starts at
// byte 0 whatever range was asked for.
async function fetchRange(url, start, end, { signal } = {}) {
	let res;
	try {
		res = await fetch(url, { signal, headers: { Range: `bytes=${start}-${end}` } });
	} catch {
		return null;
	}
	if (res.status !== 206 && res.status !== 200) return null;
	const body = await res.arrayBuffer();
	const full = res.status === 200;
	const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
	const total = m ? Number(m[1]) : full ? body.byteLength : null;
	return { body, total, full };
}
