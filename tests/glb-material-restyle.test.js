// The in-browser material restyle (src/shared/glb-material-restyle.js) behind the
// Forge Materials panel's Finish and Material looks.
//
// The contract a restyle must keep, pinned here on hand-built GLBs that carry
// every material shape the panel meets (textured, metal/rough mapped, alpha
// cut-out, blended, spec/gloss, unlit, clearcoated, no material at all, vertex
// colored) and on committed real assets:
//   - geometry and UVs are byte-identical (the BIN chunk is copied, not re-encoded),
//   - meshes, accessors, buffer views, images, textures, skins and animation are
//     untouched in the JSON too,
//   - colors land in glTF's linear space, metal/rough stay inside [0, 1],
//   - transparent parts stay transparent,
//   - extension declarations stay consistent, so the result passes glTF validation.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import gltfValidator from 'gltf-validator';
import {
	BROWSER_LOOKS,
	LAYER_EXTENSIONS,
	LOOK_GROUPS,
	applyLookToJson,
	lookById,
	readGlb,
	restyleGlb,
	srgbHexToLinear,
	writeGlb,
} from '../src/shared/glb-material-restyle.js';

const PNG_1x1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64',
);

const pad4 = (n) => (n + 3) & ~3;

/** A triangle with UVs and vertex colors, one primitive per material, plus one
 *  primitive that has no material and one textured image. */
function buildFixture() {
	const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
	const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
	const colors = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
	const indices = new Uint16Array([0, 1, 2]);

	const parts = [
		new Uint8Array(positions.buffer),
		new Uint8Array(uvs.buffer),
		colors,
		new Uint8Array(indices.buffer),
		new Uint8Array(PNG_1x1),
	];
	const bufferViews = [];
	let offset = 0;
	const chunks = [];
	parts.forEach((p, i) => {
		const view = { buffer: 0, byteOffset: offset, byteLength: p.byteLength };
		if (i < 3) view.target = 34962;
		if (i === 3) view.target = 34963;
		bufferViews.push(view);
		chunks.push(p);
		const padded = pad4(p.byteLength);
		if (padded > p.byteLength) chunks.push(new Uint8Array(padded - p.byteLength));
		offset += padded;
	});
	const bin = new Uint8Array(offset);
	let at = 0;
	for (const c of chunks) {
		bin.set(c, at);
		at += c.byteLength;
	}

	const prim = (material, withColor = false) => {
		const p = { attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 3 };
		if (withColor) p.attributes.COLOR_0 = 2;
		if (material != null) p.material = material;
		return p;
	};

	const json = {
		asset: { version: '2.0', generator: 'glb-material-restyle.test' },
		extensionsUsed: [
			'KHR_materials_pbrSpecularGlossiness',
			'KHR_materials_unlit',
			'KHR_materials_clearcoat',
			'KHR_texture_transform',
		],
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0, name: 'tri' }],
		meshes: [
			{
				name: 'tri',
				primitives: [prim(0), prim(1), prim(2), prim(3), prim(4), prim(5), prim(null, true)],
			},
		],
		materials: [
			{
				name: 'textured',
				pbrMetallicRoughness: {
					baseColorTexture: { index: 0 },
					baseColorFactor: [1, 0.9, 0.8, 1],
					metallicRoughnessTexture: { index: 0 },
					metallicFactor: 1,
					roughnessFactor: 1,
				},
				normalTexture: { index: 0, scale: 0.7, extensions: { KHR_texture_transform: { scale: [2, 2] } } },
				occlusionTexture: { index: 0, strength: 0.5 },
				emissiveTexture: { index: 0 },
				emissiveFactor: [0.2, 0.1, 0],
				doubleSided: true,
			},
			{
				name: 'leaves',
				alphaMode: 'MASK',
				alphaCutoff: 0.42,
				pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 0.8] },
			},
			{
				name: 'veil',
				alphaMode: 'BLEND',
				pbrMetallicRoughness: { baseColorFactor: [0.3, 0.4, 0.5, 0.35] },
			},
			{
				name: 'specgloss',
				extensions: {
					KHR_materials_pbrSpecularGlossiness: {
						diffuseFactor: [0.5, 0.2, 0.1, 1],
						diffuseTexture: { index: 0 },
						glossinessFactor: 0.8,
					},
				},
			},
			{ name: 'flat', extensions: { KHR_materials_unlit: {} } },
			{
				name: 'coated',
				pbrMetallicRoughness: { baseColorFactor: [0.1, 0.2, 0.9, 1] },
				extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1 } },
			},
		],
		textures: [{ source: 0, sampler: 0 }],
		samplers: [{ magFilter: 9729, minFilter: 9987 }],
		images: [{ bufferView: 4, mimeType: 'image/png' }],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
			{ bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
			{ bufferView: 2, componentType: 5121, normalized: true, count: 3, type: 'VEC4' },
			{ bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
		],
		bufferViews,
		buffers: [{ byteLength: bin.byteLength }],
	};
	return glbFrom(json, bin);
}

