/**
 * Input formats the trimesh-based mesh workers can read, and the refusal for
 * the one they cannot.
 *
 * workers/stylize and workers/segment load meshes with trimesh, which has no
 * FBX reader, and neither image carries a converter. Before this check an FBX
 * was accepted, queued, and then failed inside the worker as an opaque internal
 * error. Both workers refuse FBX themselves too (a 422 on the URL, and a byte
 * sniff for an FBX behind an extensionless URL); refusing here as well turns
 * that into a clean 400 for REST callers and an MCP tool error for agents,
 * instead of a 502 relayed from the worker or a job that can only fail.
 *
 * workers/remesh is the one mesh lane that reads FBX (through headless
 * Blender), so every refusal points there.
 *
 * Kept in lockstep with SUPPORTED_INPUT_LABEL in workers/stylize/main.py and
 * workers/segment/main.py.
 */

export const MESH_INPUT_FORMATS = 'GLB, GLTF, OBJ, STL, PLY, OFF or DAE';

/**
 * The caller-facing refusal for an FBX sent to a lane that cannot read it.
 * @param {string} lane  worker name as callers know it ("stylize", "segment")
 * @param {string} goal  what the caller was trying to do, e.g. "restyle an FBX"
 */
export function fbxUnsupportedMessage(lane, goal) {
	return (
		`FBX input is not supported by ${lane}: supply ${MESH_INPUT_FORMATS}. ` +
		`To ${goal}, convert it to GLB first with remesh (operation "convert", ` +
		'output_format "glb" via /api/forge-remesh or the remesh_model MCP tool), which reads FBX.'
	);
}

export const STYLIZE_FBX_MESSAGE = fbxUnsupportedMessage('stylize', 'restyle an FBX');
export const SEGMENT_FBX_MESSAGE = fbxUnsupportedMessage('segment', 'split an FBX into parts');

/** True when the URL's path names an FBX file, whatever the query string carries. */
export function isFbxMeshUrl(url) {
	try {
		return /\.fbx$/i.test(new URL(url).pathname);
	} catch {
		return false;
	}
}
