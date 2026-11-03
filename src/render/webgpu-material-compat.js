// Material compatibility for the node renderer (WebGPURenderer).
//
// WebGPURenderer converts every built-in material (MeshStandardMaterial,
// MeshPhysicalMaterial, MeshToonMaterial, ...) to its node equivalent on its
// own. What it cannot run is a hand-written GLSL ShaderMaterial, and the one
// the viewer meets in practice is three-vrm's MToonMaterial. three-vrm ships a
// node port (`@pixiv/three-vrm/nodes`, MToonNodeMaterial), but the 3.5.x build
// imports TSL exports that three r184+ removed, so it does not load on our
// three. Until it does, MToon surfaces are rebuilt as MeshToonMaterial with the
// same base colour, textures, emission and alpha, which keeps the toon banding
// and the authored look; MToon's outline pass (a second material on the same
// geometry group) is hidden, since its inverted-hull shader has no node twin.
//
// Only the WebGPU path runs this. The WebGL path keeps the original materials.

import { MeshToonMaterial, MeshStandardMaterial, Color } from 'three';

/** True for a material the node renderer cannot draw. */
export function needsNodeConversion(material) {
	return !!material && !!material.isShaderMaterial && !material.isNodeMaterial;
}

const SHARED_KEYS = ['name', 'side', 'transparent', 'opacity', 'alphaTest', 'depthWrite', 'depthTest', 'visible'];

function copyShared(src, dst, kind) {
	for (const key of SHARED_KEYS) {
		if (src[key] !== undefined) dst[key] = src[key];
	}
	dst.userData = { ...src.userData, convertedFrom: kind };
}

function toToon(mtoon) {
	const dst = new MeshToonMaterial();
	copyShared(mtoon, dst, 'MToonMaterial');
	if (mtoon.color?.isColor) dst.color.copy(mtoon.color);
	if (mtoon.map) dst.map = mtoon.map;
	if (mtoon.normalMap) {
		dst.normalMap = mtoon.normalMap;
		if (mtoon.normalScale?.isVector2) dst.normalScale.copy(mtoon.normalScale);
	}
	if (mtoon.emissive?.isColor) dst.emissive.copy(mtoon.emissive);
	if (mtoon.emissiveMap) dst.emissiveMap = mtoon.emissiveMap;
	if (typeof mtoon.emissiveIntensity === 'number') dst.emissiveIntensity = mtoon.emissiveIntensity;
	return dst;
}

function toStandard(shader) {
	const dst = new MeshStandardMaterial();
	copyShared(shader, dst, shader.type);
	const u = shader.uniforms || {};
	const map = shader.map || u.map?.value || u.diffuseMap?.value || null;
	if (map?.isTexture) dst.map = map;
	const color = shader.color || u.diffuse?.value || u.color?.value || null;
	if (color?.isColor) dst.color.copy(color);
	else if (!map) dst.color = new Color(0xcccccc);
	return dst;
}

/**
 * Replacement for one material, or the same material when it needs none.
 * MToon outline materials come back hidden.
 */
export function convertMaterial(material) {
	if (!needsNodeConversion(material)) return material;
	if (material.isMToonMaterial) {
		if (material.isOutline) {
			const hidden = new MeshStandardMaterial({ visible: false });
			hidden.userData = { convertedFrom: 'MToonOutline' };
			return hidden;
		}
		return toToon(material);
	}
	return toStandard(material);
}

/**
 * Walk `root` and swap every material the node renderer cannot draw. Each
 * source material is converted once and the replacement shared, so meshes that
 * shared a material still do. Returns how many distinct materials changed.
 */
export function convertForNodeRenderer(root) {
	const done = new Map();
	const swap = (m) => {
		if (!needsNodeConversion(m)) return m;
		if (!done.has(m)) done.set(m, convertMaterial(m));
		return done.get(m);
	};
	root?.traverse?.((node) => {
		if (!node.material) return;
		node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
	});
	return done.size;
}
