/**
 * Input formats the stylize worker can read, and the refusal for the one it
 * cannot.
 *
 * workers/stylize loads meshes with trimesh, which has no FBX reader, and its
 * image carries no converter. Before this check an FBX was accepted, queued,
 * and then failed inside the worker as an opaque internal error. The worker
 * refuses FBX itself too (a 422 on the URL, and a byte sniff for an FBX behind
 * an extensionless URL); refusing here as well turns that into a clean 400 for
 * callers instead of a 502 relayed from the worker.
 *
 * Kept in lockstep with SUPPORTED_INPUT_LABEL in workers/stylize/main.py.
 */

export const STYLIZE_INPUT_FORMATS = 'GLB, GLTF, OBJ, STL, PLY, OFF or DAE';

export const STYLIZE_FBX_MESSAGE =
	`FBX input is not supported by stylize: supply ${STYLIZE_INPUT_FORMATS}. ` +
	'To restyle an FBX, convert it to GLB first with remesh (operation "convert", ' +
	'output_format "glb" via /api/forge-remesh or the remesh_model MCP tool), which reads FBX.';

/** True when the URL's path names an FBX file, whatever the query string carries. */
export function isFbxMeshUrl(url) {
	try {
		return /\.fbx$/i.test(new URL(url).pathname);
	} catch {
		return false;
	}
}
