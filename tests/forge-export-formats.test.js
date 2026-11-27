// Forge download formats: every file the export menu hands out must open in the
// tool it is meant for, not only in Forge's own (forgiving) viewer.
//
// Each format is produced by the same code the page runs (src/forge-export-core.js,
// src/forge-export-files.js) and then read back with a small parser written here
// from the format's own spec, independent of the three.js exporter that wrote it.
// Models are built in the test, so counts are exact.

import { describe, it, expect, beforeAll } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { meshopt, reorder, quantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import validator from 'gltf-validator';
import { placeOnBed } from '../api/_lib/print/slicer.js';

// GLTFLoader probes `self` to pick its image loader. Node has no `self`; the
// alias is the environment shim, not a stand-in for any product behaviour.
globalThis.self ??= globalThis;

const THREE = await import('three');
const core = await import('../src/forge-export-core.js');
const files = await import('../src/forge-export-files.js');

// ---- independent readers ----------------------------------------------------

function readBinaryStl(bytes) {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = dv.getUint32(80, true);
	expect(bytes.byteLength).toBe(84 + count * 50);
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let t = 0; t < count; t++) {
		const base = 84 + t * 50 + 12; // skip the facet normal
		for (let v = 0; v < 3; v++) {
			for (let a = 0; a < 3; a++) {
				const x = dv.getFloat32(base + v * 12 + a * 4, true);
				if (x < min[a]) min[a] = x;
				if (x > max[a]) max[a] = x;
			}
		}
	}
	return { triangles: count, min, max };
}

function readObj(text) {
	let vertices = 0;
	let normals = 0;
	let uvs = 0;
	let triangles = 0;
	const objects = [];
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const line of text.split('\n')) {
		const parts = line.trim().split(/\s+/);
		if (parts[0] === 'v') {
			vertices++;
			for (let a = 0; a < 3; a++) {
				const x = Number(parts[a + 1]);
				expect(Number.isFinite(x)).toBe(true);
				if (x < min[a]) min[a] = x;
				if (x > max[a]) max[a] = x;
			}
		} else if (parts[0] === 'vn') normals++;
		else if (parts[0] === 'vt') uvs++;
		else if (parts[0] === 'o') objects.push(parts.slice(1).join(' '));
		else if (parts[0] === 'f') {
			// Every face index must point at a vertex already declared (1-based).
			for (const ref of parts.slice(1)) {
				const vi = Number(ref.split('/')[0]);
				expect(vi >= 1 && vi <= vertices).toBe(true);
			}
			triangles += parts.length - 3;
		}
	}
	return { vertices, normals, uvs, triangles, objects, min, max };
}

function readBinaryPly(bytes) {
	const headEnd = Buffer.from(bytes).indexOf('end_header\n');
	expect(headEnd).toBeGreaterThan(0);
	const header = Buffer.from(bytes.subarray(0, headEnd)).toString('latin1');
	expect(header.startsWith('ply\n')).toBe(true);
	expect(header).toMatch(/format binary_little_endian 1\.0/);
	const vertices = Number(header.match(/element vertex (\d+)/)?.[1]);
	const faces = Number(header.match(/element face (\d+)/)?.[1] ?? 0);
	const props = [...header.matchAll(/^property (float|uchar|int|uint) (\w+)$/gm)].map((m) => m[2]);
	return { vertices, faces, props };
}

function readUsdz(bytes) {
	const entries = unzipSync(bytes);
	const names = Object.keys(entries);
	// USDZ: the first file in the package is the root layer, and every entry is
	// stored uncompressed and 64-byte aligned so iOS can memory-map it.
	expect(names[0]).toMatch(/\.usda?$/);
	const root = strFromU8(entries[names[0]]);
	const geometry = names.filter((n) => n.endsWith('.usda') && n !== names[0]).map((n) => strFromU8(entries[n]));
	let points = 0;
	for (const g of geometry) {
		const m = g.match(/point3f\[\] points = \[([^\]]*)\]/);
		if (m) points += m[1].split('),').length;
	}
	return { names, root, points };
}

// ---- fixtures ---------------------------------------------------------------

