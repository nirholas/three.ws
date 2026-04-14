import { LoadingManager, REVISION } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export const DEFAULT_CAMERA = '[default]';
export const Preset = { ASSET_GENERATOR: 'assetgenerator' };

export const MANAGER = new LoadingManager();
const THREE_PATH = `https://unpkg.com/three@0.${REVISION}.x`;
export const DRACO_LOADER = new DRACOLoader(MANAGER).setDecoderPath(
	`${THREE_PATH}/examples/jsm/libs/draco/gltf/`,
);
export const KTX2_LOADER = new KTX2Loader(MANAGER).setTranscoderPath(
	`${THREE_PATH}/examples/jsm/libs/basis/`,
);

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
