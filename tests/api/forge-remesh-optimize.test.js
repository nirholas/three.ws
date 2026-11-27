// /api/forge-remesh "Optimize": the triangle path must return a smaller model
// that still looks like the original. Before this, a triangle request went to
// the remesh worker, whose open3d rebuild keeps positions and faces only: a
// textured 2.5 MB model came back as a grey 0.6 MB one with no UVs, material or
// texture, a rigged one lost its skeleton, and a light model could come back
// heavier than it went in. These tests drive the real handler and the real
// optimizer (gltf-transform, meshoptimizer, sharp) on GLBs built here; only the
// network edges (the model fetch, object storage, the worker, the rate limiter)
// are replaced.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

const h = vi.hoisted(() => ({
	sources: new Map(),
	store: new Map(),
	submit: vi.fn(),
	refund: vi.fn(),
	mirror: vi.fn(),
	fetchError: null,
}));

vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		supportsMode: () => true,
		submit: (...args) => h.submit(...args),
		status: async () => ({ status: 'running' }),
	}),
}));

vi.mock('../../api/_lib/fetch-model.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		fetchModel: async (url, { maxBytes } = {}) => {
			if (h.fetchError) throw h.fetchError;
			const bytes = h.sources.get(url);
			if (!bytes) throw new actual.FetchModelError('upstream returned 404', 'upstream_error');
			if (bytes.byteLength > maxBytes) {
				throw new actual.FetchModelError(`file too large (${bytes.byteLength} > ${maxBytes} bytes)`, 'file_too_large');
			}
			return { bytes, url, contentType: 'model/gltf-binary', filename: 'model.glb' };
		},
	};
});

vi.mock('../../api/_lib/ssrf.js', async (importOriginal) => ({
	...(await importOriginal()),
	assertPublicHttpsUrl: async (raw) => new URL(raw).href,
}));

vi.mock('../../api/_lib/r2.js', () => ({
	putObject: async ({ key, body }) => {
		h.store.set(key, Buffer.from(body));
	},
	getObjectBuffer: async (key) => {
		if (!h.store.has(key)) throw new Error('NoSuchKey');
		return h.store.get(key);
	},
	publicUrl: (key) => `https://three.ws/cdn/${key}`,
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		mcp3dGenerate: async () => ({ success: true }),
		mcp3dGenerateRefund: (...args) => h.refund(...args),
		mcp3dStatus: async () => ({ success: true }),
	},
	clientIp: () => '203.0.113.7',
	refundOnServerFailure: () => {},
}));

vi.mock('../../api/_lib/mirror-r2.js', () => ({
	mirrorToR2: (...args) => h.mirror(...args),
}));

let remesh;
let io;
const URLS = {
	heavy: 'https://models.example/heavy.glb',
	rigged: 'https://models.example/rigged.glb',
	light: 'https://models.example/light.glb',
	huge: 'https://models.example/huge.glb',
};

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function post(body) {
	const r = Readable.from([Buffer.from(JSON.stringify(body))]);
	r.method = 'POST';
	r.url = '/api/forge-remesh';
	r.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
	r.__twxCreator = { user: { id: 'qa-user' }, platform: false };
	return r;
}

function get(query) {
	const r = Readable.from([]);
	r.method = 'GET';
	r.url = `/api/forge-remesh?${query}`;
	r.headers = { origin: 'http://localhost:3000' };
	return r;
}

async function call(req) {
	const res = mockRes();
	await remesh(req, res);
	return res;
}

