// Turn a loaded glTF into a ShapeCloud: N points on its real surface, each
// carrying the colour the model has at that spot (base-colour texture, vertex
// colours and material colour, in that order of authority).
//
// A ShapeCloud is { count, positions: Float32Array(3N), colors: Float32Array(3N,
// linear) }, already seated on the shared stage floor by fitTransform.

import * as THREE from 'three';
import {
	mulberry32,
	triangleAreas,
	buildCdf,
	allocateCounts,
	sampleMesh,
	interpolate,
	boundsOf,
	fitTransform,
} from './sample-core.js';

/** sRGB byte -> linear float, one table lookup per channel. */
const SRGB_TO_LINEAR = (() => {
	const lut = new Float32Array(256);
	for (let i = 0; i < 256; i++) {
		const c = i / 255;
		lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	}
	return lut;
})();

const MAX_TEXTURE_SIDE = 1024;

/** Decode a three.js texture's image into RGBA pixels, downscaled if huge. */
function readTexturePixels(texture) {
	const image = texture && texture.image;
	if (!image) return null;
	const w = image.width || image.videoWidth;
	const h = image.height || image.videoHeight;
	if (!w || !h) return null;
	const k = Math.min(1, MAX_TEXTURE_SIDE / Math.max(w, h));
	const cw = Math.max(1, Math.round(w * k));
	const ch = Math.max(1, Math.round(h * k));
	const canvas = document.createElement('canvas');
	canvas.width = cw;
	canvas.height = ch;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(image, 0, 0, cw, ch);
	return { data: ctx.getImageData(0, 0, cw, ch).data, width: cw, height: ch, flipY: texture.flipY };
}

/** World-space positions of a mesh, with skinning applied at the current pose. */
function worldPositions(mesh) {
	const position = mesh.geometry.getAttribute('position');
	const count = position.count;
	const out = new Float32Array(count * 3);
	const v = new THREE.Vector3();
	if (mesh.isSkinnedMesh) {
		mesh.skeleton.update();
		for (let i = 0; i < count; i++) {
			mesh.getVertexPosition(i, v);
			v.applyMatrix4(mesh.matrixWorld);
			out[i * 3] = v.x;
			out[i * 3 + 1] = v.y;
			out[i * 3 + 2] = v.z;
		}
	} else {
		for (let i = 0; i < count; i++) {
			v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
			out[i * 3] = v.x;
			out[i * 3 + 1] = v.y;
			out[i * 3 + 2] = v.z;
		}
	}
	return out;
}

function flatten(attribute) {
	if (!attribute) return null;
	const out = new Float32Array(attribute.count * attribute.itemSize);
	for (let i = 0; i < attribute.count; i++) {
		for (let k = 0; k < attribute.itemSize; k++) out[i * attribute.itemSize + k] = attribute.getComponent(i, k);
	}
	return out;
}

/** Pull every drawable mesh out of a scene as plain typed arrays. */
export function collectMeshes(root) {
	root.updateMatrixWorld(true);
	const meshes = [];
	root.traverse((node) => {
		if (!node.isMesh || !node.visible || !node.geometry) return;
		const geometry = node.geometry;
		if (!geometry.getAttribute('position')) return;
		const material = Array.isArray(node.material) ? node.material[0] : node.material;
		const index = geometry.getIndex();
		const colorAttr = geometry.getAttribute('color');
		meshes.push({
			positions: worldPositions(node),
			indices: index ? Uint32Array.from(index.array) : null,
			uvs: material && material.map ? flatten(geometry.getAttribute('uv')) : null,
			vertexColors: colorAttr ? { data: flatten(colorAttr), itemSize: colorAttr.itemSize } : null,
			material: {
				color: material && material.color ? material.color.clone() : new THREE.Color(0.8, 0.8, 0.8),
				emissive: material && material.emissive ? material.emissive.clone() : null,
				pixels: material && material.map ? readTexturePixels(material.map) : null,
			},
		});
	});
	return meshes;
}

