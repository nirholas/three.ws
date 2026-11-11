// The Office-safe GLB pass (api/_lib/office-glb.js) and the KTX2 decoder it
// leans on (api/_lib/ktx2-decode.js).
//
// Every input here is a real glTF binary built in the test with glTF Transform
// and compressed with the real encoders (draco3dgltf, meshoptimizer), plus the
// two Basis Universal KTX2 encodings from tests/fixtures/ktx2. The assertions
// read the pass's output back as a fresh document, so they check the file
// PowerPoint would receive, not the pass's own report.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import {
	ALL_EXTENSIONS,
	EXTMeshoptCompression,
	EXTTextureWebP,
	KHRDracoMeshCompression,
	KHRTextureBasisu,
} from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

import {
	makeOfficeSafeGlb,
	OfficeGlbError,
	OFFICE_MAX_ANIMATIONS,
	OFFICE_TEXTURE_MAX_PX,
} from '../api/_lib/office-glb.js';
import { decodeKtx2, isKtx2, Ktx2DecodeError } from '../api/_lib/ktx2-decode.js';

const KTX2_ETC1S = new Uint8Array(
	readFileSync(new URL('./fixtures/ktx2/2d_etc1s.ktx2', import.meta.url)),
);
const KTX2_UASTC = new Uint8Array(
	readFileSync(new URL('./fixtures/ktx2/2d_uastc.ktx2', import.meta.url)),
);

let ioPromise;
function io() {
	ioPromise ||= (async () => {
		await MeshoptEncoder.ready;
		await MeshoptDecoder.ready;
		return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
			'draco3d.encoder': await draco3d.createEncoderModule(),
			'draco3d.decoder': await draco3d.createDecoderModule(),
			'meshopt.encoder': MeshoptEncoder,
			'meshopt.decoder': MeshoptDecoder,
		});
	})();
	return ioPromise;
}

async function readBack(glb) {
	return (await io()).readBinary(glb);
}

const extensionsOf = (doc) =>
	doc
		.getRoot()
		.listExtensionsUsed()
		.map((e) => e.extensionName);

/** A unit box offset from the origin, so recentring is observable. */
function addBox(doc, buffer, { offset = [3, 1, -2], material = null } = {}) {
	const p = [];
	const idx = [];
	const corners = [];
	for (let i = 0; i < 8; i++)
		corners.push([
			(i & 1) - 0.5 + offset[0],
			((i >> 1) & 1) - 0.5 + offset[1],
			((i >> 2) & 1) - 0.5 + offset[2],
		]);
	for (const c of corners) p.push(...c);
	const faces = [
		[0, 1, 3, 2],
		[4, 6, 7, 5],
		[0, 4, 5, 1],
		[2, 3, 7, 6],
		[0, 2, 6, 4],
		[1, 5, 7, 3],
	];
	for (const [a, b, c, d] of faces) idx.push(a, b, c, a, c, d);
	const uv = [];
	for (const c of corners) uv.push(c[0] - offset[0] + 0.5, c[1] - offset[1] + 0.5);
	const prim = doc
		.createPrimitive()
		.setAttribute(
			'POSITION',
			doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer),
		)
		.setAttribute(
			'TEXCOORD_0',
			doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer),
		)
		.setIndices(
			doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer),
		);
	if (material) prim.setMaterial(material);
	return prim;
}

function newDoc() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene('Scene');
	doc.getRoot().setDefaultScene(scene);
	return { doc, buffer, scene };
}

async function solidImage(format, size, { alpha = false } = {}) {
	const img = sharp({
		create: {
			width: size,
			height: size,
			channels: 4,
			background: { r: 200, g: 120, b: 40, alpha: alpha ? 0.5 : 1 },
		},
	});
	return new Uint8Array(await img[format]().toBuffer());
}

/** Draco-compressed geometry. */
async function dracoGlb() {
	const { doc, buffer, scene } = newDoc();
	doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
		method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
	});
	scene.addChild(
		doc.createNode('box').setMesh(doc.createMesh('box').addPrimitive(addBox(doc, buffer))),
	);
	return (await io()).writeBinary(doc);
}

/** Meshopt-compressed and quantized, like the forge delivery copy. */
async function meshoptGlb() {
	const { doc, buffer, scene } = newDoc();
	scene.addChild(
		doc.createNode('box').setMesh(doc.createMesh('box').addPrimitive(addBox(doc, buffer))),
	);
	await doc.transform(quantize());
	doc.createExtension(EXTMeshoptCompression)
		.setRequired(true)
		.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
	return (await io()).writeBinary(doc);
}

