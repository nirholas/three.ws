/**
 * POST /api/forge?action=rig checks a model before any rig worker is called.
 *
 * Measured on production 2026-11-27: a katana and a pair of boots both came
 * back from the rig tool "done" with a 52-bone human skeleton, because the
 * worker's only test is "tall and left-right symmetric". And the rig workers
 * load meshes with trimesh, which reads neither Draco nor meshopt geometry, so
 * a compressed upload reached the worker undecodable. These tests pin the
 * preflight that now sits in front of the worker:
 *   - a limbless object is refused with 422 before provider.submit runs, with a
 *     sentence that says why and what to do instead, and the allowance is given back;
 *   - a Draco or meshopt input is decoded to a plain GLB, stored, and the worker
 *     is handed the decoded copy;
 *   - an already-rigged model, an oversized model and a multi-piece model are
 *     refused with the reason (and the limit, for size);
 *   - the subject the words name (humanoid or creature) is forwarded to the worker.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { Document, NodeIO } from '@gltf-transform/core';
import { compressGlb } from '../api/_lib/glb-compress.js';

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		REPLICATE_API_TOKEN: 'test-token',
		REPLICATE_RERIG_MODEL: 'example/rigger',
	});
	delete process.env.GCP_RECONSTRUCTION_KEY;
});

vi.mock('node:dns', async (importActual) => {
	const actual = await importActual();
	const lookup = async (host) => {
		if (host === 'cdn.example') return [{ address: '93.184.216.34', family: 4 }];
		const err = new Error(`getaddrinfo ENOTFOUND ${host}`);
		err.code = 'ENOTFOUND';
		throw err;
	};
	return { ...actual, default: { ...actual, promises: { ...actual.promises, lookup } }, promises: { ...actual.promises, lookup } };
});

const submit = vi.fn(async () => ({ extJobId: 'abcdef0123456789' }));
vi.mock('../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({ supportsMode: (m) => m === 'rerig', submit }),
}));

vi.mock('../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(),
	markFailed: vi.fn(),
	findByJob: vi.fn(async () => null),
	forgeStoreEnabled: () => true,
}));

// The creation prompt lookup reads forge_creations by id.
const storedPrompts = new Map();
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		sql: vi.fn(async (_strings, ...values) => {
			const prompt = storedPrompts.get(values[0]);
			return prompt ? [{ prompt }] : [];
		}),
	};
});

// The model bytes each test URL answers with. fetchModel's own SSRF and size
// rules are covered by tests/fetch-model*.test.js; here the URL is public.
const served = new Map();
vi.mock('../api/_lib/fetch-model.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		fetchModel: vi.fn(async (url) => {
			const entry = served.get(url);
			if (entry instanceof Error) throw entry;
			if (!entry) throw new actual.FetchModelError('upstream returned 404', 'upstream_error');
			return { bytes: entry, contentType: 'model/gltf-binary', finalUrl: url };
		}),
	};
});

const stored = [];
vi.mock('../api/_lib/r2.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		objectStorageConfigured: () => true,
		putObject: vi.fn(async (obj) => {
			stored.push(obj);
		}),
		cdnUrl: (key) => `https://three.ws/cdn/${key}`,
	};
});

const refund = vi.fn(async () => {});
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateGlobal: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateRefund: (...args) => refund(...args),
		},
		clientIp: () => '203.0.113.9',
	};
});

vi.mock('../api/_lib/forge-scale.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, dailyPaidAllowed: vi.fn(async () => ({ ok: true })), dailyPaidRefund: vi.fn(async () => {}) };
});

const { default: handler } = await import('../api/forge.js');

// ── Fixtures: real GLBs built in memory ──────────────────────────────────────

// An axis-aligned box as 12 triangles, offset by `at`.
function boxGeometry([sx, sy, sz], at = [0, 0, 0]) {
	const p = [];
	for (const x of [0, sx]) for (const y of [0, sy]) for (const z of [0, sz]) p.push(x + at[0], y + at[1], z + at[2]);
	const quads = [
		[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
	];
	const idx = [];
	for (const [a, b, c, d] of quads) idx.push(a, b, c, a, c, d);
	return { positions: p, indices: idx };
}

async function glbOf(boxes, { skinned = false } = {}) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const positions = [];
	const indices = [];
	for (const b of boxes) {
		const g = boxGeometry(b.size, b.at);
		const base = positions.length / 3;
		positions.push(...g.positions);
		indices.push(...g.indices.map((i) => i + base));
	}
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer));
	const node = doc.createNode('model').setMesh(doc.createMesh('model').addPrimitive(prim));
	const scene = doc.createScene().addChild(node);
	if (skinned) {
		const n = positions.length / 3;
		prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(n * 4)).setBuffer(buffer));
		const w = new Float32Array(n * 4);
		for (let i = 0; i < n; i += 1) w[i * 4] = 1;
		prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(w).setBuffer(buffer));
		const hips = doc.createNode('Hips');
		scene.addChild(hips);
		const ibm = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
		node.setSkin(
			doc
				.createSkin('rig')
				.addJoint(hips)
				.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer)),
		);
	}
	return new NodeIO().writeBinary(doc);
}

// A standing figure: torso block plus two legs that touch it.
const FIGURE = [
	{ size: [0.5, 0.9, 0.3], at: [0, 0.9, 0] },
	{ size: [0.2, 0.9, 0.25], at: [0.02, 0, 0.02] },
	{ size: [0.2, 0.9, 0.25], at: [0.28, 0, 0.02] },
];
// A blade: one metre long, three centimetres wide, half a centimetre thick.
const BLADE = [{ size: [0.03, 1, 0.005] }];
// Two equal blocks five metres apart.
const TWO_APART = [{ size: [1, 1, 1] }, { size: [1, 1, 1], at: [5, 0, 0] }];

function glbJson(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const len = view.getUint32(12, true);
	return JSON.parse(Buffer.from(bytes.subarray(20, 20 + len)).toString('utf8'));
}

// ── Handler plumbing ─────────────────────────────────────────────────────────

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
		getHeader(name) { return this.headers[String(name).toLowerCase()]; },
		end(body) { this.body = body ?? null; },
	};
}

function makeReq(payload) {
	const buf = Buffer.from(JSON.stringify(payload));
	const req = Readable.from([buf]);
	req.method = 'POST';
	req.url = '/api/forge?action=rig';
	req.headers = { 'content-type': 'application/json', 'content-length': String(buf.length), 'x-forge-client': 'tester' };
	return req;
}

async function rig(payload) {
	const res = makeRes();
	await handler(makeReq(payload), res);
	return { status: res.statusCode, body: JSON.parse(res.body) };
}

beforeEach(() => {
	submit.mockClear();
	refund.mockClear();
	served.clear();
	storedPrompts.clear();
	stored.length = 0;
});

describe('rig preflight refuses what cannot be rigged, before any worker call', () => {
	it('refuses a model made as an object with 422 rig_not_riggable, says why and what to do, and calls no worker', async () => {
		const id = '11111111-2222-4333-8444-555555555555';
		const url = `https://cdn.example/cdn/forge/abc123/${id}.glb`;
		served.set(url, await glbOf(BLADE));
		storedPrompts.set(id, 'a katana with a black wrapped hilt and a polished steel blade');

		const { status, body } = await rig({ glb_url: url });

		expect(status).toBe(422);
		expect(body.error).toBe('rig_not_riggable');
		expect(body.message).toMatch(/katana, which has no limbs to move/);
		expect(body.message).toMatch(/generate a character holding or wearing it/);
		expect(submit).not.toHaveBeenCalled();
		expect(refund).toHaveBeenCalledWith('user:forge-test-user');
	});

	it('refuses a limbless rod by shape when nothing names what it is', async () => {
		const url = 'https://cdn.example/uploads/rod.glb';
		served.set(url, await glbOf(BLADE));

		const { status, body } = await rig({ glb_url: url });

		expect(status).toBe(422);
		expect(body.error).toBe('rig_not_riggable');
		expect(body.message).toMatch(/thin rod or flat panel/);
		expect(submit).not.toHaveBeenCalled();
	});

	it('uses the prompt the caller sends when the URL carries no creation id', async () => {
		const url = 'https://cdn.example/uploads/figure.glb';
		served.set(url, await glbOf(FIGURE));

		const { status, body } = await rig({ glb_url: url, prompt: 'a wooden dining chair' });

		expect(status).toBe(422);
		expect(body.error).toBe('rig_not_riggable');
		expect(body.message).toMatch(/chair/);
		expect(submit).not.toHaveBeenCalled();
	});

	it('answers 409 already_rigged with the joint count for a model that has a skeleton', async () => {
		const url = 'https://cdn.example/uploads/rigged.glb';
		served.set(url, await glbOf(FIGURE, { skinned: true }));

		const { status, body } = await rig({ glb_url: url, prompt: 'a knight in plate armour' });

		expect(status).toBe(409);
		expect(body.error).toBe('already_rigged');
		expect(body.joint_count).toBe(1);
		expect(body.glb_url).toBe(url);
		expect(submit).not.toHaveBeenCalled();
		expect(refund).toHaveBeenCalled();
	});

	it('refuses an oversized model with 413 and states the limit', async () => {
		const { FetchModelError } = await import('../api/_lib/fetch-model.js');
		const url = 'https://cdn.example/uploads/huge.glb';
		served.set(url, new FetchModelError('file too large (90000000 > 67108864 bytes)', 'file_too_large'));

		const { status, body } = await rig({ glb_url: url });

		expect(status).toBe(413);
		expect(body.error).toBe('rig_too_large');
		expect(body.limit_bytes).toBe(64 * 1024 * 1024);
		expect(body.message).toMatch(/up to 64 MB/);
		expect(submit).not.toHaveBeenCalled();
	});

	it('refuses two separate figures with 422 rig_multiple_pieces and points at Segment', async () => {
		const url = 'https://cdn.example/uploads/pair.glb';
		served.set(url, await glbOf(TWO_APART));

		const { status, body } = await rig({ glb_url: url, prompt: 'two robots standing side by side' });

		expect(status).toBe(422);
		expect(body.error).toBe('rig_multiple_pieces');
		expect(body.message).toMatch(/Segment/);
		expect(submit).not.toHaveBeenCalled();
	});

	it('refuses a file that is not a GLB with 422 rig_invalid_model', async () => {
		const url = 'https://cdn.example/uploads/notes.glb';
		served.set(url, new TextEncoder().encode('this is plainly not a binary glTF file at all'));

		const { status, body } = await rig({ glb_url: url });

		expect(status).toBe(422);
		expect(body.error).toBe('rig_invalid_model');
		expect(submit).not.toHaveBeenCalled();
	});
});

describe('rig preflight prepares what can be rigged', () => {
	it.each(['draco', 'meshopt'])('decodes a %s-compressed model and hands the worker the plain copy', async (mode) => {
		const url = `https://cdn.example/uploads/figure-${mode}.glb`;
		const { buffer, extensionsUsed } = await compressGlb(await glbOf(FIGURE), { mode });
		expect(extensionsUsed.length).toBeGreaterThan(0);
		served.set(url, new Uint8Array(buffer));

		const { status, body } = await rig({ glb_url: url, prompt: 'a knight in plate armour' });

		expect(status).toBe(200);
		expect(stored).toHaveLength(1);
		expect(stored[0].key).toMatch(/^forge\/rig-input\/[0-9a-f]{32}\.glb$/);
		const plain = new Uint8Array(stored[0].body);
		const json = glbJson(plain);
		expect(json.extensionsUsed ?? []).not.toContain('KHR_draco_mesh_compression');
		expect(json.extensionsUsed ?? []).not.toContain('EXT_meshopt_compression');
		expect(json.extensionsUsed ?? []).not.toContain('KHR_mesh_quantization');
		expect(json.accessors.find((a) => a.type === 'VEC3').componentType).toBe(5126);

		expect(submit).toHaveBeenCalledTimes(1);
		const sent = submit.mock.calls[0][0];
		expect(sent.sourceUrl).toBe(`https://three.ws/cdn/${stored[0].key}`);
		expect(body.source_glb_url).toBe(url);
	});

	it('hands an uncompressed model over unchanged, without storing a copy', async () => {
		const url = 'https://cdn.example/uploads/figure.glb';
		served.set(url, await glbOf(FIGURE));

		const { status } = await rig({ glb_url: url, prompt: 'a knight in plate armour' });

		expect(status).toBe(200);
		expect(stored).toHaveLength(0);
		expect(submit.mock.calls[0][0].sourceUrl).toBe(url);
	});

	it.each([
		['a knight in plate armour', 'humanoid'],
		['a mecha hound with glowing eyes', 'creature'],
	])('forwards the subject the words name (%s) to the worker', async (prompt, subject) => {
		const url = 'https://cdn.example/uploads/figure.glb';
		served.set(url, await glbOf(FIGURE));

		const { status, body } = await rig({ glb_url: url, prompt });

		expect(status).toBe(200);
		expect(submit.mock.calls[0][0].params).toEqual({ subject });
		expect(body.subject).toBe(subject);
	});

	it('reads the subject from the stored creation prompt, not from what the caller claims', async () => {
		const id = '99999999-8888-4777-8666-555555555555';
		const url = `https://cdn.example/cdn/forge/abc123/${id}.glb`;
		served.set(url, await glbOf(FIGURE));
		storedPrompts.set(id, 'a mecha hound with glowing eyes');

		const { status } = await rig({ glb_url: url, prompt: 'a knight in plate armour' });

		expect(status).toBe(200);
		expect(submit.mock.calls[0][0].params).toEqual({ subject: 'creature' });
	});

	it('leaves the subject to the worker when the words say nothing', async () => {
		const url = 'https://cdn.example/uploads/figure.glb';
		served.set(url, await glbOf(FIGURE));

		const { status } = await rig({ glb_url: url });

		expect(status).toBe(200);
		expect(submit.mock.calls[0][0].params).toEqual({});
	});
});
