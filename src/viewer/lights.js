import { AmbientLight, DirectionalLight, HemisphereLight } from 'three';
import { Preset } from './internal.js';

export function addLights(viewer) {
	const { state, options } = viewer;

	if (options.preset === Preset.ASSET_GENERATOR) {
		const hemiLight = new HemisphereLight();
		hemiLight.name = 'hemi_light';
		viewer.scene.add(hemiLight);
		viewer.lights.push(hemiLight);
		return;
	}

	const light1 = new AmbientLight(state.ambientColor, state.ambientIntensity);
	light1.name = 'ambient_light';
	viewer.defaultCamera.add(light1);

	const light2 = new DirectionalLight(state.directColor, state.directIntensity);
	light2.position.set(0.5, 0, 0.866); // ~60º
	light2.name = 'main_light';
	viewer.defaultCamera.add(light2);

	viewer.lights.push(light1, light2);
}

export function removeLights(viewer) {
	viewer.lights.forEach((light) => light.parent.remove(light));
	viewer.lights.length = 0;
}