/** One material whose base colour is the given KTX2 image. */
async function ktx2Glb(ktx2) {
	const { doc, buffer, scene } = newDoc();
	doc.createExtension(KHRTextureBasisu).setRequired(true);
	const texture = doc.createTexture('basecolor').setImage(ktx2).setMimeType('image/ktx2');
	const material = doc.createMaterial('mat').setBaseColorTexture(texture);
	scene.addChild(
		doc
			.createNode('box')
			.setMesh(doc.createMesh('box').addPrimitive(addBox(doc, buffer, { material }))),
	);
	return (await io()).writeBinary(doc);
}

/**
 * A skinned, animated box: 3 joints, 8 influences per vertex across JOINTS_0/1,
 * a STEP rotation track, a WebP texture of `texturePx`, and `clips` clips.
 */
async function riggedGlb({ clips = 3, texturePx = 64 } = {}) {
	const { doc, buffer, scene } = newDoc();
	doc.createExtension(EXTTextureWebP).setRequired(true);
	const texture = doc
		.createTexture('skin')
		.setImage(await solidImage('webp', texturePx))
		.setMimeType('image/webp');
	const material = doc.createMaterial('skin').setBaseColorTexture(texture);
	const prim = addBox(doc, buffer, { material });
	const n = prim.getAttribute('POSITION').getCount();
	const j0 = new Uint16Array(n * 4);
	const j1 = new Uint16Array(n * 4);
	const w0 = new Float32Array(n * 4);
	const w1 = new Float32Array(n * 4);
	for (let v = 0; v < n; v++) {
		j0.set([0, 1, 2, 0], v * 4);
		w0.set([0.3, 0.2, 0.15, 0.1], v * 4);
		j1.set([1, 2, 0, 1], v * 4);
		w1.set([0.1, 0.06, 0.05, 0.04], v * 4);
	}
	const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
	prim.setAttribute('JOINTS_0', acc('VEC4', j0))
		.setAttribute('WEIGHTS_0', acc('VEC4', w0))
		.setAttribute('JOINTS_1', acc('VEC4', j1))
		.setAttribute('WEIGHTS_1', acc('VEC4', w1));
	const hips = doc.createNode('Hips');
	const spine = doc.createNode('Spine').setTranslation([0, 0.5, 0]);
	const head = doc.createNode('Head').setTranslation([0, 0.5, 0]);
	hips.addChild(spine);
	spine.addChild(head);
	const ibm = new Float32Array(16 * 3);
	for (let i = 0; i < 3; i++)
		ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.5 * i, 0, 1], i * 16);
	const skin = doc
		.createSkin('rig')
		.addJoint(hips)
		.addJoint(spine)
		.addJoint(head)
		.setSkeleton(hips)
		.setInverseBindMatrices(acc('MAT4', ibm));
	const mesh = doc
		.createNode('body')
		.setMesh(doc.createMesh('body').addPrimitive(prim))
		.setSkin(skin);
	scene.addChild(hips).addChild(mesh);
	for (let c = 0; c < clips; c++) {
		const sampler = doc
			.createAnimationSampler()
			.setInput(acc('SCALAR', new Float32Array([0, 0.5, 1])))
			.setOutput(acc('VEC4', new Float32Array([0, 0, 0, 1, 0, 0.383, 0, 0.924, 0, 0, 0, 1])))
			.setInterpolation(c === 0 ? 'STEP' : 'LINEAR');
		const channel = doc
			.createAnimationChannel()
			.setTargetNode(spine)
			.setTargetPath('rotation')
			.setSampler(sampler);
		doc.createAnimation(`clip${c}`).addSampler(sampler).addChannel(channel);
	}
	return (await io()).writeBinary(doc);
}