/** A 1 x 2 x 0.5 m box standing on the origin, plus a scaled, moved child. */
function sampleScene() {
	const scene = new THREE.Scene();
	const box = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.5), new THREE.MeshStandardMaterial({ color: 0x7a4dff }));
	box.name = 'body';
	box.position.set(0, 1, 0);
	const knob = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial());
	knob.name = 'knob';
	knob.position.set(0.6, 1.5, 0);
	knob.scale.set(2, 1, 1);
	scene.add(box, knob);
	scene.updateMatrixWorld(true);
	return scene;
}

const SAMPLE_TRIANGLES = 24; // two boxes, 12 triangles each
const SAMPLE_VERTICES = 48; // BoxGeometry splits every face: 24 vertices a box

async function glbFromDocument(doc) {
	await MeshoptEncoder.ready;
	await MeshoptDecoder.ready;
	const io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
	return io.writeBinary(doc);
}

/** A one-triangle-pair quad with a base color PNG and a WebP-only normal map. */
async function texturedDocument() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const pos = doc
		.createAccessor()
		.setType('VEC3')
		.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]))
		.setBuffer(buffer);
	const uv = doc
		.createAccessor()
		.setType('VEC2')
		.setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]))
		.setBuffer(buffer);
	const idx = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buffer);
	const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 40, b: 40 } } })
		.png()
		.toBuffer();
	const webp = await sharp({ create: { width: 16, height: 8, channels: 3, background: { r: 128, g: 128, b: 255 } } })
		.webp({ quality: 92 })
		.toBuffer();
	doc.createExtension(EXTTextureWebP).setRequired(false);
	const material = doc
		.createMaterial('m')
		.setBaseColorTexture(doc.createTexture('albedo').setImage(new Uint8Array(png)).setMimeType('image/png'))
		.setNormalTexture(doc.createTexture('material_normal').setImage(new Uint8Array(webp)).setMimeType('image/webp'));
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', pos)
		.setAttribute('TEXCOORD_0', uv)
		.setIndices(idx)
		.setMaterial(material);
	doc.createScene().addChild(doc.createNode('quad').setMesh(doc.createMesh().addPrimitive(prim)));
	return doc;
}

/** The sample box as a meshopt + quantized GLB, the way the delivery pass writes them. */
async function compressedBoxGlb() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const g = new THREE.BoxGeometry(1, 2, 0.5);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(g.attributes.position.array).setBuffer(buffer))
		.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(g.attributes.normal.array).setBuffer(buffer))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.index.array)).setBuffer(buffer));
	doc.createScene().addChild(doc.createNode('box').setMesh(doc.createMesh().addPrimitive(prim)));
	await MeshoptEncoder.ready;
	await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize(), meshopt({ encoder: MeshoptEncoder }));
	return glbFromDocument(doc);
}

function glbJson(bytes) {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const len = dv.getUint32(12, true);
	return JSON.parse(Buffer.from(bytes.subarray(20, 20 + len)).toString('utf8'));
}

// The browser transcodes through its own image codec (canvas). Node has none,
// so the test hands the same contract a real codec: decode anything, emit PNG.
const transcodeToPng = async (bytes) => new Uint8Array(await sharp(Buffer.from(bytes)).png().toBuffer());

// ---- per-format round trips ------------------------------------------------

