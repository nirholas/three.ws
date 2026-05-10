import { Cache } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getDecoders } from '../viewer/internal.js';

// Enable in-memory deduplication app-wide — prevents the same URL being
// fetched and parsed more than once within a session.
Cache.enabled = true;

let _loaderPromise = null;

/**
 * Shared GLTFLoader singleton with Draco + Meshopt + KTX2 pre-wired.
 * Returns the same instance on every call after the first.
 *
 * @param {import('three').WebGLRenderer} [renderer]
 *   Pass a renderer to enable KTX2/Basis texture transcoding (needs GPU caps).
 *   Safe to omit when loading geometry-only assets.
 * @returns {Promise<GLTFLoader>}
 */
export function getGLTFLoader(renderer = null) {
	if (!_loaderPromise) {
		_loaderPromise = getDecoders().then(({ dracoLoader, ktx2Loader, meshoptDecoder }) => {
			const loader = new GLTFLoader();
			loader.setDRACOLoader(dracoLoader);
			loader.setMeshoptDecoder(meshoptDecoder);
			loader._ktx2Loader = ktx2Loader;
			return loader;
		});
	}

	return _loaderPromise.then((loader) => {
		if (renderer && !loader._ktx2Ready) {
			loader.setKTX2Loader(loader._ktx2Loader.detectSupport(renderer));
			loader._ktx2Ready = true;
		}
		return loader;
	});
}
