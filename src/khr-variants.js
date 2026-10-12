// KHR_materials_variants runtime support for <agent-3d>.
//
// three.js's own GLTFLoader has no native support for this extension (it is
// not among three/examples/jsm's registered extensions), so the variant
// table is read by a second, isomorphic glTF-Transform parse of the same raw
// GLB bytes already fetched to load the model, then cross-referenced against
// GLTFLoader's own `parser.associations` map (which records, for every
// loaded three.js object, which glTF JSON mesh/primitive it came from) to
// find the exact THREE.Mesh each variant mapping targets.
//
// glTF-Transform (Apache-2.0, https://github.com/donmccurdy/glTF-Transform)
// is already a project dependency; this mirrors the WebIO usage pattern in
// src/gltf-inspect.js.

import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsVariants } from '@gltf-transform/extensions';

/**
 * Read a GLB/glTF's KHR_materials_variants data, independent of any three.js
 * scene. Returns null when the asset doesn't use the extension.
 *
 * @param {ArrayBuffer|Uint8Array} glbBytes
 * @returns {Promise<null | {
 *   names: string[],
 *   primitives: Array<{
 *     meshIndex: number,
 *     primitiveIndex: number,
 *     byVariant: Map<string, number>,
 *     defaultMaterialIndex: number|null,
 *   }>,
 * }>}
 */
export async function parseVariantTable(glbBytes) {
	const bytes = glbBytes instanceof Uint8Array ? glbBytes : new Uint8Array(glbBytes);
	const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
	let doc;
	try {
		doc = await io.readBinary(bytes);
	} catch {
		return null;
	}
	const root = doc.getRoot();
	const usesVariants = root
		.listExtensionsUsed()
		.some((e) => e.extensionName === KHRMaterialsVariants.EXTENSION_NAME);
	if (!usesVariants) return null;

	const materials = root.listMaterials();
	const meshes = root.listMeshes();
	const names = [];
	const primitives = [];

	for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
		const prims = meshes[meshIndex].listPrimitives();
		for (let primitiveIndex = 0; primitiveIndex < prims.length; primitiveIndex++) {
			const prim = prims[primitiveIndex];
			const list = prim.getExtension(KHRMaterialsVariants.EXTENSION_NAME);
			if (!list) continue;

			const byVariant = new Map();
			for (const mapping of list.listMappings()) {
				const materialIndex = materials.indexOf(mapping.getMaterial());
				if (materialIndex < 0) continue;
				for (const variant of mapping.listVariants()) {
					const name = variant.getName();
					if (!name) continue;
					if (!names.includes(name)) names.push(name);
					byVariant.set(name, materialIndex);
				}
			}
			if (!byVariant.size) continue;

			const defaultMaterial = prim.getMaterial();
			const defaultIdx = defaultMaterial ? materials.indexOf(defaultMaterial) : -1;
			primitives.push({
				meshIndex,
				primitiveIndex,
				byVariant,
				defaultMaterialIndex: defaultIdx < 0 ? null : defaultIdx,
			});
		}
	}

	if (!names.length || !primitives.length) return null;
	return { names, primitives };
}

/**
 * Build a live variant controller for an already-loaded three.js glTF scene.
 *
 * @param {ArrayBuffer|Uint8Array} glbBytes, the raw bytes used to load `gltf`
 * @param {object} gltf, the object three.js's GLTFLoader resolved (`{ scene, parser, ... }`)
 * @returns {Promise<null | {
 *   names: string[],
 *   current: string|null,
 *   select(name: string|null): Promise<boolean>,
 * }>}
 */
export async function createVariantController(glbBytes, gltf) {
	const table = await parseVariantTable(glbBytes);
	if (!table) return null;

	const parser = gltf?.parser;
	const scene = gltf?.scene;
	if (!parser || !scene) return null;

	// Index every mesh primitive in the loaded scene by the same
	// (meshIndex, primitiveIndex) keys parseVariantTable produced, using
	// GLTFLoader's own node->JSON-index bookkeeping.
	const targets = new Map();
	scene.traverse((obj) => {
		if (!obj.isMesh) return;
		const assoc = parser.associations.get(obj);
		if (!assoc || assoc.meshes == null) return;
		targets.set(`${assoc.meshes}:${assoc.primitives ?? 0}`, obj);
	});

	const resolved = table.primitives
		.map((p) => ({ ...p, mesh: targets.get(`${p.meshIndex}:${p.primitiveIndex}`) }))
		.filter((p) => p.mesh);
	if (!resolved.length) return null;

	// parser.getDependency caches by (type, index) itself, but caching here
	// too avoids a redundant Map lookup + promise alloc on every select().
	const materialCache = new Map();
	async function getMaterial(materialIndex) {
		if (materialIndex == null) return null;
		if (materialCache.has(materialIndex)) return materialCache.get(materialIndex);
		const material = await parser.getDependency('material', materialIndex);
		materialCache.set(materialIndex, material);
		return material;
	}

	let current = null;

	/** @param {string|null} name: null (or an unknown name) restores each primitive's default material. */
	async function select(name) {
		const known = name != null && table.names.includes(name);
		await Promise.all(
			resolved.map(async (p) => {
				const materialIndex = known ? p.byVariant.get(name) ?? p.defaultMaterialIndex : p.defaultMaterialIndex;
				const material = await getMaterial(materialIndex);
				if (material) p.mesh.material = material;
			}),
		);
		current = known ? name : null;
		return known;
	}

	return {
		names: table.names.slice(),
		get current() {
			return current;
		},
		select,
	};
}
