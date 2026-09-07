// Decode compressed glTF before Blender ever sees it.
//
// Blender's bundled glTF importer has NO decoder for EXT_meshopt_compression,
// which is what gltfpack emits and what most three.ws avatars ship as. Handed
// one, it reads the empty fallback buffer the format declares and produces a
// silently empty or broken scene. Draco is nominally supported but only when
// the build ships libextern_draco, which several Linux distribution packages do
// not, and there the import fails outright.
//
// So the compressed asset is transcoded to plain glTF here, in process, with
// the same libraries the rest of the repo already depends on. No external
// binary: a caller who installs this package gets working meshopt support with
// nothing else to set up.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MESHOPT = 'EXT_meshopt_compression';
const DRACO = 'KHR_draco_mesh_compression';

/**
 * The glTF JSON of a .glb/.gltf payload, or null when it is neither.
 * A GLB is a 12-byte header followed by a length-prefixed JSON chunk.
 */
function gltfDocument(buffer, extension) {
	if (extension === '.gltf') {
		try {
			return JSON.parse(buffer.toString('utf8'));
		} catch {
			return null;
		}
	}
	if (extension !== '.glb' || buffer.length < 20 || buffer.subarray(0, 4).toString('ascii') !== 'glTF') return null;
	if (buffer.subarray(16, 20).toString('ascii') !== 'JSON') return null;
	const chunkLength = buffer.readUInt32LE(12);
	try {
		return JSON.parse(buffer.subarray(20, 20 + chunkLength).toString('utf8'));
	} catch {
		return null;
	}
}

/**
 * Compression extensions this asset declares, in either list.
 *
 * An asset that only *uses* an extension still needs it decoded: the geometry
 * lives in the compressed buffer views either way, and the uncompressed
 * fallback buffer a conformant file declares is empty until something writes
 * into it.
 */
export function compressionOf(buffer, extension) {
	const document = gltfDocument(buffer, extension);
	if (!document) return [];
	const declared = new Set([...(document.extensionsRequired || []), ...(document.extensionsUsed || [])]);
	return [MESHOPT, DRACO].filter((name) => declared.has(name));
}

/**
 * Rewrite a compressed asset as plain glTF, or return the input untouched.
 *
 * @param {string} inputPath  The caller's file.
 * @param {string} scratchDir Directory for the decoded copy, owned by the caller.
 * @returns {Promise<{path: string, decoded: string[]}>} The path Blender should
 *   open, and which extensions were decoded out of it (empty when none were).
 */
export async function decodeForBlender(inputPath, scratchDir) {
	const extension = path.extname(inputPath).toLowerCase();
	if (extension !== '.glb' && extension !== '.gltf') return { path: inputPath, decoded: [] };

	const buffer = await readFile(inputPath);
	const compression = compressionOf(buffer, extension);
	if (compression.length === 0) return { path: inputPath, decoded: [] };

	// Imported lazily so a caller who never touches a compressed asset does not
	// pay to load three glTF libraries and a WASM decoder on every job.
	const [{ NodeIO }, extensions, meshopt, draco] = await Promise.all([
		import('@gltf-transform/core'),
		import('@gltf-transform/extensions'),
		import('meshoptimizer'),
		import('draco3dgltf'),
	]);

	const io = new NodeIO().registerExtensions(extensions.ALL_EXTENSIONS).registerDependencies({
		'meshopt.decoder': meshopt.MeshoptDecoder,
		'draco3d.decoder': await draco.default.createDecoderModule(),
	});

	const document = await io.readBinary(new Uint8Array(buffer));
	// Dropping the extension objects is what forces the writer to emit plain
	// buffer views: the geometry is already decoded in memory by this point.
	for (const extension of document.getRoot().listExtensionsUsed()) {
		if (compression.includes(extension.extensionName)) extension.dispose();
	}

	const output = path.join(scratchDir, `${path.basename(inputPath, extension)}.decoded.glb`);
	await writeFile(output, Buffer.from(await io.writeBinary(document)));
	return { path: output, decoded: compression };
}
