import { LoadingManager, REVISION } from 'three';

export const DEFAULT_CAMERA = '[default]';
export const Preset = { ASSET_GENERATOR: 'assetgenerator' };

export const MANAGER = new LoadingManager();
const THREE_PATH = `https://unpkg.com/three@0.${REVISION}.x`;

/**
 * Lazy, memoized setup of the Draco/KTX2/Meshopt decoders. Dynamically imports
 * each module the first time a model is loaded, so the first-paint bundle does
 * not pay for decoders that most callers never use.
 *
 * @returns {Promise<{ dracoLoader: DRACOLoader, ktx2Loader: KTX2Loader, meshoptDecoder: any }>}
 */
let _decodersPromise = null;
export function getDecoders() {
	if (_decodersPromise) return _decodersPromise;
	_decodersPromise = Promise.all([
		import('three/addons/loaders/DRACOLoader.js'),
		import('three/addons/loaders/KTX2Loader.js'),
		import('three/addons/libs/meshopt_decoder.module.js'),
	]).then(([dracoMod, ktx2Mod, meshoptMod]) => {
		const dracoLoader = new dracoMod.DRACOLoader(MANAGER).setDecoderPath(
			`${THREE_PATH}/examples/jsm/libs/draco/gltf/`,
		);
		const ktx2Loader = new ktx2Mod.KTX2Loader(MANAGER).setTranscoderPath(
			`${THREE_PATH}/examples/jsm/libs/basis/`,
		);
		return { dracoLoader, ktx2Loader, meshoptDecoder: meshoptMod.MeshoptDecoder };
	});
	return _decodersPromise;
}

export function traverseMaterials(object, callback) {
	const seen = new Set();
	object.traverse((node) => {
		if (!node.geometry) return;
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		materials.forEach((mat) => {
			if (mat && !seen.has(mat.uuid)) {
				seen.add(mat.uuid);
				callback(mat);
			}
		});
	});
}