function glbFrom(json, bin) {
	const binHeader = new Uint8Array(8);
	const dv = new DataView(binHeader.buffer);
	dv.setUint32(0, bin.byteLength, true);
	dv.setUint32(4, 0x004e4942, true);
	const rest = new Uint8Array(8 + bin.byteLength);
	rest.set(binHeader, 0);
	rest.set(bin, 8);
	return new Uint8Array(writeGlb(json, rest));
}

const fixture = buildFixture();
const fixtureParts = readGlb(fixture);

async function validate(bytes) {
	const report = await gltfValidator.validateBytes(new Uint8Array(bytes));
	return report.issues;
}

const UNTOUCHED_KEYS = ['accessors', 'bufferViews', 'buffers', 'images', 'textures', 'samplers', 'nodes', 'scenes', 'skins', 'animations', 'asset'];

function stripPrimitiveMaterials(meshes) {
	return (meshes || []).map((m) => ({
		...m,
		primitives: m.primitives.map(({ material, ...rest }) => rest),
	}));
}

describe('glb-material-restyle: the fixture itself', () => {
	it('is a valid glTF before any restyle (so a failure below is the restyle’s)', async () => {
		const issues = await validate(fixture);
		expect(issues.messages.filter((m) => m.severity === 0)).toEqual([]);
	});
});

