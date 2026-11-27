/**
 * POST /api/gpt-forge?action=rig (the ChatGPT surface's copy of the rig tool)
 * runs the same preflight as /api/forge?action=rig before any worker call.
 *
 * Found 2026-11-27 while fixing the /forge rig tool: the clone still handed
 * every URL straight to the rigger, so a katana came back with a human
 * skeleton, a Draco or meshopt upload reached a worker that cannot decode it,
 * and nothing named the subject. These tests pin the clone to the shared
 * preflight in api/_lib/rig-preflight.js.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { boxGlb as glbOf, FIGURE } from './helpers/rig-box-glb.js';
import { compressGlb } from '../api/_lib/glb-compress.js';

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'gpt-test-user' }),
	getSessionUser: async () => ({ id: 'gpt-test-user' }),
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

vi.mock('../api/_lib/forge-store.js', async (importActual) => ({
	...(await importActual()),
	createCreation: vi.fn(async () => 'creation-1'),
	forgeStoreEnabled: () => false,
}));

const served = new Map();
vi.mock('../api/_lib/fetch-model.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		fetchModel: vi.fn(async (url) => {
			const entry = served.get(url);
			if (!entry) throw new actual.FetchModelError('upstream returned 404', 'upstream_error');
			return { bytes: entry, contentType: 'model/gltf-binary', finalUrl: url };
		}),
	};
});

const stored = [];
vi.mock('../api/_lib/r2.js', async (importActual) => ({
	...(await importActual()),
	objectStorageConfigured: () => true,
	putObject: vi.fn(async (obj) => {
		stored.push(obj);
	}),
	cdnUrl: (key) => `https://three.ws/cdn/${key}`,
}));

const refund = vi.fn(async () => {});
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateRefund: (...args) => refund(...args),
		},
		clientIp: () => '203.0.113.9',
	};
});

const { default: handler } = await import('../api/gpt-forge.js');

const BLADE = [{ size: [0.03, 1, 0.005] }];

function glbJson(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const len = view.getUint32(12, true);
	return JSON.parse(Buffer.from(bytes.subarray(20, 20 + len)).toString('utf8'));
}

async function rig(payload) {
	const buf = Buffer.from(JSON.stringify(payload));
	const req = Readable.from([buf]);
	req.method = 'POST';
	req.url = '/api/gpt-forge?action=rig';
	req.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', 'content-length': String(buf.length) };
	const res = {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this.headers[String(k).toLowerCase()]; },
		end(b) { this.body = b ?? null; },
	};
	await handler(req, res);
	return { status: res.statusCode, body: JSON.parse(res.body) };
}

beforeEach(() => {
	submit.mockClear();
	refund.mockClear();
	served.clear();
	stored.length = 0;
});

describe('gpt-forge rig runs the rig preflight', () => {
	it('refuses a limbless object before any worker call and gives the allowance back', async () => {
		const url = 'https://cdn.example/uploads/katana.glb';
		served.set(url, await glbOf(BLADE));

		const { status, body } = await rig({ glb_url: url, prompt: 'a katana with a steel blade' });

		expect(status).toBe(422);
		expect(body.error).toBe('rig_not_riggable');
		expect(body.message).toMatch(/katana/);
		expect(submit).not.toHaveBeenCalled();
		expect(refund).toHaveBeenCalledWith('user:gpt-test-user');
	});

	it('decodes a Draco model and sends the worker the plain copy with the subject', async () => {
		const url = 'https://cdn.example/uploads/figure-draco.glb';
		const { buffer } = await compressGlb(await glbOf(FIGURE), { mode: 'draco' });
		served.set(url, new Uint8Array(buffer));

		const { status, body } = await rig({ glb_url: url, prompt: 'a knight in plate armour' });

		expect(status).toBe(200);
		expect(stored).toHaveLength(1);
		expect(glbJson(new Uint8Array(stored[0].body)).extensionsUsed ?? []).not.toContain('KHR_draco_mesh_compression');
		expect(submit).toHaveBeenCalledTimes(1);
		expect(submit.mock.calls[0][0]).toMatchObject({
			sourceUrl: `https://three.ws/cdn/${stored[0].key}`,
			params: { subject: 'humanoid' },
		});
		expect(body.source_glb_url).toBe(url);
		expect(body.subject).toBe('humanoid');
	});
});
