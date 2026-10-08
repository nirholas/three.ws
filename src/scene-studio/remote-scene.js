// A scene opened from a `#file=<url>` deep link is authored by whoever controls
// that URL, not by the person looking at /scene. Its object scripts are compiled
// with `new Function` when Play is pressed (vendor/js/libs/app.js), so keeping
// them would let any link run arbitrary JavaScript on the three.ws origin, with
// the viewer's session, after one generic "unsaved data will be lost" prompt.
//
// The geometry, materials, lights and camera are kept. Scripts and the undo
// history (whose AddScript / SetScriptValue commands would restore the same
// source on redo) are dropped. A scene the user trusts can still be opened with
// its scripts through File, Import, which reads a file they chose themselves.

/**
 * Count the object scripts in a serialized editor scene.
 * @param {unknown} scripts
 * @returns {number}
 */
export function countSceneScripts(scripts) {
	if (!scripts || typeof scripts !== 'object') return 0;
	let n = 0;
	for (const list of Object.values(scripts)) {
		if (Array.isArray(list)) n += list.length;
	}
	return n;
}

/**
 * Strip executable content from a scene loaded from a remote URL.
 * @param {Record<string, unknown>} json  parsed editor JSON (`editor.toJSON()` shape)
 * @returns {{ scene: Record<string, unknown>, removedScripts: number }}
 */
export function sanitizeRemoteScene(json) {
	const removedScripts = countSceneScripts(json?.scripts);
	const scene = { ...(json || {}) };
	delete scene.history;
	scene.scripts = {};
	return { scene, removedScripts };
}