describe('geometry formats round-trip a model built in the test', () => {
	let meshes;
	beforeAll(() => {
		meshes = core.collectMeshes(sampleScene()).meshes;
	});

	it('collects world-space triangles from every mesh', () => {
		const { meshes: m, triangles, vertices } = core.collectMeshes(sampleScene());
		expect(m.map((x) => x.name)).toEqual(['body', 'knob']);
		expect(triangles).toBe(SAMPLE_TRIANGLES);
		expect(vertices).toBe(SAMPLE_VERTICES);
		// The knob's 2x X scale and offset are baked into its positions.
		const knob = m[1].position;
		let maxX = -Infinity;
		for (let i = 0; i < knob.length; i += 3) maxX = Math.max(maxX, knob[i]);
		expect(maxX).toBeCloseTo(0.8, 5);
	});

	it('OBJ: every vertex, normal, UV and triangle, Y-up meters as Blender expects', async () => {
		const bytes = await core.writeGeometryFormat('obj', meshes);
		const obj = readObj(new TextDecoder().decode(bytes));
		expect(obj.vertices).toBe(SAMPLE_VERTICES);
		expect(obj.normals).toBe(SAMPLE_VERTICES);
		expect(obj.uvs).toBe(SAMPLE_VERTICES);
		expect(obj.triangles).toBe(SAMPLE_TRIANGLES);
		expect(obj.objects).toEqual(['body', 'knob']);
		expect(obj.min[1]).toBeCloseTo(0, 5);
		expect(obj.max[1]).toBeCloseTo(2, 5);
	});

	it('STL: every triangle, binary layout exact', async () => {
		const stl = readBinaryStl(await core.writeGeometryFormat('stl', meshes));
		expect(stl.triangles).toBe(SAMPLE_TRIANGLES);
	});

	it('STL: Z-up millimetres resting on the bed, so a slicer opens it standing and printable', async () => {
		const stl = readBinaryStl(await core.writeGeometryFormat('stl', meshes));
		// The model is 2 m tall in glTF's Y. A slicer reads STL as Z-up mm, so
		// the export must put that height on Z, at the slicer's 100 mm auto size,
		// with the lowest point on the plate.
		expect(stl.min[2]).toBeCloseTo(0, 3);
		expect(stl.max[2]).toBeCloseTo(100, 2);
		expect(stl.max[2] - stl.min[2]).toBeGreaterThan(stl.max[0] - stl.min[0]);
		expect(stl.max[2] - stl.min[2]).toBeGreaterThan(stl.max[1] - stl.min[1]);
		// Centred on the plate origin in X and Y.
		expect((stl.min[0] + stl.max[0]) / 2).toBeCloseTo(0, 3);
		expect((stl.min[1] + stl.max[1]) / 2).toBeCloseTo(0, 3);
	});

	it('STL: placement matches the server slicer handoff exactly', async () => {
		const all = [];
		for (const m of meshes) all.push(...m.position);
		const server = placeOnBed(Float64Array.from(all));
		const stl = readBinaryStl(await core.writeGeometryFormat('stl', meshes));
		expect(stl.max[0] - stl.min[0]).toBeCloseTo(server.sizeMm[0], 2);
		expect(stl.max[1] - stl.min[1]).toBeCloseTo(server.sizeMm[1], 2);
		expect(stl.max[2] - stl.min[2]).toBeCloseTo(server.sizeMm[2], 2);
	});

	it('STL: a believable real-size object keeps its authored size', async () => {
		const scene = new THREE.Scene();
		scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.03), new THREE.MeshStandardMaterial()));
		scene.updateMatrixWorld(true);
		const stl = readBinaryStl(await core.writeGeometryFormat('stl', core.collectMeshes(scene).meshes));
		expect(stl.max[2] - stl.min[2]).toBeCloseTo(50, 2);
	});

	it('PLY: binary little-endian with every vertex, face, normal and UV', async () => {
		const ply = readBinaryPly(await core.writeGeometryFormat('ply', meshes));
		expect(ply.vertices).toBe(SAMPLE_VERTICES);
		expect(ply.faces).toBe(SAMPLE_TRIANGLES);
		expect(ply.props).toEqual(expect.arrayContaining(['x', 'y', 'z', 'nx', 'ny', 'nz', 's', 't']));
	});

	it('rejects a format it does not write', async () => {
		await expect(core.writeGeometryFormat('fbx', meshes)).rejects.toThrow(/fbx/);
	});

	it('the worker transfer shape round-trips: rebuilt scene has the same geometry', () => {
		const rebuilt = core.sceneFromMeshes(meshes);
		let tris = 0;
		rebuilt.traverse((o) => {
			if (o.isMesh) tris += o.geometry.index.count / 3;
		});
		expect(tris).toBe(SAMPLE_TRIANGLES);
	});

	it('a mirrored node keeps outward-facing triangles', () => {
		const scene = new THREE.Scene();
		const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
		m.scale.set(-1, 1, 1);
		scene.add(m);
		scene.updateMatrixWorld(true);
		const [out] = core.collectMeshes(scene).meshes;
		// First triangle's geometric normal must agree with its stored normal.
		const p = out.position;
		const i = out.index;
		const a = new THREE.Vector3().fromArray(p, i[0] * 3);
		const b = new THREE.Vector3().fromArray(p, i[1] * 3);
		const c = new THREE.Vector3().fromArray(p, i[2] * 3);
		const face = b.sub(a).cross(c.sub(a)).normalize();
		const stored = new THREE.Vector3().fromArray(out.normal, i[0] * 3);
		expect(face.dot(stored)).toBeGreaterThan(0.99);
	});
});

