// Baking texture layers into the real Parametric base (api/_lib/bake-layers.js).

import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { bakeAppearance, appearanceHash, isBakeable } from '../api/_lib/bake.js';
import { loadLayerCatalog } from '../api/_lib/bake-layers.js';
import { avatarAppearance } from '../api/_lib/validate.js';

const BASE = path.resolve(process.cwd(), 'public/avatars/parametric-base.glb');
const MAX_GLB_BYTES = 12 * 1024 * 1024;

const stack = (catalog, id, over = {}) => {
	const e = catalog.layers.find((l) => l.id === id);
	return { id, kind: e.kind, source: `catalog:${id}`, ...structuredClone(e.defaults), ...over };
};

async function readSkin(glb) {
	await MeshoptDecoder.ready;
	const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(glb);
	return doc.getRoot().listMaterials().find((m) => m.getName() === 'Parametric_Body');
}

describe('texture layers bake', () => {
	let baseBytes;
	let catalog;
	let appearance;

	beforeAll(async () => {
		baseBytes = await readFile(BASE);
		catalog = await loadLayerCatalog();
		appearance = {
			colors: { skin: '#c99a70' },
			layers: [stack(catalog, 'sun-mandala'), stack(catalog, 'lips'), stack(catalog, 'freckles')],
		};
	});

	it('treats a layers-only appearance as bakeable', () => {
		expect(isBakeable({ layers: appearance.layers })).toBe(true);
		expect(isBakeable({ layers: [] })).toBe(false);
	});

	it('puts the composited texture on the skin material and whitens the factor', async () => {
		const glb = await bakeAppearance(baseBytes, appearance, { fold: true });
		const skin = await readSkin(glb);
		const tex = skin.getBaseColorTexture();
		expect(tex).toBeTruthy();
		expect(skin.getBaseColorFactor().slice(0, 3)).toEqual([1, 1, 1]);
		const { width, height } = await sharp(Buffer.from(tex.getImage())).metadata();
		expect([width, height]).toEqual([2048, 2048]);
		expect(glb.byteLength).toBeLessThan(MAX_GLB_BYTES);
	});

	it('bakes the same appearance to the same texture hash', async () => {
		const hashOf = async () => {
			const skin = await readSkin(await bakeAppearance(baseBytes, structuredClone(appearance), { fold: true }));
			return createHash('sha256').update(skin.getBaseColorTexture().getImage()).digest('hex');
		};
		expect(await hashOf()).toBe(await hashOf());
		expect(appearanceHash(appearance)).toBe(appearanceHash(structuredClone(appearance)));
	});

	it('changes the texture when a layer changes', async () => {
		const a = await readSkin(await bakeAppearance(baseBytes, appearance, { fold: true }));
		const other = structuredClone(appearance);
		other.layers[1].tint = '#2255ff';
		const b = await readSkin(await bakeAppearance(baseBytes, other, { fold: true }));
		expect(Buffer.from(a.getBaseColorTexture().getImage()).equals(Buffer.from(b.getBaseColorTexture().getImage()))).toBe(false);
	});

	it('clips a layer to its region: the face stays skin colour while the torso is painted', async () => {
		// A solid sprite covering the whole texture, limited to the torso.
		const ink = stack(catalog, 'porcelain', { kind: 'tattoo', region: 'torso', blend: 'multiply', opacity: 1, tint: '#000000', uv: { offset: [0.5, 0.5], scale: 2, rotation: 0 } });
		const skin = await readSkin(await bakeAppearance(baseBytes, { colors: { skin: '#c99a70' }, layers: [ink] }, { fold: true }));
		const { data, info } = await sharp(Buffer.from(skin.getBaseColorTexture().getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
		const at = (u, v) => {
			const o = (Math.floor(v * info.height) * info.width + Math.floor(u * info.width)) * 3;
			return [data[o], data[o + 1], data[o + 2]];
		};
		const torso = at(0.38, 0.28);
		expect(Math.max(...torso)).toBeLessThan(30);
		const face = at(0.74, 0.535);
		expect(Math.abs(face[0] - 0xc9)).toBeLessThan(8);
		expect(Math.abs(face[2] - 0x70)).toBeLessThan(8);
	});

	it('skips a layer whose source is not in the catalog and still bakes the rest', async () => {
		const withGhost = { layers: [{ ...stack(catalog, 'lips'), id: 'ghost', source: 'catalog:retired-art' }, stack(catalog, 'lips')] };
		const skin = await readSkin(await bakeAppearance(baseBytes, withGhost, { fold: true }));
		expect(skin.getBaseColorTexture()).toBeTruthy();
	});

	it('leaves a body without layers untextured', async () => {
		const skin = await readSkin(await bakeAppearance(baseBytes, { colors: { skin: '#c99a70' } }, { fold: true }));
		expect(skin.getBaseColorTexture()).toBeNull();
	});
});

describe('appearance.layers schema', () => {
	const ok = () => ({
		id: 'l1', kind: 'makeup', source: 'catalog:lips', region: 'scalp', opacity: 0.8, blend: 'normal',
		uv: { offset: [0.9, 0.5], scale: 0.05, rotation: -90 },
	});
	const parse = (layers) => avatarAppearance.safeParse({ layers });

	it('accepts a valid layer', () => {
		expect(parse([ok()]).success).toBe(true);
	});

	it('rejects more than 8 layers', () => {
		expect(parse(Array.from({ length: 9 }, (_, i) => ({ ...ok(), id: `l${i}` }))).success).toBe(false);
	});

	it('rejects an unknown kind, blend or region', () => {
		expect(parse([{ ...ok(), kind: 'sticker' }]).success).toBe(false);
		expect(parse([{ ...ok(), blend: 'screen' }]).success).toBe(false);
		expect(parse([{ ...ok(), region: 'face' }]).success).toBe(false);
	});

	it('rejects external URLs, data URLs and path tricks as a source', () => {
		for (const source of ['https://evil.test/a.png', 'data:image/png;base64,AAAA', 'catalog:../../etc/passwd', 'upload:']) {
			expect(parse([{ ...ok(), source }]).success).toBe(false);
		}
	});

	it('rejects out-of-range opacity, scale, offset and rotation', () => {
		expect(parse([{ ...ok(), opacity: 1.5 }]).success).toBe(false);
		expect(parse([{ ...ok(), uv: { ...ok().uv, scale: 9 } }]).success).toBe(false);
		expect(parse([{ ...ok(), uv: { ...ok().uv, offset: [2, 0] } }]).success).toBe(false);
		expect(parse([{ ...ok(), uv: { ...ok().uv, rotation: 400 } }]).success).toBe(false);
	});

	it('rejects duplicate ids and tattoos on the head', () => {
		expect(parse([ok(), ok()]).success).toBe(false);
		expect(parse([{ ...ok(), kind: 'tattoo' }]).success).toBe(false);
		expect(parse([{ ...ok(), kind: 'tattoo', region: 'torso' }]).success).toBe(true);
	});

	it('rejects unknown keys on a layer', () => {
		expect(parse([{ ...ok(), url: 'https://x.test/a.png' }]).success).toBe(false);
	});
});
