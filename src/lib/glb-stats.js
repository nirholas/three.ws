/**
 * Parse stats from a GLB (binary glTF) file using only the structured JSON
 * chunk — no THREE.js, no model-viewer internals, no full scene
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
 *   bytes  8..11  length  uint32 — total size of the file
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

const u32 = (view, offset) => view.getUint32(offset, true);

export async function fetchGlbStats(url, { signal, maxBytes = 4 * 1024 * 1024 } = {}) {
	// Step 1: HEAD for accurate size.
	let sizeBytes = null;
	try {
		const headRes = await fetch(url, { method: 'HEAD', signal });
		const len = headRes.headers.get('content-length');
		if (len) sizeBytes = Number(len);
	} catch {
		// non-fatal — sizeBytes stays null
	}

	// Step 2: Range-fetch the first ~256 KB (enough to contain the GLB header
	// and the JSON chunk for the vast majority of models). If the JSON chunk
	// is bigger than our window we widen below.
	let firstWindow = Math.min(256 * 1024, sizeBytes ?? 256 * 1024);
	let buf = await fetchRange(url, 0, firstWindow - 1, { signal });
	if (!buf) {
		// Server doesn't support ranges — fall back to full fetch with a cap.
		const fullRes = await fetch(url, { signal });
		if (!fullRes.ok) throw new Error(`HTTP ${fullRes.status}`);
		const ab = await fullRes.arrayBuffer();
		buf = ab.slice(0, Math.min(ab.byteLength, maxBytes));
		if (!sizeBytes) sizeBytes = ab.byteLength;
	}

	const view = new DataView(buf);
	if (view.byteLength < 20) throw new Error('GLB header truncated');
	if (u32(view, 0) !== MAGIC) throw new Error('Not a GLB');
	if (u32(view, 4) !== 2) throw new Error(`Unsupported GLB version ${u32(view, 4)}`);
	if (!sizeBytes) sizeBytes = u32(view, 8);

	const chunk0Length = u32(view, 12);
	const chunk0Type = u32(view, 16);
	if (chunk0Type !== JSON_CHUNK_TYPE) throw new Error('First GLB chunk is not JSON');

	let jsonStart = 20;
	let jsonEnd = jsonStart + chunk0Length;
	if (jsonEnd > buf.byteLength) {
		// JSON chunk is larger than first window — widen to cover it.
		const need = Math.min(jsonEnd, maxBytes);
		buf = await fetchRange(url, 0, need - 1, { signal });
		if (!buf) throw new Error('Cannot read JSON chunk');
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

async function fetchRange(url, start, end, { signal } = {}) {
	try {
		const res = await fetch(url, {
			signal,
			headers: { Range: `bytes=${start}-${end}` },
		});
		// 206 = partial content (range honoured). Some CDNs respond 200 with the
		// full file — that's fine, we just use what we asked for in the slice.
		if (res.status !== 206 && res.status !== 200) return null;
		const ab = await res.arrayBuffer();
		return ab;
	} catch {
		return null;
	}
}