// A wavy n x n grid: 2n^2 triangles, UVs, normals, and a textured material.
async function buildGlb({ n, texture, rigged = false }) {
	const { Document } = await import('@gltf-transform/core');
	const doc = new Document();
	const buffer = doc.createBuffer();
	const verts = (n + 1) * (n + 1);
	const pos = new Float32Array(verts * 3);
	const uv = new Float32Array(verts * 2);
	const nrm = new Float32Array(verts * 3);
	const joints = new Uint16Array(verts * 4);
	const weights = new Float32Array(verts * 4);
	for (let y = 0; y <= n; y++) {
		for (let x = 0; x <= n; x++) {
			const i = y * (n + 1) + x;
			const u = x / n;
			const v = y / n;
			pos.set([u - 0.5, v - 0.5, 0.04 * Math.sin(u * 9) * Math.cos(v * 7)], i * 3);
			uv.set([u, v], i * 2);
			nrm.set([0, 0, 1], i * 3);
			joints.set([0, 1, 0, 0], i * 4);
			weights.set([1 - v, v, 0, 0], i * 4);
		}
	}
	const idx = new Uint32Array(n * n * 6);
	let k = 0;
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const a = y * (n + 1) + x;
			const b = a + 1;
			const c = a + n + 1;
			const d = c + 1;
			idx.set([a, b, d, a, d, c], k);
			k += 6;
		}
	}
	const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', acc('VEC3', pos))
		.setAttribute('NORMAL', acc('VEC3', nrm))
		.setAttribute('TEXCOORD_0', acc('VEC2', uv))
		.setIndices(acc('SCALAR', idx));
	const tex = doc.createTexture('albedo').setImage(texture.bytes).setMimeType(texture.mime);
	prim.setMaterial(doc.createMaterial('paint').setBaseColorTexture(tex));
	const mesh = doc.createMesh('grid').addPrimitive(prim);
	const node = doc.createNode('model').setMesh(mesh);
	const scene = doc.createScene().addChild(node);
	if (rigged) {
		prim.setAttribute('JOINTS_0', acc('VEC4', joints)).setAttribute('WEIGHTS_0', acc('VEC4', weights));
		const root = doc.createNode('hips');
		const tip = doc.createNode('spine').setTranslation([0, 0.5, 0]);
		root.addChild(tip);
		scene.addChild(root);
		const skin = doc.createSkin('rig').addJoint(root).addJoint(tip);
		skin.setInverseBindMatrices(
			acc('MAT4', new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.5, 0, 1])),
		);
		node.setSkin(skin);
		const sampler = doc
			.createAnimationSampler()
			.setInput(acc('SCALAR', new Float32Array([0, 1])))
			.setOutput(acc('VEC4', new Float32Array([0, 0, 0, 1, 0, 0, 0.38, 0.92])));
		const channel = doc.createAnimationChannel().setTargetNode(tip).setTargetPath('rotation').setSampler(sampler);
		doc.createAnimation('bend').addSampler(sampler).addChannel(channel);
	}
	return io.writeBinary(doc);
}

// Noise compresses badly as PNG, like a real baked albedo.
async function noiseTexture(size, format) {
	const sharp = (await import('sharp')).default;
	const raw = Buffer.alloc(size * size * 3);
	let seed = 7;
	for (let i = 0; i < raw.length; i++) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		raw[i] = (seed >> 16) & 0xff;
	}
	const img = sharp(raw, { raw: { width: size, height: size, channels: 3 } }).blur(1.2);
	const bytes = format === 'jpeg' ? await img.jpeg({ quality: 70 }).toBuffer() : await img.png().toBuffer();
	return { bytes: new Uint8Array(bytes), mime: format === 'jpeg' ? 'image/jpeg' : 'image/png' };
}

async function readStored(url) {
	const key = url.replace('https://three.ws/cdn/', '');
	const bytes = h.store.get(key);
	expect(bytes, `stored object ${key}`).toBeTruthy();
	return { bytes, doc: await io.readBinary(new Uint8Array(bytes)) };
}

const primitivesOf = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	const { NodeIO } = await import('@gltf-transform/core');
	const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
	const { MeshoptDecoder } = await import('meshoptimizer');
	await MeshoptDecoder.ready;
	io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
	const png = await noiseTexture(512, 'png');
	h.sources.set(URLS.heavy, await buildGlb({ n: 100, texture: png }));
	h.sources.set(URLS.rigged, await buildGlb({ n: 100, texture: png, rigged: true }));
	h.sources.set(URLS.light, await buildGlb({ n: 10, texture: await noiseTexture(64, 'jpeg') }));
	remesh = (await import('../../api/forge-remesh.js')).default;
}, 60_000);