describe('USDZ is a valid AR package', () => {
	it('declares Y-up meters and carries every point', async () => {
		const usdz = readUsdz(await core.writeUsdz(sampleScene()));
		expect(usdz.root).toMatch(/upAxis = "Y"/);
		expect(usdz.root).toMatch(/metersPerUnit = 1/);
		expect(usdz.points).toBe(SAMPLE_VERTICES);
	});

	it('carries normals for a model saved without them (rigged output has none)', async () => {
		const scene = sampleScene();
		scene.traverse((o) => o.isMesh && o.geometry.deleteAttribute('normal'));
		const entries = unzipSync(await core.writeUsdz(scene));
		const geometry = Object.keys(entries)
			.filter((n) => n.endsWith('.usda'))
			.slice(1)
			.map((n) => strFromU8(entries[n]))
			.join('\n');
		expect(geometry).toMatch(/normal3f\[\] normals = \[/);
		// The caller's scene is not modified.
		scene.traverse((o) => o.isMesh && expect(o.geometry.attributes.normal).toBeUndefined());
	});
});

describe('reading the model to convert', () => {
	it('opens a meshopt-compressed GLB (the delivery variant format)', async () => {
		const bytes = await compressedBoxGlb();
		expect(glbJson(bytes).extensionsRequired).toContain('EXT_meshopt_compression');
		const scene = await core.parseGlb(bytes);
		const { triangles, meshes } = core.collectMeshes(scene);
		expect(triangles).toBe(12);
		// Quantized positions come back in meters, not raw integers.
		let maxY = -Infinity;
		for (let i = 1; i < meshes[0].position.length; i += 3) maxY = Math.max(maxY, meshes[0].position[i]);
		expect(maxY).toBeCloseTo(1, 2);
	});
});

describe('the default GLB download opens without special decoders', () => {
	it('re-encodes a WebP-only texture as PNG and drops EXT_texture_webp', async () => {
		const src = await glbFromDocument(await texturedDocument());
		expect(glbJson(src).extensionsUsed).toContain('EXT_texture_webp');
		const { bytes, transcoded } = await files.makeGlbPortable(src, { transcode: transcodeToPng });
		expect(transcoded).toBe(1);
		const json = glbJson(bytes);
		expect(json.extensionsUsed || []).not.toContain('EXT_texture_webp');
		for (const t of json.textures) {
			expect(t.source).toBeTypeOf('number');
			expect(json.images[t.source].mimeType).toBe('image/png');
		}
		// The Khronos validator, which is what every importer is held to.
		const report = await validator.validateBytes(new Uint8Array(bytes));
		expect(report.issues.numErrors).toBe(0);
		// The normal map survived: same size, now readable by any PNG decoder.
		await MeshoptDecoder.ready;
		const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
		const normal = doc.getRoot().listMaterials()[0].getNormalTexture();
		const meta = await sharp(Buffer.from(normal.getImage())).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['png', 16, 8]);
		// Geometry untouched.
		expect(doc.getRoot().listMeshes()[0].listPrimitives()[0].getIndices().getCount()).toBe(6);
	});

	it('leaves a file that already needs no decoder byte-for-byte alone', async () => {
		const doc = await texturedDocument();
		doc.getRoot()
			.listExtensionsUsed()
			.forEach((e) => e.dispose());
		for (const t of doc.getRoot().listTextures()) t.setMimeType('image/png').setImage(await transcodeToPng(t.getImage()));
		const src = await glbFromDocument(doc);
		const out = await files.makeGlbPortable(src, { transcode: transcodeToPng });
		expect(out.transcoded).toBe(0);
		expect(Buffer.compare(Buffer.from(out.bytes), Buffer.from(src))).toBe(0);
	});

	it('does not rewrite a compressed file the caller chose (Optimize offers those separately)', async () => {
		const src = await compressedBoxGlb();
		const out = await files.makeGlbPortable(src, { transcode: transcodeToPng });
		expect(out.transcoded).toBe(0);
		expect(out.reason).toMatch(/compressed/);
		expect(Buffer.compare(Buffer.from(out.bytes), Buffer.from(src))).toBe(0);
	});

	it('names what a file needs before an importer can read it', async () => {
		expect(files.glbDecodersNeeded(await compressedBoxGlb())).toEqual(
			expect.arrayContaining(['EXT_meshopt_compression', 'KHR_mesh_quantization']),
		);
		expect(files.glbDecodersNeeded(await glbFromDocument(await texturedDocument()))).toEqual(['EXT_texture_webp']);
	});
});

