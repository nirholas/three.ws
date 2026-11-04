/**
 * GLB editor export fidelity. Builds small glTFs in memory, runs the real
 * exportEditedGLB with a stub session, and re-reads the bytes: what the creator
 * saw in the viewport must be what lands in the file.
 */
import { describe, it, expect } from 'vitest';
import { Document, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRNodeVisibility } from '@gltf-transform/extensions';
import { exportEditedGLB } from '../src/editor/glb-export.js';

// 1x1 PNG (opaque red).
const PNG = Uint8Array.from(
	atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
	(c) => c.charCodeAt(0),
);

const io = new WebIO().registerExtensions(ALL_EXTENSIONS);

async function glbOf(build) {
	const doc = new Document();
	doc.createBuffer();
	build(doc);
	return io.writeBinary(doc);
}

function session(bytes, edits = {}) {
	return {
		materialEdits: {},
		transformEdits: {},
		visibilityEdits: {},
		textureEdits: {},
		...edits,
		getSourceBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
	};
}

async function run(s) {
	const r = await exportEditedGLB(s);
	return { bytes: r instanceof Uint8Array ? r : r.bytes, warnings: r.warnings ?? [] };
}

describe('emissive intensity', () => {
	it('is written as KHR_materials_emissive_strength', async () => {
		const src = await glbOf((d) => d.createMaterial('Glow').setEmissiveFactor([1, 0, 0]));
		const { bytes } = await run(
			session(src, { materialEdits: { u1: { name: 'Glow', uuid: 'u1', emissive: [1, 0, 0], emissiveIntensity: 2.5 } } }),
		);
		const out = await io.readBinary(bytes);
		const ext = out.getRoot().listMaterials()[0].getExtension('KHR_materials_emissive_strength');
		expect(ext).toBeTruthy();
		expect(ext.getEmissiveStrength()).toBeCloseTo(2.5);
	});

	it('writes nothing for the default intensity of 1', async () => {
		const src = await glbOf((d) => d.createMaterial('Glow'));
		const { bytes } = await run(
			session(src, { materialEdits: { u1: { name: 'Glow', uuid: 'u1', emissiveIntensity: 1 } } }),
		);
		const out = await io.readBinary(bytes);
		expect(out.getRoot().listMaterials()[0].getExtension('KHR_materials_emissive_strength')).toBeNull();
	});

	it('removes a strength the source had when the creator sets it back to 1', async () => {
		const src = await glbOf((d) => {
			const ext = d.createExtension(ALL_EXTENSIONS.find((e) => e.EXTENSION_NAME === 'KHR_materials_emissive_strength'));
			d.createMaterial('Glow').setExtension('KHR_materials_emissive_strength', ext.createEmissiveStrength().setEmissiveStrength(3));
		});
		const { bytes } = await run(
			session(src, { materialEdits: { u1: { name: 'Glow', uuid: 'u1', emissiveIntensity: 1 } } }),
		);
		const out = await io.readBinary(bytes);
		expect(out.getRoot().listMaterials()[0].getExtension('KHR_materials_emissive_strength')).toBeNull();
	});
});

describe('hidden nodes', () => {
	it('uses KHR_node_visibility and keeps the real scale', async () => {
		const src = await glbOf((d) => d.createNode('Hand').setScale([2, 3, 4]));
		const { bytes } = await run(
			session(src, { visibilityEdits: { n1: { name: 'Hand', visible: false } } }),
		);
		const node = (await io.readBinary(bytes)).getRoot().listNodes()[0];
		expect(node.getScale()).toEqual([2, 3, 4]);
		expect(node.getExtension('KHR_node_visibility').getVisible()).toBe(false);
		expect(node.getExtras().threeWsHidden).toBe(true);
	});

	it('keeps a scale edit made to a node that is also hidden', async () => {
		const src = await glbOf((d) => d.createNode('Hand'));
		const { bytes } = await run(
			session(src, {
				transformEdits: { n1: { name: 'Hand', scale: [5, 5, 5] } },
				visibilityEdits: { n1: { name: 'Hand', visible: false } },
			}),
		);
		expect((await io.readBinary(bytes)).getRoot().listNodes()[0].getScale()).toEqual([5, 5, 5]);
	});

	it('un-hides a node the source file already hid', async () => {
		const src = await glbOf((d) => {
			const ext = d.createExtension(KHRNodeVisibility);
			d.createNode('Hand')
				.setExtension('KHR_node_visibility', ext.createVisibility().setVisible(false))
				.setExtras({ threeWsHidden: true });
		});
		const { bytes } = await run(
			session(src, { visibilityEdits: { n1: { name: 'Hand', visible: true } } }),
		);
		const node = (await io.readBinary(bytes)).getRoot().listNodes()[0];
		expect(node.getExtension('KHR_node_visibility')).toBeNull();
		expect(node.getExtras().threeWsHidden).toBeUndefined();
	});
});

