// Apply server-persisted material overrides to a loaded Three.js model.
// Patch shape: { [materialName]: { color, metalness, roughness, emissive } }
// Only fields present in the patch override; everything else stays from the GLB.

import { traverseMaterials } from '../viewer/internal.js';

export function applyMaterialOverrides(model, overrides) {
	if (!model || !overrides || typeof overrides !== 'object') return;
	traverseMaterials(model, (mat) => {
		const p = overrides[mat.name];
		if (!p) return;
		if (p.color     !== undefined) mat.color.set(p.color);
		if (p.metalness !== undefined) mat.metalness = Number(p.metalness);
		if (p.roughness !== undefined) mat.roughness = Number(p.roughness);
		if (p.emissive  !== undefined) mat.emissive.set(p.emissive);
		mat.needsUpdate = true;
	});
}

export function listMaterials(model) {
	const result = [];
	if (!model) return result;
	traverseMaterials(model, (mat) => {
		if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
			result.push({
				name:      mat.name,
				color:     '#' + mat.color.getHexString(),
				metalness: mat.metalness,
				roughness: mat.roughness,
				emissive:  '#' + mat.emissive.getHexString(),
			});
		}
	});
	return result;
}