describe('the worker reads geometry without decoding images', () => {
	it('strips every texture reference and keeps the geometry', async () => {
		const src = await glbFromDocument(await texturedDocument());
		const out = files.withoutTextures(src);
		const json = glbJson(out);
		expect(json.textures).toBeUndefined();
		expect(json.images).toBeUndefined();
		expect(JSON.stringify(json.materials)).not.toMatch(/Texture/);
		expect(json.extensionsUsed || []).not.toContain('EXT_texture_webp');
		const report = await validator.validateBytes(new Uint8Array(out));
		expect(report.issues.numErrors).toBe(0);
		const scene = await core.parseGlb(out);
		expect(core.collectMeshes(scene).triangles).toBe(2);
	});
});

describe('file names and content types', () => {
	it('derives the name from the prompt with the right extension', () => {
		expect(files.exportFileName('A rusty go-kart with roll bar', 'stl')).toBe('A-rusty-go-kart-with-roll-bar.stl');
	});

	it('strips path characters and traversal', () => {
		for (const bad of ['../../etc/passwd', 'a/b\\c:d*e?f"g<h>i|j', '..', '/', 'C:\\Windows\\x']) {
			const name = files.exportFileName(bad, 'obj');
			expect(name).not.toMatch(/[/\\:*?"<>|]/);
			expect(name.startsWith('.')).toBe(false);
			expect(name.endsWith('.obj')).toBe(true);
		}
		expect(files.exportFileName('../../etc/passwd', 'obj')).toBe('etc-passwd.obj');
	});

	it('caps an overlong prompt without splitting a character', () => {
		const long = `${'castle tower '.repeat(40)}end`;
		const name = files.exportFileName(long, 'glb');
		expect(name.length).toBeLessThanOrEqual(files.MAX_BASENAME + 4);
		expect(name).toMatch(/^[a-z-]+\.glb$/i);
		expect(name).not.toMatch(/-\.glb$/);
		const emoji = files.exportFileName('🐉'.repeat(80), 'ply');
		expect(emoji).toBe('forge.ply');
	});

	it('keeps non-Latin prompts meaningful instead of collapsing to "forge"', () => {
		expect(files.exportFileName('明代将领，短小精悍', 'glb')).toBe('明代将领-短小精悍.glb');
		expect(files.exportFileName('Café crème', 'obj')).toBe('Café-crème.obj');
	});

	it('never produces a reserved Windows device name', () => {
		expect(files.exportFileName('CON', 'stl')).toBe('CON-model.stl');
		expect(files.exportFileName('nul', 'stl')).toBe('nul-model.stl');
	});

	it('falls back to "forge" for an empty or symbol-only prompt', () => {
		expect(files.exportFileName('', 'glb')).toBe('forge.glb');
		expect(files.exportFileName('***', 'glb')).toBe('forge.glb');
		expect(files.exportFileName(undefined, 'glb')).toBe('forge.glb');
	});

	it('reads the base name back from a download attribute', () => {
		expect(files.exportBaseName('My-model.glb')).toBe('My-model');
		expect(files.exportBaseName('')).toBe('forge');
	});

	it('labels every format with its registered content type', () => {
		expect(files.FORMAT_MIME).toMatchObject({
			glb: 'model/gltf-binary',
			obj: 'model/obj',
			stl: 'model/stl',
			ply: 'application/octet-stream',
			usdz: 'model/vnd.usdz+zip',
		});
	});
});

describe('large models fail honestly', () => {
	it('recognises the engine running out of memory', () => {
		expect(core.isOutOfMemory(new RangeError('Invalid string length'))).toBe(true);
		expect(core.isOutOfMemory(new RangeError('Array buffer allocation failed'))).toBe(true);
		expect(core.isOutOfMemory(new Error('Out of memory'))).toBe(true);
		expect(core.isOutOfMemory(new Error('fetch 404'))).toBe(false);
	});

	it('explains what to do instead, with the model size', () => {
		const msg = core.tooLargeMessage('obj', 2_400_000);
		expect(msg).toMatch(/2,400,000 triangles/);
		expect(msg).toMatch(/GLB/);
	});
});