describe('duplicate names', () => {
	const twoMaterials = () =>
		glbOf((d) => {
			d.createMaterial('Material').setMetallicFactor(0.1);
			d.createMaterial('Material').setMetallicFactor(0.2);
		});

	it('patches only the material the edit points at by index', async () => {
		const src = await twoMaterials();
		const { bytes, warnings } = await run(
			session(src, { materialEdits: { u2: { name: 'Material', uuid: 'u2', materialIndex: 1, metalness: 0.9 } } }),
		);
		const mats = (await io.readBinary(bytes)).getRoot().listMaterials();
		expect(mats[0].getMetallicFactor()).toBeCloseTo(0.1);
		expect(mats[1].getMetallicFactor()).toBeCloseTo(0.9);
		expect(warnings).toEqual([]);
	});

	it('moves two same-named nodes independently by index', async () => {
		const src = await glbOf((d) => {
			d.createNode('Part');
			d.createNode('Part');
		});
		const { bytes } = await run(
			session(src, { transformEdits: { n2: { name: 'Part', nodeIndex: 1, position: [0, 7, 0] } } }),
		);
		const nodes = (await io.readBinary(bytes)).getRoot().listNodes();
		expect(nodes[0].getTranslation()).toEqual([0, 0, 0]);
		expect(nodes[1].getTranslation()).toEqual([0, 7, 0]);
	});

	it('applies a legacy name-only edit to every match and warns by name', async () => {
		const src = await twoMaterials();
		const { bytes, warnings } = await run(
			session(src, { materialEdits: { u1: { name: 'Material', uuid: 'u1', metalness: 0.9 } } }),
		);
		const mats = (await io.readBinary(bytes)).getRoot().listMaterials();
		expect(mats[0].getMetallicFactor()).toBeCloseTo(0.9);
		expect(mats[1].getMetallicFactor()).toBeCloseTo(0.9);
		expect(warnings.some((w) => w.includes('Material') && w.includes('2'))).toBe(true);
	});
});

describe('texture replacement', () => {
	it('replaces an existing slot without touching a material that shared the old texture', async () => {
		const src = await glbOf((d) => {
			const tex = d.createTexture('shared').setImage(new Uint8Array([1, 2, 3])).setMimeType('image/png');
			d.createMaterial('A').setBaseColorTexture(tex);
			d.createMaterial('B').setBaseColorTexture(tex);
		});
		const { bytes } = await run(
			session(src, {
				textureEdits: { 'm0:baseColor': { name: 'A', materialIndex: 0, slot: 'baseColor', bytes: PNG, mime: 'image/png' } },
			}),
		);
		const [a, b] = (await io.readBinary(bytes)).getRoot().listMaterials();
		expect(Array.from(a.getBaseColorTexture().getImage())).toEqual(Array.from(PNG));
		expect(Array.from(b.getBaseColorTexture().getImage())).toEqual([1, 2, 3]);
	});

	it('fills an empty slot', async () => {
		const src = await glbOf((d) => d.createMaterial('A'));
		const { bytes } = await run(
			session(src, {
				textureEdits: { 'm0:normal': { name: 'A', materialIndex: 0, slot: 'normal', bytes: PNG, mime: 'image/png' } },
			}),
		);
		const mat = (await io.readBinary(bytes)).getRoot().listMaterials()[0];
		expect(Array.from(mat.getNormalTexture().getImage())).toEqual(Array.from(PNG));
	});
});
