// Throwaway diagnostic. Logs bone names of the Avaturn reference GLB
// and one Mixamo FBX so we can author the canonical bone map.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Blob } from 'node:buffer';

// Polyfill globals three's loaders expect.
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({}) };
globalThis.Blob = Blob;
globalThis.URL = URL;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function loadGLB(path) {
	const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
	const buf = readFileSync(path);
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	const loader = new GLTFLoader();
	return new Promise((res, rej) => loader.parse(ab, '', res, rej));
}

async function loadFBX(path) {
	const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
	const buf = readFileSync(path);
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	const loader = new FBXLoader();
	return loader.parse(ab, '');
}

function listBones(root) {
	const bones = [];
	root.traverse((n) => {
		if (n.isBone) bones.push(n.name);
	});
	return bones;
}

const gltf = await loadGLB(resolve(ROOT, 'public/avatars/cz.glb'));
console.log('--- Avaturn (cz.glb) bones ---');
console.log(listBones(gltf.scene).join('\n'));

const fbx = await loadFBX(resolve(ROOT, 'public/animations/Old Man Idle.fbx'));
console.log('\n--- Mixamo (Old Man Idle) bones ---');
console.log(listBones(fbx).join('\n'));

console.log('\n--- Mixamo clip tracks (first 8) ---');
for (const clip of fbx.animations || []) {
	console.log('clip:', clip.name, 'duration:', clip.duration, 'tracks:', clip.tracks.length);
	for (const t of clip.tracks.slice(0, 8)) console.log('  ', t.name);
}
