// OS file launches for the installed app. The manifest's file_handlers member
// registers three.ws for .glb, .gltf and .vrm, so double-clicking one in
// Windows Explorer (or "Open with" on macOS, ChromeOS and Linux) launches
// /app?source=file-handler and delivers the file handles through
// window.launchQueue. The files are read locally and handed to the viewer as a
// File map, the same shape a drag-and-drop produces; nothing is uploaded until
// the person presses Save to account.

export const FILE_HANDLER_SOURCE = 'file-handler';
export const LAUNCH_EXTENSIONS = ['.glb', '.gltf', '.vrm'];

const MODEL_RE = /\.(glb|gltf|vrm)$/i;

/** True when this page load came from the manifest's file_handlers action. */
export function isFileLaunch(loc = globalThis.location) {
	try {
		return new URLSearchParams(loc?.search || '').get('source') === FILE_HANDLER_SOURCE;
	} catch {
		return false;
	}
}

/**
 * Read every file handle in a LaunchParams into a name -> File map. A .gltf with
 * sidecar .bin or texture files works when the person selected them together in
 * Explorer, because the loader resolves relative URIs against this map.
 * @param {{ files?: Array<{ kind?: string, name?: string, getFile: () => Promise<File> }> }} params
 * @returns {Promise<{ files: Map<string, File>, hasModel: boolean, skipped: string[] }>}
 */
export async function filesFromLaunchParams(params) {
	const files = new Map();
	const skipped = [];
	for (const handle of params?.files || []) {
		if (!handle || (handle.kind && handle.kind !== 'file') || typeof handle.getFile !== 'function') continue;
		try {
			const file = await handle.getFile();
			files.set(file.name, file);
		} catch {
			skipped.push(handle.name || 'a file');
		}
	}
	const hasModel = [...files.keys()].some((name) => MODEL_RE.test(name));
	return { files, hasModel, skipped };
}

/**
 * Register the launch consumer. Chromium buffers launch params until a consumer
 * is set, so calling this after the page boots still receives the first launch,
 * and with launch_handler client_mode navigate-existing every later launch too.
 * @param {(files: Map<string, File>) => void} onFiles called only when a model file arrived
 * @param {(message: string) => void} onError called when files arrived but none could be opened
 * @returns {boolean} whether this browser delivers file launches at all
 */
export function installLaunchConsumer(onFiles, onError, win = globalThis.window) {
	const queue = win?.launchQueue;
	if (!queue || typeof queue.setConsumer !== 'function') return false;
	queue.setConsumer(async (params) => {
		if (!params?.files?.length) return;
		const { files, hasModel, skipped } = await filesFromLaunchParams(params);
		if (hasModel) {
			onFiles(files);
			return;
		}
		onError(
			skipped.length
				? `Windows handed over ${skipped.join(', ')} but it could not be read. Check the file still exists and try again.`
				: 'None of the opened files is a .glb, .gltf or .vrm model. Pick a model file to view it.',
		);
	});
	return true;
}
