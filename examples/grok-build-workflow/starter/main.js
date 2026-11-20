// A three.js scene that loads any GLB from three.ws: a model Grok Build made
// with /make-3d, a rigged avatar from /rig, or a CC0 catalog asset.
//
// Open with ?src=<glb url>, or paste a URL into the form.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { fitDistance, glbSource } from './fit.js';

// A CC0 chair from the free three.ws catalog, the same search the tour starts with.
const DEFAULT_GLB = 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb';

const canvas = document.getElementById('scene');
const status = document.getElementById('status');
const form = document.getElementById('load');
const input = document.getElementById('src');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171c);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;
controls.addEventListener('start', () => (controls.autoRotate = false));

const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, sun.target);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.35 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let current = null;
let mixer = null;
const timer = new THREE.Timer();

function setStatus(text, kind = 'info') {
	status.textContent = text;
	status.dataset.kind = kind;
}

// Stand the model on the floor at the origin, then aim the camera, light and shadow at it.
function place(model) {
	const box = new THREE.Box3().setFromObject(model);
	const size = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());
	model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));

	const span = Math.max(size.x, size.y, size.z);
	const distance = fitDistance(size, camera.fov, camera.aspect);
	camera.near = span / 100;
	camera.far = distance * 20;
	camera.updateProjectionMatrix();
	controls.target.set(0, size.y / 2, 0);
	camera.position.set(distance * 0.6, size.y * 0.6 + distance * 0.25, distance * 0.8);
	controls.update();

	floor.scale.setScalar(span * 6);
	sun.position.set(span * 2, span * 4, span * 2);
	const cam = sun.shadow.camera;
	cam.left = cam.bottom = -span * 1.5;
	cam.right = cam.top = span * 1.5;
	cam.far = span * 10;
	cam.updateProjectionMatrix();
}

function dispose(object) {
	object.traverse((node) => {
		node.geometry?.dispose();
		for (const material of [node.material].flat().filter(Boolean)) {
			for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
			material.dispose();
		}
	});
}

async function load(url, note = '') {
	setStatus('Loading model...');
	form.querySelector('button').disabled = true;
	try {
		const gltf = await loader.loadAsync(url, (e) => {
			if (e.lengthComputable) setStatus(`Loading model... ${Math.round((e.loaded / e.total) * 100)}%`);
		});
		if (current) {
			scene.remove(current);
			dispose(current);
		}
		current = gltf.scene;
		current.traverse((node) => {
			if (node.isMesh) node.castShadow = node.receiveShadow = true;
		});
		scene.add(current);
		place(current);
		mixer = null;
		if (gltf.animations.length) {
			mixer = new THREE.AnimationMixer(current);
			mixer.clipAction(gltf.animations[0]).play();
		}
		input.value = url;
		history.replaceState(null, '', `?src=${encodeURIComponent(url)}`);
		const clips = gltf.animations.length ? `, playing "${gltf.animations[0].name || 'clip 1'}"` : '';
		const loaded = `Loaded ${new URL(url).pathname.split('/').pop()}${clips}. Drag to orbit, scroll to zoom.`;
		setStatus(note ? `${note} ${loaded}` : loaded, note ? 'error' : 'ok');
		console.log(`loaded ${url}`);
	} catch (err) {
		setStatus(
			`Could not load that model (${err.message || err}). Use a public https URL to a .glb whose host allows cross-origin reads; every URL three.ws returns does.`,
			'error',
		);
	} finally {
		form.querySelector('button').disabled = false;
	}
}

function resize() {
	const { clientWidth: w, clientHeight: h } = canvas;
	renderer.setSize(w, h, false);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

renderer.setAnimationLoop((time) => {
	timer.update(time);
	mixer?.update(timer.getDelta());
	controls.update();
	renderer.render(scene, camera);
});

form.addEventListener('submit', (e) => {
	e.preventDefault();
	const url = glbSource(input.value, null);
	if (url) load(url);
	else setStatus('That is not an https URL. Paste the GLB link Grok printed, starting with https://.', 'error');
});

const requested = new URLSearchParams(location.search).get('src');
const first = glbSource(requested, DEFAULT_GLB);
if (first) load(first);
else load(DEFAULT_GLB, 'The ?src= value is not an https URL, so the catalog chair stands in.');
