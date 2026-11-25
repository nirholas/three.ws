import * as THREE from 'three';

import { ColorEnvironment } from 'three/addons/environments/ColorEnvironment.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Applies the editor's environment type to the scene.
//
// The renderer, and with it the PMREM generator, is created asynchronously
// (WebGPURenderer awaits init()), while a stored project or the first-run
// default can ask for an environment before that finishes. Upstream assumed the
// generator always existed and threw "Cannot read properties of null (reading
// 'fromScene')", which aborted the rest of the load. Without a generator the
// PMREM-backed environments are left unset and reported as deferred: the
// viewport re-applies the environment once the renderer exists.
//
// Returns { useBackgroundAsEnvironment, deferred }.
export function applySceneEnvironment( scene, environmentType, equirectangularTexture, pmremGenerator ) {

	scene.environment = null;

	let useBackgroundAsEnvironment = false;
	let deferred = false;

	switch ( environmentType ) {

		case 'Equirectangular':

			if ( equirectangularTexture ) {

				scene.environment = equirectangularTexture;
				scene.environment.mapping = THREE.EquirectangularReflectionMapping;

			}

			break;

		case 'Default':

			useBackgroundAsEnvironment = true;

			if ( scene.background !== null && scene.background.isTexture ) {

				scene.environment = scene.background;
				scene.environment.mapping = THREE.EquirectangularReflectionMapping;
				scene.environmentRotation.y = scene.backgroundRotation.y;

			} else if ( pmremGenerator === null ) {

				deferred = true;

			} else if ( scene.background !== null && scene.background.isColor ) {

				scene.environment = pmremGenerator.fromScene( new ColorEnvironment( scene.background ), 0.04 ).texture;

			} else if ( scene.background === null ) {

				scene.environment = pmremGenerator.fromScene( new RoomEnvironment(), 0.04 ).texture;

			}

			break;

	}

	return { useBackgroundAsEnvironment, deferred };

}