beforeEach(() => {
	h.store.clear();
	h.submit.mockReset();
	h.submit.mockResolvedValue({ extJobId: 'worker-job-0123456789abcdef', eta: 60 });
	h.refund.mockReset();
	h.mirror.mockReset();
	h.fetchError = null;
});

describe('triangle Optimize keeps the look', () => {
	it('returns a smaller GLB that keeps its UVs, material and texture, without a worker job', async () => {
		const res = await call(post({ mesh_url: URLS.heavy, remesh_mode: 'triangle', target_faces: 5000, output_format: 'glb' }));
		expect(res.statusCode).toBe(200);
		const body = res.json;
		expect(body).toMatchObject({ status: 'done', noop: false, textured: true });
		expect(body.job_id).toMatch(/^opt_[a-f0-9]{40}$/);
		expect(h.submit).not.toHaveBeenCalled();

		expect(body.before.triangles).toBe(20_000);
		expect(body.after.triangles).toBeLessThanOrEqual(5_000);
		expect(body.after.bytes).toBeLessThan(body.before.bytes);
		expect(body.face_count).toBe(body.after.triangles);

		const { bytes, doc } = await readStored(body.result_url);
		expect(bytes.byteLength).toBe(body.after.bytes);
		const prims = primitivesOf(doc);
		expect(prims.every((p) => p.getAttribute('TEXCOORD_0'))).toBe(true);
		expect(prims.every((p) => p.getMaterial()?.getBaseColorTexture())).toBe(true);
		expect(doc.getRoot().listMaterials()).toHaveLength(1);
		// The default download opens in any glTF reader.
		expect(doc.getRoot().listExtensionsUsed()).toHaveLength(0);
		expect(body.requires).toEqual([]);
	}, 60_000);

	it('keeps the skeleton, the skin weights and the animation of a rigged model', async () => {
		const res = await call(post({ mesh_url: URLS.rigged, remesh_mode: 'triangle', target_faces: 4000 }));
		expect(res.statusCode).toBe(200);
		expect(res.json.after).toMatchObject({ skins: 1, joints: 2, animations: 1 });
		const { doc } = await readStored(res.json.result_url);
		const [skin] = doc.getRoot().listSkins();
		expect(skin.listJoints().map((j) => j.getName())).toEqual(['hips', 'spine']);
		const skinned = doc.getRoot().listNodes().find((n) => n.getSkin());
		expect(skinned?.getSkin()).toBe(skin);
		for (const prim of primitivesOf(doc)) {
			expect(prim.getAttribute('JOINTS_0')).toBeTruthy();
			expect(prim.getAttribute('WEIGHTS_0').getCount()).toBe(prim.getAttribute('POSITION').getCount());
		}
		expect(doc.getRoot().listAnimations()[0].listChannels()[0].getTargetNode().getName()).toBe('spine');
	}, 60_000);

	it('answers "already light" with the original and no worker call when nothing would shrink', async () => {
		const res = await call(post({ mesh_url: URLS.light, remesh_mode: 'triangle', target_faces: 20_000 }));
		expect(res.statusCode).toBe(200);
		expect(res.json).toMatchObject({ status: 'done', noop: true, result_url: URLS.light });
		expect(res.json.reason).toMatch(/already light/i);
		expect(h.submit).not.toHaveBeenCalled();
		expect(h.refund).toHaveBeenCalledWith('user:qa-user');
		expect([...h.store.keys()].filter((k) => k.endsWith('.glb'))).toEqual([]);
	}, 60_000);

	it('serves the same record to a poll, and to a world poll as durable without copying', async () => {
		const first = (await call(post({ mesh_url: URLS.heavy, target_faces: 5000 }))).json;
		const polled = (await call(get(`job=${first.job_id}`))).json;
		expect(polled).toMatchObject({ status: 'done', result_url: first.result_url, face_count: first.face_count });
		const world = (await call(get(`job=${first.job_id}&mirror=r2`))).json;
		expect(world).toMatchObject({ status: 'done', result_url: first.result_url, durable: true });
		expect(h.mirror).not.toHaveBeenCalled();
	}, 60_000);

	it('labels a compressed variant with the extensions a reader needs, beside the universal file', async () => {
		const res = await call(post({ mesh_url: URLS.heavy, target_faces: 5000, compression: 'meshopt' }));
		const body = res.json;
		expect(body.compression).toBe('meshopt');
		expect(body.requires).toContain('EXT_meshopt_compression');
		expect(body.compressed_url).toMatch(/-meshopt\.glb$/);
		const variant = await readStored(body.compressed_url);
		const universal = await readStored(body.universal_url);
		expect(variant.bytes.byteLength).toBeLessThan(universal.bytes.byteLength);
		expect(universal.doc.getRoot().listExtensionsUsed()).toHaveLength(0);
		expect(body.result_url).toBe(body.universal_url);
	}, 60_000);
});

