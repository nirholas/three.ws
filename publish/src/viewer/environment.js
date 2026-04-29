import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

export function getCubeMapTexture(viewer, environment) {
	const { id, path } = environment;

	// neutral (THREE.RoomEnvironment)
	if (id === 'neutral') {
		return Promise.resolve({ envMap: viewer.neutralEnvironment });
	}

	// none
	if (id === '') {
		return Promise.resolve({ envMap: null });
	}

	return new Promise((resolve, reject) => {
		new EXRLoader().load(
			path,
			(texture) => {
				const envMap = viewer.pmremGenerator.fromEquirectangular(texture).texture;
				texture.dispose();

				if (viewer._loadedEnvironment && viewer._loadedEnvironment !== envMap) {
					viewer._loadedEnvironment.dispose();
				}
				viewer._loadedEnvironment = envMap;

				resolve({ envMap });
			},
			undefined,
			reject,
		);
	});
}
