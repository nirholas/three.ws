// Server-side texture-layer baker for Parametric avatars.
//
// bakeAppearance() calls applyLayers() after the skin tint is set. The layer
// stack (src/avatar-layers.js, the same compositor the editor previews with) is
// rasterised over the skin colour into one 2048 base-color texture, the skin
// material takes that texture, and its factor goes to white so the texture
// carries the whole colour. Deterministic: the same appearance gives the same
// PNG bytes, so the bake is cached by the appearance hash and the composite
// itself by a hash of the layer stack.
//
// Sources: `catalog:<id>` reads public/avatars/layers/<id>.png (shipped in the
// image, built by scripts/build-avatar-layers.mjs). `upload:<id>` reads
// u/<userId>/layers/<id>.png from object storage, where <userId> is taken from
// the avatar's own storage key, so one owner can never bake another's upload.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { compositeLayers, LAYER_TEXTURE_SIZE, parseLayerSource } from '../../src/avatar-layers.js';

const LAYER_DIR = () => path.resolve(process.cwd(), 'public/avatars/layers');
const MASK_FILE = () => path.resolve(process.cwd(), 'public/avatars/parametric-base.regions.png');
const SKIN_MATERIALS = new Set(['Wolf3D_Skin', 'Wolf3D_Body', 'Parametric_Body']);

let _catalog = null;
let _mask = null;
const _catalogSprites = new Map();
const _compositeCache = new Map();
const COMPOSITE_CACHE_MAX = 8;

/** The shipped catalog index: { version, layers: [{ id, kind, label, file, width, height, defaults }] }. */
export async function loadLayerCatalog() {
	if (!_catalog) _catalog = JSON.parse(await readFile(path.join(LAYER_DIR(), 'index.json'), 'utf-8'));
	return _catalog;
}

async function loadMask() {
	if (_mask) return _mask;
	const { data, info } = await sharp(MASK_FILE()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const px = new Uint8Array(info.width * info.height);
	for (let i = 0; i < px.length; i++) px[i] = data[i * info.channels];
	_mask = { width: info.width, height: info.height, data: px };
	return _mask;
}

async function decodeSprite(buf) {
	const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	return { width: info.width, height: info.height, data };
}

async function loadSource(source, userPrefix) {
	const parsed = parseLayerSource(source);
	if (!parsed) throw new Error('malformed source');
	if (parsed.type === 'catalog') {
		if (_catalogSprites.has(parsed.id)) return _catalogSprites.get(parsed.id);
		const catalog = await loadLayerCatalog();
		const entry = catalog.layers.find((l) => l.id === parsed.id);
		if (!entry) throw new Error('not in the catalog');
		const sprite = await decodeSprite(await readFile(path.join(LAYER_DIR(), entry.file)));
		_catalogSprites.set(parsed.id, sprite);
		return sprite;
	}
	if (!userPrefix) throw new Error('uploads need the avatar owner');
	const { getObjectBuffer } = await import('./r2.js');
	return decodeSprite(await getObjectBuffer(`${userPrefix}/layers/${parsed.id}.png`));
}

function linearToSrgb8(c) {
	const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
	return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

/** The skin material layers can paint: untextured, so the factor is the whole colour. */
export function findLayerSkinMaterial(doc) {
	return (
		doc
			.getRoot()
			.listMaterials()
			.find((m) => SKIN_MATERIALS.has(m.getName()) && !m.getBaseColorTexture()) || null
	);
}

export function hasLayers(appearance) {
	return Array.isArray(appearance?.layers) && appearance.layers.length > 0;
}

/**
 * Composite `appearance.layers` and install the result as the skin's base-color
 * texture. A layer whose source cannot be loaded (retired catalog id, missing
 * upload) is skipped, never fatal: the bake still lands.
 *
 * @returns {Promise<{applied: string[], skipped: {id: string, reason: string}[], png: Buffer|null}>}
 */
export async function applyLayers(doc, appearance, { userPrefix = null, size = LAYER_TEXTURE_SIZE } = {}) {
	const material = findLayerSkinMaterial(doc);
	if (!material) {
		return { applied: [], skipped: appearance.layers.map((l) => ({ id: l.id, reason: 'skin material is not an untextured Parametric body' })), png: null };
	}
	const sources = new Map();
	const usable = [];
	const skipped = [];
	for (const layer of appearance.layers) {
		try {
			if (!sources.has(layer.source)) sources.set(layer.source, await loadSource(layer.source, userPrefix));
			usable.push(layer);
		} catch (err) {
			skipped.push({ id: layer.id, reason: `${layer.source}: ${err.message}` });
		}
	}
	if (usable.length === 0) return { applied: [], skipped, png: null };

	const f = material.getBaseColorFactor();
	const base = [linearToSrgb8(f[0]), linearToSrgb8(f[1]), linearToSrgb8(f[2])];
	const key = createHash('sha256').update(JSON.stringify({ usable, base, size, userPrefix })).digest('hex');
	let png = _compositeCache.get(key);
	if (!png) {
		const pixels = compositeLayers({ size, base, layers: usable, sources, mask: await loadMask() });
		png = await sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), { raw: { width: size, height: size, channels: 4 } })
			.png({ compressionLevel: 9 })
			.toBuffer();
		if (_compositeCache.size >= COMPOSITE_CACHE_MAX) _compositeCache.delete(_compositeCache.keys().next().value);
		_compositeCache.set(key, png);
	}

	const texture = doc.createTexture('skin-layers').setImage(new Uint8Array(png)).setMimeType('image/png');
	material.setBaseColorTexture(texture).setBaseColorFactor([1, 1, 1, f[3]]);
	return { applied: usable.map((l) => l.id), skipped, png };
}