describe('decodeKtx2', () => {
	it('recognises the KTX2 identifier and nothing else', async () => {
		expect(isKtx2(KTX2_ETC1S)).toBe(true);
		expect(isKtx2(await solidImage('png', 4))).toBe(false);
		await expect(decodeKtx2(new Uint8Array(32))).rejects.toBeInstanceOf(Ktx2DecodeError);
	});

	it.each([
		['ETC1S', KTX2_ETC1S],
		['UASTC', KTX2_UASTC],
	])('decodes Basis %s to RGBA pixels', async (_label, bytes) => {
		const { data, width, height } = await decodeKtx2(bytes);
		expect(width).toBeGreaterThan(0);
		expect(height).toBeGreaterThan(0);
		expect(data.length).toBe(width * height * 4);
		expect(data.some((b) => b > 0 && b < 255)).toBe(true);
	});

	it.each([
		['UNORM', 37],
		['SRGB', 43],
	])('reads uncompressed RGBA8 %s pixels straight from level 0', async (_label, vkFormat) => {
		const pixels = Uint8Array.from([
			255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 8, 7, 6,
		]);
		const ktx2 = uncompressedKtx2(vkFormat, 2, 2, pixels);
		const { data, width, height } = await decodeKtx2(ktx2);
		expect([width, height]).toEqual([2, 2]);
		expect([...data]).toEqual([...pixels]);
	});

	it('rejects an uncompressed format other than RGBA8', async () => {
		const ktx2 = uncompressedKtx2(23, 2, 2, new Uint8Array(12));
		await expect(decodeKtx2(ktx2)).rejects.toBeInstanceOf(Ktx2DecodeError);
	});
});

/** A KTX2 file laid out per the Khronos spec: header, one level index entry, then level 0. */
function uncompressedKtx2(vkFormat, width, height, pixels) {
	const dataOffset = 80 + 24;
	const bytes = new Uint8Array(dataOffset + pixels.length);
	bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
	const view = new DataView(bytes.buffer);
	view.setUint32(12, vkFormat, true);
	view.setUint32(16, 1, true);
	view.setUint32(20, width, true);
	view.setUint32(24, height, true);
	view.setUint32(36, 1, true);
	view.setUint32(40, 1, true);
	view.setBigUint64(80, BigInt(dataOffset), true);
	view.setBigUint64(88, BigInt(pixels.length), true);
	view.setBigUint64(96, BigInt(pixels.length), true);
	bytes.set(pixels, dataOffset);
	return bytes;
}

