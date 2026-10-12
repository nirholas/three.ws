/**
 * src/khr-variants.js: KHR_materials_variants runtime support.
 *
 * three.js's GLTFLoader has no native support for this extension, so these
 * tests build a real glTF-Transform Document with two materials and two
 * variants, write it to GLB bytes, load those bytes through three.js's own
 * GLTFLoader (exactly as <agent-3d> does), and verify the controller swaps
 * the live THREE.Mesh's material to match the glTF-Transform mapping table.
 * No mocks: every byte is a real binary glTF asset.
 */

import { describe, it, expect } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsVariants } from '@gltf-transform/extensions';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { parseVariantTable, createVariantController } from '../src/khr-variants.js';

function loadThree(bytes) {
	return new Promise((resolve, reject) => {
		new GLTFLoader().parse(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
			'',
			resolve,
			reject,
		);
	});
}

async function buildVariantGlb() {
	const doc = new Document();
	const buffer = doc.createBuffer();

	const positions = doc
		.createAccessor()
		.setType('VEC3')
		.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
		.setBuffer(buffer);
	const prim = doc.createPrimitive().setAttribute('POSITION', positions);

	const matRed = doc.createMaterial('Red').setBaseColorFactor([1, 0, 0, 1]);
	const matBlue = doc.createMaterial('Blue').setBaseColorFactor([0, 0, 1, 1]);
	prim.setMaterial(matRed);

	const variantExt = doc.createExtension(KHRMaterialsVariants);
	const varRed = variantExt.createVariant('Red');
	const varBlue = variantExt.createVariant('Blue');
	const mapRed = variantExt.createMapping().setMaterial(matRed).addVariant(varRed);
	const mapBlue = variantExt.createMapping().setMaterial(matBlue).addVariant(varBlue);
	const mappingList = variantExt.createMappingList().addMapping(mapRed).addMapping(mapBlue);
	prim.setExtension('KHR_materials_variants', mappingList);

	const mesh = doc.createMesh().addPrimitive(prim);
	const node = doc.createNode().setMesh(mesh);
	const scene = doc.createScene().addChild(node);
	doc.getRoot().setDefaultScene(scene);

	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	return io.writeBinary(doc);
}

async function buildPlainGlb() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const positions = doc
		.createAccessor()
		.setType('VEC3')
		.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
		.setBuffer(buffer);
	const prim = doc.createPrimitive().setAttribute('POSITION', positions);
	prim.setMaterial(doc.createMaterial('Plain'));
	const mesh = doc.createMesh().addPrimitive(prim);
	const node = doc.createNode().setMesh(mesh);
	const scene = doc.createScene().addChild(node);
	doc.getRoot().setDefaultScene(scene);
	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	return io.writeBinary(doc);
}

describe('parseVariantTable', () => {
	it('reads variant names and the material mapping from a real GLB', async () => {
		const bytes = await buildVariantGlb();
		const table = await parseVariantTable(bytes);
		expect(table).not.toBeNull();
		expect(table.names).toEqual(['Red', 'Blue']);
		expect(table.primitives).toHaveLength(1);
		expect(table.primitives[0].byVariant.get('Red')).toBe(0);
		expect(table.primitives[0].byVariant.get('Blue')).toBe(1);
		expect(table.primitives[0].defaultMaterialIndex).toBe(0);
	});

	it('returns null for a GLB that does not use the extension', async () => {
		const bytes = await buildPlainGlb();
		expect(await parseVariantTable(bytes)).toBeNull();
	});

	it('returns null for bytes that are not a valid glTF/GLB', async () => {
		expect(await parseVariantTable(new Uint8Array([1, 2, 3]))).toBeNull();
	});
});

describe('createVariantController', () => {
	it('swaps the live THREE.Mesh material when selecting a variant', async () => {
		const bytes = await buildVariantGlb();
		const gltf = await loadThree(bytes);
		const controller = await createVariantController(bytes, gltf);

		expect(controller).not.toBeNull();
		expect(controller.names).toEqual(['Red', 'Blue']);
		expect(controller.current).toBeNull();

		let mesh = null;
		gltf.scene.traverse((o) => {
			if (o.isMesh) mesh = o;
		});
		expect(mesh.material.color.getHex()).toBe(0xff0000);

		const ok = await controller.select('Blue');
		expect(ok).toBe(true);
		expect(controller.current).toBe('Blue');
		expect(mesh.material.color.getHex()).toBe(0x0000ff);

		const restored = await controller.select(null);
		expect(restored).toBe(false);
		expect(controller.current).toBeNull();
		expect(mesh.material.color.getHex()).toBe(0xff0000);
	});

	it('select() with an unknown name restores the default and reports false', async () => {
		const bytes = await buildVariantGlb();
		const gltf = await loadThree(bytes);
		const controller = await createVariantController(bytes, gltf);

		const ok = await controller.select('Nonexistent');
		expect(ok).toBe(false);
		expect(controller.current).toBeNull();
	});

	it('returns null for a GLB without the extension', async () => {
		const bytes = await buildPlainGlb();
		const gltf = await loadThree(bytes);
		expect(await createVariantController(bytes, gltf)).toBeNull();
	});
});
