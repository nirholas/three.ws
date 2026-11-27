// glb-material-restyle.js: change how a GLB's surface looks, in the browser,
// without touching its geometry.
//
// A material look is pure glTF JSON: factors on `materials[]` plus a few
// KHR_materials_* layer extensions. So a restyle rewrites only the JSON chunk of
// the .glb container and copies the BIN chunk across byte for byte. Positions,
// normals, UVs, skins, morph targets, animation and every texture's pixels stay
// exactly as they were, and applying a look costs a JSON parse, not a worker
// round trip or a GLTFExporter re-encode.
//
// The look vocabulary is the platform's own: every look is built from
// MATERIAL_PRESETS in @three-ws/viewer-presets (the same values Restyle Studio
// applies), so a model restyled in Forge and one restyled in /restyle read the
// same. Preset colors are authored as sRGB hex; glTF factors are linear, so
// every color is converted on the way in.
//
// Two kinds of look:
//   finish    keeps the model's own paint (base color texture, vertex colors,
//             emission) and changes only how the surface catches light.
//   material  replaces the paint with a solid material. The base color texture
//             is dropped from the material (its pixels stay in the file), except
//             on MASK/BLEND materials, where that texture carries the alpha that
//             cuts out leaves, hair and lace: those keep it so the cutout holds.
//
// Zero DOM, zero network: every export is a pure function, shared by the Forge
// materials panel (src/forge-materials.js) and its tests.

import { MATERIAL_PRESETS } from '../../packages/viewer-presets/src/materials.js';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

/**
 * Material-level extensions that describe a surface layer. A look owns all of
 * them: applying one clears whatever layers the material had and writes its own,
 * so switching Glass to Chrome never leaves a stray transmission behind.
 */
export const LAYER_EXTENSIONS = Object.freeze([
	'KHR_materials_clearcoat',
	'KHR_materials_transmission',
	'KHR_materials_volume',
	'KHR_materials_ior',
	'KHR_materials_sheen',
	'KHR_materials_specular',
	'KHR_materials_anisotropy',
	'KHR_materials_iridescence',
	'KHR_materials_dispersion',
	'KHR_materials_diffuse_transmission',
	'KHR_materials_emissive_strength',
	'KHR_materials_unlit',
	'KHR_materials_pbrSpecularGlossiness',
]);

export const LOOK_GROUPS = Object.freeze([
	Object.freeze({ id: 'finish', label: 'Finish', hint: 'Keeps the model’s colors, changes the shine.' }),
	Object.freeze({ id: 'material', label: 'Material', hint: 'Replaces the colors with a solid material.' }),
]);

const P = MATERIAL_PRESETS;

function look(id, label, group, params) {
	return Object.freeze({ id, label, group, keepPaint: group === 'finish', params: Object.freeze({ ...params }) });
}

/** Every browser-side look, in display order. */
export const BROWSER_LOOKS = Object.freeze([
	look('glossy', 'Glossy', 'finish', { metalness: P.glossy.metalness, roughness: P.glossy.roughness }),
	look('satin', 'Satin', 'finish', { metalness: 0, roughness: 0.5 }),
	look('matte', 'Matte', 'finish', { metalness: P.matte.metalness, roughness: P.matte.roughness }),
	look('lacquer', 'Lacquer', 'finish', { metalness: 0, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.03 }),
	look('metallic-paint', 'Metallic paint', 'finish', {
		metalness: P.carPaint.metalness,
		roughness: P.carPaint.roughness,
		clearcoat: P.carPaint.clearcoat,
		clearcoatRoughness: P.carPaint.clearcoatRoughness,
	}),
	look('velvet', 'Velvet', 'finish', {
		metalness: P.fabric.metalness,
		roughness: P.fabric.roughness,
		sheen: P.fabric.sheen,
		sheenColor: '#ffffff',
		sheenRoughness: P.fabric.sheenRoughness,
	}),
	look('clay', 'Clay', 'material', { color: '#cfc6b8', metalness: 0, roughness: 0.85 }),
	look('ceramic', P.ceramic.label, 'material', P.ceramic),
	look('chrome', P.chrome.label, 'material', P.chrome),
	look('gold', P.gold.label, 'material', P.gold),
	look('copper', P.copper.label, 'material', P.copper),
	look('brushed-steel', P.brushedSteel.label, 'material', P.brushedSteel),
	look('glass', 'Glass', 'material', P.realGlass),
	look('neon', P.neon.label, 'material', P.neon),
	look('holographic', P.holographic.label, 'material', P.holographic),
]);