function yieldFrame() {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Sample `count` points across every mesh, colour them, and seat the cloud on
 * the stage. `onProgress(0..1)` reports real work done; the loop yields to the
 * browser between chunks so the page stays responsive on a million points.
 */
export async function buildShapeCloud(root, count, { seed = 1, onProgress = () => {} } = {}) {
	const meshes = collectMeshes(root);
	if (meshes.length === 0) throw new Error('This model has no meshes to dissolve.');

	const tables = meshes.map((m) => buildCdf(triangleAreas(m.positions, m.indices)));
	const alloc = allocateCounts(tables.map((t) => t.total), count);
	if (alloc.every((n) => n === 0)) throw new Error('This model has no surface area to dissolve.');

	const rng = mulberry32(seed);
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const scratch = [0, 0, 0, 0];
	const tint = new THREE.Color();
	let written = 0;
	const CHUNK = 65536;

	for (let m = 0; m < meshes.length; m++) {
		const mesh = meshes[m];
		let remaining = alloc[m];
		while (remaining > 0) {
			const take = Math.min(CHUNK, remaining);
			const sample = sampleMesh(mesh, take, rng, tables[m]);
			if (sample.count === 0) break;
			const { pixels } = mesh.material;
			tint.copy(mesh.material.color);
			for (let i = 0; i < take; i++) {
				const o = (written + i) * 3;
				positions[o] = sample.positions[i * 3];
				positions[o + 1] = sample.positions[i * 3 + 1];
				positions[o + 2] = sample.positions[i * 3 + 2];
				let r = tint.r;
				let g = tint.g;
				let b = tint.b;
				if (pixels && sample.uvs) {
					const u = sample.uvs[i * 2] - Math.floor(sample.uvs[i * 2]);
					const vRaw = sample.uvs[i * 2 + 1] - Math.floor(sample.uvs[i * 2 + 1]);
					// glTF textures are authored top-down (flipY false); others are not.
					const v = pixels.flipY ? 1 - vRaw : vRaw;
					const px = Math.min(pixels.width - 1, Math.floor(u * pixels.width));
					const py = Math.min(pixels.height - 1, Math.floor(v * pixels.height));
					const p = (py * pixels.width + px) * 4;
					r *= SRGB_TO_LINEAR[pixels.data[p]];
					g *= SRGB_TO_LINEAR[pixels.data[p + 1]];
					b *= SRGB_TO_LINEAR[pixels.data[p + 2]];
				}
				if (mesh.vertexColors) {
					interpolate(mesh.vertexColors.data, mesh.vertexColors.itemSize, mesh.indices, sample.tri, sample.bary, i, scratch);
					r *= scratch[0];
					g *= scratch[1];
					b *= scratch[2];
				}
				if (mesh.material.emissive) {
					r += mesh.material.emissive.r;
					g += mesh.material.emissive.g;
					b += mesh.material.emissive.b;
				}
				colors[o] = r;
				colors[o + 1] = g;
				colors[o + 2] = b;
			}
			written += take;
			remaining -= take;
			onProgress(written / count);
			if (remaining > 0 || m < meshes.length - 1) await yieldFrame();
		}
	}
	if (written < count) {
		// A mesh with no surface can leave a gap. Fill it by repeating real
		// samples so the cloud has exactly `count` live particles.
		for (let i = written; i < count; i++) {
			const src = (i % Math.max(1, written)) * 3;
			for (let k = 0; k < 3; k++) {
				positions[i * 3 + k] = positions[src + k];
				colors[i * 3 + k] = colors[src + k];
			}
		}
	}

	const { min, max } = boundsOf(positions, count);
	const { scale, offset } = fitTransform(min, max);
	for (let i = 0; i < count; i++) {
		positions[i * 3] = positions[i * 3] * scale + offset[0];
		positions[i * 3 + 1] = positions[i * 3 + 1] * scale + offset[1];
		positions[i * 3 + 2] = positions[i * 3 + 2] * scale + offset[2];
	}
	onProgress(1);
	return { count, positions, colors };
}