describe('glb-material-restyle: every look keeps the model intact', () => {
	for (const lookDef of BROWSER_LOOKS) {
		describe(lookDef.label, () => {
			const result = restyleGlb(fixture, lookDef.id);
			const out = readGlb(result.buffer);

			it('copies geometry, UVs, vertex colors and image bytes byte for byte', () => {
				expect(Buffer.from(out.rest).equals(Buffer.from(fixtureParts.rest))).toBe(true);
			});

			it('leaves accessors, buffer views, images, textures, nodes and meshes alone', () => {
				for (const key of UNTOUCHED_KEYS) expect(out.json[key]).toEqual(fixtureParts.json[key]);
				expect(stripPrimitiveMaterials(out.json.meshes)).toEqual(stripPrimitiveMaterials(fixtureParts.json.meshes));
			});

			it('passes glTF validation with zero errors', async () => {
				const issues = await validate(result.buffer);
				expect(issues.messages.filter((m) => m.severity === 0)).toEqual([]);
			});

			it('keeps metal and rough inside [0, 1] and drops the per-texel metal/rough map', () => {
				for (const m of out.json.materials) {
					const pbr = m.pbrMetallicRoughness;
					expect(pbr.metallicFactor).toBeGreaterThanOrEqual(0);
					expect(pbr.metallicFactor).toBeLessThanOrEqual(1);
					expect(pbr.roughnessFactor).toBeGreaterThanOrEqual(0);
					expect(pbr.roughnessFactor).toBeLessThanOrEqual(1);
					expect(pbr.metallicRoughnessTexture).toBeUndefined();
				}
			});

			it('keeps transparent parts transparent', () => {
				const [leaves, veil] = [out.json.materials[1], out.json.materials[2]];
				expect(leaves.alphaMode).toBe('MASK');
				expect(leaves.alphaCutoff).toBe(0.42);
				// The cutout lives in the base color texture's alpha, so it must survive
				// even a look that replaces the colors.
				expect(leaves.pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
				expect(leaves.pbrMetallicRoughness.baseColorFactor[3]).toBe(0.8);
				expect(veil.alphaMode).toBe('BLEND');
				expect(veil.pbrMetallicRoughness.baseColorFactor[3]).toBe(0.35);
			});

			it('keeps normal and occlusion maps, double-sidedness and the material count', () => {
				const textured = out.json.materials[0];
				expect(textured.normalTexture).toEqual(fixtureParts.json.materials[0].normalTexture);
				expect(textured.occlusionTexture).toEqual(fixtureParts.json.materials[0].occlusionTexture);
				expect(textured.doubleSided).toBe(true);
				// six authored materials plus one for the primitive that had none
				expect(out.json.materials).toHaveLength(7);
				expect(result.materialsCreated).toBe(1);
				expect(result.materialsEdited).toBe(7);
			});

			it('declares exactly the extensions the result uses, and requires none it added', () => {
				const used = new Set();
				const scan = (node) => {
					if (Array.isArray(node)) node.forEach(scan);
					else if (node && typeof node === 'object') {
						for (const [k, v] of Object.entries(node)) {
							if (k === 'extensions' && v && typeof v === 'object') Object.keys(v).forEach((n) => used.add(n));
							scan(v);
						}
					}
				};
				scan(out.json);
				expect(new Set(out.json.extensionsUsed || [])).toEqual(used);
				expect(out.json.extensionsRequired).toBeUndefined();
				// the texture transform on the kept normal map is still declared
				expect(out.json.extensionsUsed).toContain('KHR_texture_transform');
				expect(out.json.extensionsUsed).not.toContain('KHR_materials_pbrSpecularGlossiness');
				expect(out.json.extensionsUsed).not.toContain('KHR_materials_unlit');
			});
		});
	}
});

describe('glb-material-restyle: color space and look semantics', () => {
	it('converts sRGB preset hex to linear glTF factors', () => {
		expect(srgbHexToLinear('#ffffff')).toEqual([1, 1, 1]);
		expect(srgbHexToLinear('#000')).toEqual([0, 0, 0]);
		const [r] = srgbHexToLinear('#c9ced4');
		expect(r).toBeCloseTo(0.5841, 3);
		// mid gray is ~0.214 linear, not 0.5: the classic gamma mistake would fail here
		expect(srgbHexToLinear('#808080')[0]).toBeCloseTo(0.2158, 3);
		expect(() => srgbHexToLinear('not-a-color')).toThrow();
	});

	it('a Material look replaces the paint with the linear preset color and keeps alpha', () => {
		const out = readGlb(restyleGlb(fixture, 'chrome').buffer).json;
		const textured = out.materials[0].pbrMetallicRoughness;
		expect(textured.baseColorTexture).toBeUndefined();
		expect(textured.baseColorFactor.slice(0, 3)).toEqual(srgbHexToLinear('#c9ced4'));
		expect(textured.baseColorFactor[3]).toBe(1);
		expect(textured.metallicFactor).toBe(1);
		expect(textured.roughnessFactor).toBe(0.05);
		expect(out.materials[0].emissiveTexture).toBeUndefined();
		expect(out.materials[0].emissiveFactor).toBeUndefined();
	});

	it('a Finish look keeps the model’s own paint and only changes the shine', () => {
		const out = readGlb(restyleGlb(fixture, 'matte').buffer).json;
		const textured = out.materials[0];
		expect(textured.pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
		expect(textured.pbrMetallicRoughness.baseColorFactor).toEqual([1, 0.9, 0.8, 1]);
		expect(textured.emissiveTexture).toEqual({ index: 0 });
		expect(textured.emissiveFactor).toEqual([0.2, 0.1, 0]);
		expect(textured.pbrMetallicRoughness.metallicFactor).toBe(0);
		expect(textured.pbrMetallicRoughness.roughnessFactor).toBe(0.9);
	});

	it('a Finish look carries spec/gloss paint into the core model before dropping the extension', () => {
		const out = readGlb(restyleGlb(fixture, 'glossy').buffer).json;
		const sg = out.materials[3];
		expect(sg.extensions).toBeUndefined();
		expect(sg.pbrMetallicRoughness.baseColorFactor).toEqual([0.5, 0.2, 0.1, 1]);
		expect(sg.pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
	});

	it('a look clears unlit, so lighting reaches a material that ignored it', () => {
		const out = readGlb(restyleGlb(fixture, 'satin').buffer).json;
		expect(out.materials[4].extensions).toBeUndefined();
	});

	it('gives a material-less primitive an explicit material so it stops rendering as raw metal', () => {
		const out = readGlb(restyleGlb(fixture, 'clay').buffer).json;
		const prim = out.meshes[0].primitives[6];
		expect(prim.material).toBe(6);
		expect(prim.attributes.COLOR_0).toBe(2);
		expect(out.materials[6].pbrMetallicRoughness.metallicFactor).toBe(0);
	});

	it('Glass writes transmission, volume and IOR; switching to Chrome removes every one of them', () => {
		const glass = readGlb(restyleGlb(fixture, 'glass').buffer);
		const ext = glass.json.materials[0].extensions;
		expect(ext.KHR_materials_transmission.transmissionFactor).toBe(1);
		expect(ext.KHR_materials_volume.thicknessFactor).toBeGreaterThan(0);
		expect(ext.KHR_materials_volume.attenuationDistance).toBeGreaterThan(0);
		expect(ext.KHR_materials_ior.ior).toBe(1.45);
		expect(glass.json.extensionsUsed).toEqual(expect.arrayContaining(['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_ior']));

		// Restyle the glass result again (the panel itself always starts from the
		// original bytes) to prove no layer leaks from one look into the next.
		const chrome = readGlb(restyleGlb(restyleGlb(fixture, 'glass').buffer, 'chrome').buffer).json;
		for (const m of chrome.materials) {
			for (const name of ['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_ior']) {
				expect(m.extensions?.[name]).toBeUndefined();
			}
		}
		for (const name of ['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_ior']) {
			expect(chrome.extensionsUsed || []).not.toContain(name);
		}
	});

	it('Neon keeps the hue in the factor and puts brightness past 1 in emissive_strength', () => {
		const out = readGlb(restyleGlb(fixture, 'neon').buffer).json;
		const m = out.materials[0];
		expect(m.emissiveFactor).toEqual(srgbHexToLinear('#00ffd5'));
		expect(m.extensions.KHR_materials_emissive_strength.emissiveStrength).toBe(1.6);
		for (const v of m.emissiveFactor) expect(v).toBeLessThanOrEqual(1);
	});

	it('Velvet folds sheen intensity into a linear sheen color', () => {
		const out = readGlb(restyleGlb(fixture, 'velvet').buffer).json;
		const sheen = out.materials[0].extensions.KHR_materials_sheen;
		expect(sheen.sheenColorFactor).toEqual([0.6, 0.6, 0.6]);
		expect(sheen.sheenRoughnessFactor).toBe(0.7);
	});

	it('does not mutate the JSON it was given', () => {
		const before = JSON.stringify(fixtureParts.json);
		applyLookToJson(fixtureParts.json, lookById('gold'));
		expect(JSON.stringify(fixtureParts.json)).toBe(before);
	});

	it('every look has a known group and only uses known layer extensions', () => {
		const groups = new Set(LOOK_GROUPS.map((g) => g.id));
		const ids = new Set();
		for (const l of BROWSER_LOOKS) {
			expect(groups.has(l.group)).toBe(true);
			expect(ids.has(l.id)).toBe(false);
			ids.add(l.id);
			const out = applyLookToJson(fixtureParts.json, l).json;
			for (const name of Object.keys(out.materials[0].extensions || {})) expect(LAYER_EXTENSIONS).toContain(name);
		}
	});

	it('refuses a file that is not a GLB, and an unknown look', () => {
		expect(() => restyleGlb(new TextEncoder().encode('{"asset":{}}'), 'chrome')).toThrow(/not a binary glTF/);
		expect(() => restyleGlb(fixture, 'plaid')).toThrow(/Unknown look/);
	});
});

describe('glb-material-restyle: real committed assets', () => {
	const assets = ['public/objects/kenney-graveyard/glb/candle.glb', 'tests/_fixtures/daz-rig.glb', 'public/accessories/hat-cowboy.glb'];
	for (const rel of assets) {
		it(`${rel}: every look keeps the BIN byte-identical and validates`, async () => {
			const bytes = new Uint8Array(readFileSync(resolve(rel)));
			const src = readGlb(bytes);
			const baseline = (await validate(bytes)).numErrors;
			for (const l of BROWSER_LOOKS) {
				const result = restyleGlb(bytes, l.id);
				const out = readGlb(result.buffer);
				expect(Buffer.from(out.rest).equals(Buffer.from(src.rest))).toBe(true);
				for (const key of UNTOUCHED_KEYS) expect(out.json[key]).toEqual(src.json[key]);
				expect((await validate(result.buffer)).numErrors).toBeLessThanOrEqual(baseline);
			}
		});
	}
});