describe('guards', () => {
	it('refuses a model over the size limit and states the limit', async () => {
		h.sources.set(URLS.huge, new Uint8Array(65 * 1024 * 1024));
		const res = await call(post({ mesh_url: URLS.huge, remesh_mode: 'triangle' }));
		h.sources.delete(URLS.huge);
		expect(res.statusCode).toBe(413);
		expect(res.json.error).toBe('mesh_too_large');
		expect(res.json.message).toMatch(/64 MB/);
		expect(h.submit).not.toHaveBeenCalled();
	});

	it('clamps an absurd target and says so', async () => {
		const res = await call(post({ mesh_url: URLS.heavy, target_faces: 10_000_000 }));
		expect(res.json.target_faces).toBe(500_000);
		expect(res.json.notes.join(' ')).toMatch(/lowered to the maximum of 500,000/);
		const junk = await call(post({ mesh_url: URLS.heavy, target_faces: 'lots' }));
		expect(junk.json.notes.join(' ')).toMatch(/not a positive number/);
	}, 60_000);

	it('refuses quad and low-poly on a rigged model instead of dropping its skeleton', async () => {
		for (const mode of ['quad', 'lowpoly']) {
			const res = await call(post({ mesh_url: URLS.rigged, remesh_mode: mode }));
			expect(res.statusCode).toBe(422);
			expect(res.json.error).toBe('rigged_model');
			expect(res.json.message).toMatch(/Triangle/);
		}
		expect(h.submit).not.toHaveBeenCalled();
	});

	it('clamps a quad target to half the source triangles so the result is not heavier', async () => {
		const res = await call(post({ mesh_url: URLS.heavy, remesh_mode: 'quad', target_faces: 40_000 }));
		expect(res.statusCode).toBe(202);
		expect(h.submit.mock.calls[0][0].params.target_faces).toBe(10_000);
		expect(res.json.notes.join(' ')).toMatch(/lowered to 10,000/);
	});

	it('keeps a light model as it is in quad and low-poly instead of inflating it', async () => {
		for (const mode of ['quad', 'lowpoly']) {
			const res = await call(post({ mesh_url: URLS.light, remesh_mode: mode, target_faces: 5000 }));
			expect(res.statusCode).toBe(200);
			expect(res.json).toMatchObject({ noop: true, result_url: URLS.light });
		}
		expect(h.submit).not.toHaveBeenCalled();
	});

	it('optimizes before a format conversion, so the worker only converts', async () => {
		const res = await call(post({ mesh_url: URLS.rigged, target_faces: 4000, output_format: 'fbx' }));
		expect(res.statusCode).toBe(202);
		const { sourceUrl, params } = h.submit.mock.calls[0][0];
		expect(params).toMatchObject({ operation: 'convert', output_format: 'fbx', remesh_mode: 'triangle' });
		expect(sourceUrl).toMatch(/^https:\/\/three\.ws\/cdn\/forge\/optimized\/[a-f0-9]{40}\.glb$/);
		expect(res.json.after.skins).toBe(1);
	}, 60_000);
});
