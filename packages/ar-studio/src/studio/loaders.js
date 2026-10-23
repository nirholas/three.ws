// One GLTF loader for the whole studio, wired for the compression the real world
// ships: Draco (most Sketchfab / pipeline exports) and EXT_meshopt_compression
// (what most server-side GLB bakers emit, three.ws avatars included). A studio
// that loads arbitrary caller-supplied GLBs has to handle both or it fails on
// perfectly valid files.
//
// Decoder binaries are fetched from a CDN by default because they are WASM blobs
// that do not belong in an npm package's install footprint. Self-host them and
// point `dracoPath` at your own copy when you would rather not reach out.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/** Where the Draco decoder (wasm + js) is fetched from when nothing else is set. */
export const DEFAULT_DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/draco/gltf/';

let _loader = null;
let _dracoPath = DEFAULT_DRACO_PATH;
let _meshoptPromise = null;

/** Point the Draco decoder at a different host. Call before the first load. */
export function setDracoPath(path) {
	if (typeof path === 'string' && path) _dracoPath = path.endsWith('/') ? path : `${path}/`;
}

function meshoptDecoder() {
	if (!_meshoptPromise) {
		_meshoptPromise = import('three/addons/libs/meshopt_decoder.module.js')
			.then((m) => m.MeshoptDecoder)
			.catch(() => null);
	}
	return _meshoptPromise;
}

/**
 * The shared loader. Draco is attached synchronously; meshopt resolves async and
 * attaches as soon as it is ready, so plain and Draco GLBs never wait on it.
 * @returns {GLTFLoader}
 */
export function sharedGLTFLoader() {
	if (_loader) return _loader;
	_loader = new GLTFLoader();
	const draco = new DRACOLoader();
	draco.setDecoderPath(_dracoPath);
	_loader.setDRACOLoader(draco);
	meshoptDecoder().then((d) => {
		if (d) _loader.setMeshoptDecoder(d);
	});
	return _loader;
}

/**
 * The shared loader, once every optional decoder that can attach has attached.
 *
 * `sharedGLTFLoader()` returns before meshopt resolves, which is right for the
 * queue (a plain GLB should not wait on a WASM download it will never use) and
 * wrong for a one-shot parse: hand a meshopt-compressed GLB to a loader whose
 * decoder is still in flight and it throws "no DRACOLoader instance provided"'s
 * meshopt equivalent on a file that is perfectly valid. Anything that parses a
 * single caller-supplied GLB should await this instead.
 *
 * @returns {Promise<GLTFLoader>}
 */
export async function sharedGLTFLoaderReady() {
	const loader = sharedGLTFLoader();
	await meshoptDecoder();
	return loader;
}

/** Drop the cached loader (tests, or after changing the Draco path mid-session). */
export function resetLoader() {
	_loader = null;
}