describe('makeOfficeSafeGlb', () => {
	it('decodes Draco geometry into plain vertex data', async () => {
		const input = await dracoGlb();
		expect(extensionsOf(await readBack(input))).toContain('KHR_draco_mesh_compression');
		const { glb, report } = await makeOfficeSafeGlb(input);
		const out = await readBack(glb);
		expect(extensionsOf(out)).not.toContain('KHR_draco_mesh_compression');
		expect(report.extensionsBefore).toContain('KHR_draco_mesh_compression');
		const prim = out.getRoot().listMeshes()[0].listPrimitives()[0];
		expect(prim.getAttribute('POSITION').getCount()).toBeGreaterThanOrEqual(8);
		expect(prim.getAttribute('POSITION').getArray()).toBeInstanceOf(Float32Array);
	});

	it('decodes meshopt compression and quantization, like the forge delivery copy', async () => {
		const input = await meshoptGlb();
		const before = extensionsOf(await readBack(input));
		expect(before).toEqual(
			expect.arrayContaining(['EXT_meshopt_compression', 'KHR_mesh_quantization']),
		);
		const { glb, report } = await makeOfficeSafeGlb(input);
		expect(report.extensionsAfter).toEqual([]);
		// Read back with nothing but the core: a decoder-less reader must load it.
		const plain = await new NodeIO().readBinary(glb);
		expect(plain.getRoot().listExtensionsUsed()).toEqual([]);
		const pos = plain.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
		expect(pos.getArray()).toBeInstanceOf(Float32Array);
	});

	it.each([
		['ETC1S', KTX2_ETC1S],
		['UASTC', KTX2_UASTC],
	])('replaces a KTX2 %s texture with PNG or JPEG', async (_label, ktx2) => {
		const { glb, report } = await makeOfficeSafeGlb(await ktx2Glb(ktx2));
		const out = await readBack(glb);
		expect(extensionsOf(out)).not.toContain('KHR_texture_basisu');
		const texture = out.getRoot().listTextures()[0];
		expect(['image/png', 'image/jpeg']).toContain(texture.getMimeType());
		const meta = await sharp(Buffer.from(texture.getImage())).metadata();
		expect(['png', 'jpeg']).toContain(meta.format);
		expect(report.textures[0]).toMatchObject({ from: 'image/ktx2' });
	});

	it('keeps the skeleton and every clip, caps influences at 4 and makes STEP linear', async () => {
		const { glb, report } = await makeOfficeSafeGlb(await riggedGlb({ clips: 3 }));
		const out = await readBack(glb);
		const root = out.getRoot();
		expect(root.listSkins()).toHaveLength(1);
		expect(
			root
				.listSkins()[0]
				.listJoints()
				.map((j) => j.getName()),
		).toEqual(['Hips', 'Spine', 'Head']);
		expect(root.listAnimations().map((a) => a.getName())).toEqual(['clip0', 'clip1', 'clip2']);
		for (const anim of root.listAnimations()) {
			for (const s of anim.listSamplers()) expect(s.getInterpolation()).not.toBe('STEP');
			expect(anim.listChannels()[0].getTargetNode().getName()).toBe('Spine');
		}
		expect(report.stepSamplersConverted).toBe(1);

		const prim = root.listMeshes()[0].listPrimitives()[0];
		expect(prim.getAttribute('JOINTS_1')).toBeNull();
		expect(prim.getAttribute('WEIGHTS_1')).toBeNull();
		const weights = prim.getAttribute('WEIGHTS_0');
		const joints = prim.getAttribute('JOINTS_0');
		const w = [0, 0, 0, 0];
		const j = [0, 0, 0, 0];
		weights.getElement(0, w);
		joints.getElement(0, j);
		expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
		// The four heaviest of the eight: 0.3 (j0), 0.2 (j1), 0.15 (j2), 0.1 (j0 or j1).
		expect(j.slice(0, 3)).toEqual([0, 1, 2]);
		expect(w[0]).toBeCloseTo(0.3 / 0.75, 4);

		// The WebP texture became something Office reads.
		expect(extensionsOf(out)).not.toContain('EXT_texture_webp');
		expect(['image/png', 'image/jpeg']).toContain(root.listTextures()[0].getMimeType());
	});

	it(`keeps the first ${OFFICE_MAX_ANIMATIONS} clips of a longer list and says so`, async () => {
		const { glb, report } = await makeOfficeSafeGlb(
			await riggedGlb({ clips: OFFICE_MAX_ANIMATIONS + 3 }),
		);
		const names = (await readBack(glb))
			.getRoot()
			.listAnimations()
			.map((a) => a.getName());
		expect(names).toHaveLength(OFFICE_MAX_ANIMATIONS);
		expect(names[0]).toBe('clip0');
		expect(names.at(-1)).toBe(`clip${OFFICE_MAX_ANIMATIONS - 1}`);
		expect(report.warnings.join(' ')).toMatch(/at most 18 animations/);
	});

	it('caps textures at the Office limit', async () => {
		const big = OFFICE_TEXTURE_MAX_PX * 2;
		const { glb, report } = await makeOfficeSafeGlb(
			await riggedGlb({ clips: 1, texturePx: big }),
		);
		const texture = (await readBack(glb)).getRoot().listTextures()[0];
		const meta = await sharp(Buffer.from(texture.getImage())).metadata();
		expect(Math.max(meta.width, meta.height)).toBe(OFFICE_TEXTURE_MAX_PX);
		expect(report.textures[0].fromSize).toEqual([big, big]);
	});

	it('centres the model on the origin and reports the centred bounds', async () => {
		const { bounds } = await makeOfficeSafeGlb(await dracoGlb());
		for (let i = 0; i < 3; i++) {
			expect(bounds.min[i] + bounds.max[i]).toBeCloseTo(0, 5);
			expect(bounds.max[i] - bounds.min[i]).toBeCloseTo(1, 5);
		}
	});

	it('refuses files that are not a GLB with a coded error', async () => {
		await expect(makeOfficeSafeGlb(new Uint8Array(0))).rejects.toMatchObject({
			code: 'invalid_model',
		});
		const garbage = new TextEncoder().encode('this is not a binary glTF file at all');
		const err = await makeOfficeSafeGlb(garbage).catch((e) => e);
		expect(err).toBeInstanceOf(OfficeGlbError);
		expect(err.code).toBe('invalid_model');
	});

	it('refuses a model with nothing to show', async () => {
		const { doc } = newDoc();
		doc.getRoot().getDefaultScene().addChild(doc.createNode('empty'));
		const glb = await (await io()).writeBinary(doc);
		await expect(makeOfficeSafeGlb(glb)).rejects.toMatchObject({ code: 'no_geometry' });
	});
});
