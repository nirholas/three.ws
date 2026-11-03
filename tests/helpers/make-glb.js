// Build a real, valid GLB binary in memory for tests: a single mesh whose
// primitive carries `triangles` indexed triangles. Only the JSON chunk and a
// small BIN chunk are written; accessor counts are what the budget measures
// (and what survive meshopt/Draco compression), so this is a faithful stand-in
// for a model of that size without shipping megabytes of fixture.

function pad4(buf, fill) {
	const rem = buf.length % 4;
	return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]);
}

/**
 * @param {{triangles?: number, instances?: number, extraBytes?: number}} [opts]
 *   extraBytes pads the BIN chunk so the file reaches a target size.
 * @returns {ArrayBuffer}
 */
export function makeGlb({ triangles = 12, instances = 1, extraBytes = 0 } = {}) {
	const gltf = {
		asset: { version: '2.0' },
		scene: 0,
		scenes: [{ nodes: Array.from({ length: instances }, (_, i) => i) }],
		nodes: Array.from({ length: instances }, () => ({ mesh: 0 })),
		meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: triangles * 3, type: 'VEC3' },
			{ bufferView: 0, componentType: 5125, count: triangles * 3, type: 'SCALAR' },
		],
		bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
		buffers: [{ byteLength: 4 + extraBytes }],
	};
	const json = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
	const bin = pad4(Buffer.alloc(4 + extraBytes), 0);
	const total = 12 + 8 + json.length + 8 + bin.length;
	const out = Buffer.alloc(total);
	let o = 0;
	out.writeUInt32LE(0x46546c67, o); o += 4;
	out.writeUInt32LE(2, o); o += 4;
	out.writeUInt32LE(total, o); o += 4;
	out.writeUInt32LE(json.length, o); o += 4;
	out.writeUInt32LE(0x4e4f534a, o); o += 4;
	json.copy(out, o); o += json.length;
	out.writeUInt32LE(bin.length, o); o += 4;
	out.writeUInt32LE(0x004e4942, o); o += 4;
	bin.copy(out, o);
	return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