const LOOK_BY_ID = new Map(BROWSER_LOOKS.map((l) => [l.id, l]));

/** @param {string} id */
export function lookById(id) {
	return LOOK_BY_ID.get(id) || null;
}

// ── color ────────────────────────────────────────────────────────────────────

const round5 = (v) => Math.round(v * 1e5) / 1e5;
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** sRGB electro-optical transfer: one 0..1 channel to linear light. */
export function srgbToLinear(c) {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * '#rrggbb' or '#rgb' (sRGB, as presets and CSS author it) to a linear [r, g, b]
 * triple, the space glTF baseColorFactor, emissiveFactor and every KHR color
 * factor are defined in.
 */
export function srgbHexToLinear(hex) {
	const h = String(hex || '').replace('#', '').trim();
	const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
	if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex color: ${hex}`);
	const n = parseInt(full, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => round5(srgbToLinear(v / 255)));
}

// ── look params → glTF surface ───────────────────────────────────────────────

/**
 * Translate a MATERIAL_PRESETS-style parameter set (three.js field names, sRGB
 * hex colors) into the glTF surface a material carries: linear factors plus the
 * KHR layer extensions. `envMapIntensity` is a renderer knob with no glTF
 * equivalent, so it is not carried.
 */
export function surfaceFromParams(p) {
	const ext = {};
	const surface = {
		baseColor: p.color ? srgbHexToLinear(p.color) : null,
		metallic: round5(clamp01(p.metalness ?? 0)),
		roughness: round5(clamp01(p.roughness ?? 0.5)),
		emissive: [0, 0, 0],
		extensions: ext,
	};
	const glow = p.emissive ? (p.emissiveIntensity ?? 1) : 0;
	if (glow > 0) {
		const lin = srgbHexToLinear(p.emissive);
		if (glow <= 1) {
			surface.emissive = lin.map((v) => round5(v * glow));
		} else {
			// Past 1 the factor would clip: keep the hue in the factor and carry the
			// brightness in emissive_strength, which is what the extension is for.
			surface.emissive = lin;
			ext.KHR_materials_emissive_strength = { emissiveStrength: glow };
		}
	}
	if (p.clearcoat) {
		ext.KHR_materials_clearcoat = {
			clearcoatFactor: clamp01(p.clearcoat),
			clearcoatRoughnessFactor: clamp01(p.clearcoatRoughness ?? 0),
		};
	}
	if (p.transmission) {
		ext.KHR_materials_transmission = { transmissionFactor: clamp01(p.transmission) };
		if (p.thickness) {
			const volume = { thicknessFactor: p.thickness };
			if (p.attenuationDistance > 0) volume.attenuationDistance = p.attenuationDistance;
			if (p.attenuationColor) volume.attenuationColor = srgbHexToLinear(p.attenuationColor);
			ext.KHR_materials_volume = volume;
		}
	}
	if (p.ior != null) ext.KHR_materials_ior = { ior: p.ior };
	if (p.sheen) {
		// three.js `sheen` is an intensity over `sheenColor`; glTF folds the two
		// into one linear sheenColorFactor (GLTFLoader reads it back as sheen 1).
		const color = srgbHexToLinear(p.sheenColor || '#ffffff');
		ext.KHR_materials_sheen = {
			sheenColorFactor: color.map((v) => round5(v * clamp01(p.sheen))),
			sheenRoughnessFactor: clamp01(p.sheenRoughness ?? 0),
		};
	}
	if (p.specularIntensity != null) ext.KHR_materials_specular = { specularFactor: clamp01(p.specularIntensity) };
	if (p.anisotropy) {
		ext.KHR_materials_anisotropy = {
			anisotropyStrength: clamp01(p.anisotropy),
			anisotropyRotation: p.anisotropyRotation ?? 0,
		};
	}
	return surface;
}

// ── GLB container ────────────────────────────────────────────────────────────

function toBytes(input) {
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	throw new Error('expected GLB bytes (ArrayBuffer or Uint8Array)');
}

/**
 * Split a .glb into its parsed JSON and the untouched bytes after the JSON chunk
 * (the BIN chunk header and payload, when present).
 */
export function readGlb(input) {
	const bytes = toBytes(input);
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength < 20 || dv.getUint32(0, true) !== GLB_MAGIC) {
		throw new Error('This file is not a binary glTF (.glb) model.');
	}
	const version = dv.getUint32(4, true);
	if (version !== 2) throw new Error(`Unsupported glTF container version ${version}.`);
	const jsonLen = dv.getUint32(12, true);
	if (20 + jsonLen > bytes.byteLength || dv.getUint32(16, true) !== CHUNK_JSON) {
		throw new Error('The model file is damaged: its first chunk is not glTF JSON.');
	}
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
	return { json, rest: bytes.subarray(20 + jsonLen) };
}

/** Repack JSON with the original trailing chunk bytes, padding per the spec. */
export function writeGlb(json, rest) {
	const encoded = new TextEncoder().encode(JSON.stringify(json));
	const pad = (4 - (encoded.byteLength % 4)) % 4;
	const jsonLen = encoded.byteLength + pad;
	const total = 20 + jsonLen + rest.byteLength;
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, GLB_MAGIC, true);
	dv.setUint32(4, 2, true);
	dv.setUint32(8, total, true);
	dv.setUint32(12, jsonLen, true);
	dv.setUint32(16, CHUNK_JSON, true);
	out.set(encoded, 20);
	out.fill(0x20, 20 + encoded.byteLength, 20 + jsonLen);
	out.set(rest, 20 + jsonLen);
	return out.buffer;
}

// ── the restyle ──────────────────────────────────────────────────────────────

function collectExtensionKeys(node, into = new Set()) {
	if (Array.isArray(node)) {
		for (const v of node) collectExtensionKeys(v, into);
	} else if (node && typeof node === 'object') {
		for (const [k, v] of Object.entries(node)) {
			if (k === 'extensions' && v && typeof v === 'object' && !Array.isArray(v)) {
				for (const name of Object.keys(v)) into.add(name);
			}
			collectExtensionKeys(v, into);
		}
	}
	return into;
}

function restyleMaterial(material, surface, keepPaint) {
	const m = { ...material };
	const ext = { ...(material.extensions || {}) };
	const pbr = { ...(material.pbrMetallicRoughness || {}) };

	// Spec/gloss is a different shading model: carry its paint into the core
	// metal/rough block first, so dropping the extension below keeps the colors.
	const sg = ext.KHR_materials_pbrSpecularGlossiness;
	if (sg) {
		if (pbr.baseColorFactor == null && Array.isArray(sg.diffuseFactor)) pbr.baseColorFactor = [...sg.diffuseFactor];
		if (pbr.baseColorTexture == null && sg.diffuseTexture) pbr.baseColorTexture = { ...sg.diffuseTexture };
	}

	const cutsOut = m.alphaMode === 'MASK' || m.alphaMode === 'BLEND';
	if (!keepPaint) {
		const alpha = Array.isArray(pbr.baseColorFactor) && Number.isFinite(pbr.baseColorFactor[3]) ? pbr.baseColorFactor[3] : 1;
		pbr.baseColorFactor = [...(surface.baseColor || [1, 1, 1]), alpha];
		if (!cutsOut) delete pbr.baseColorTexture;
	}
	pbr.metallicFactor = surface.metallic;
	pbr.roughnessFactor = surface.roughness;
	// The look defines the finish everywhere; a per-texel metal/rough map would
	// keep fighting it (a 0 in the blue channel pins metal to 0 under any factor).
	delete pbr.metallicRoughnessTexture;
	m.pbrMetallicRoughness = pbr;

	const keptStrength = keepPaint ? ext.KHR_materials_emissive_strength : undefined;
	for (const name of LAYER_EXTENSIONS) delete ext[name];
	if (keepPaint) {
		if (keptStrength) ext.KHR_materials_emissive_strength = keptStrength;
	} else {
		delete m.emissiveTexture;
		if (surface.emissive.some((v) => v > 0)) m.emissiveFactor = surface.emissive;
		else delete m.emissiveFactor;
	}
	for (const [name, value] of Object.entries(surface.extensions)) {
		if (keepPaint && name === 'KHR_materials_emissive_strength') continue;
		ext[name] = value;
	}
	if (Object.keys(ext).length) m.extensions = ext;
	else delete m.extensions;
	return m;
}

/**
 * Apply a look to parsed glTF JSON. Returns a new JSON object; the input is not
 * mutated. Only `materials`, the extension lists and (for primitives that had no
 * material at all) `primitive.material` change.
 *
 * @param {object} json  parsed glTF JSON
 * @param {{ keepPaint: boolean, params: object }} lookDef  an entry of BROWSER_LOOKS
 * @returns {{ json: object, materialsEdited: number, materialsCreated: number }}
 */
export function applyLookToJson(json, lookDef) {
	if (!lookDef || typeof lookDef !== 'object' || !lookDef.params) throw new Error('applyLookToJson: pass a look');
	const out = JSON.parse(JSON.stringify(json));
	const before = collectExtensionKeys(out.materials || []);
	out.materials = Array.isArray(out.materials) ? out.materials : [];

	// A primitive with no material renders with the glTF default (fully metal,
	// fully rough). Give those primitives one explicit material so the look
	// reaches them too; their vertex colors still multiply through it.
	let created = 0;
	let defaultIndex = -1;
	for (const mesh of out.meshes || []) {
		for (const prim of mesh.primitives || []) {
			if (prim.material != null) continue;
			if (defaultIndex < 0) {
				defaultIndex = out.materials.length;
				out.materials.push({ name: 'default' });
				created = 1;
			}
			prim.material = defaultIndex;
		}
	}

	const surface = surfaceFromParams(lookDef.params);
	out.materials = out.materials.map((m) => restyleMaterial(m || {}, surface, !!lookDef.keepPaint));
	if (!out.materials.length) delete out.materials;

	// Extension lists: drop a name only when this restyle removed its last use,
	// then declare the layer extensions the look added. Names the restyle never
	// touched (meshopt, quantization, texture formats) pass through untouched.
	const now = collectExtensionKeys(out);
	const touched = new Set([...before, ...LAYER_EXTENSIONS]);
	const keep = (name) => !touched.has(name) || now.has(name);
	const used = (out.extensionsUsed || []).filter(keep);
	for (const name of now) if (touched.has(name) && !used.includes(name)) used.push(name);
	const required = (out.extensionsRequired || []).filter(keep);
	if (used.length) out.extensionsUsed = used;
	else delete out.extensionsUsed;
	if (required.length) out.extensionsRequired = required;
	else delete out.extensionsRequired;

	return { json: out, materialsEdited: (out.materials || []).length, materialsCreated: created };
}

/**
 * Restyle a .glb. The returned buffer's BIN chunk is byte-identical to the
 * input's.
 *
 * @param {ArrayBuffer|Uint8Array} glb
 * @param {string|{ keepPaint: boolean, params: object }} lookOrId
 * @returns {{ buffer: ArrayBuffer, materialsEdited: number, materialsCreated: number }}
 */
export function restyleGlb(glb, lookOrId) {
	const lookDef = typeof lookOrId === 'string' ? lookById(lookOrId) : lookOrId;
	if (!lookDef) throw new Error(`Unknown look "${lookOrId}".`);
	const { json, rest } = readGlb(glb);
	const result = applyLookToJson(json, lookDef);
	return {
		buffer: writeGlb(result.json, rest),
		materialsEdited: result.materialsEdited,
		materialsCreated: result.materialsCreated,
	};
}
