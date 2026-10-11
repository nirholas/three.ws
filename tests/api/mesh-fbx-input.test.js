/**
 * FBX input on the trimesh-based mesh lanes (stylize and segment).
 *
 * workers/stylize and workers/segment read meshes with trimesh, which has no
 * FBX reader, and neither image carries a converter. An FBX used to be
 * accepted, queued, and then fail inside the worker as an opaque internal
 * error. The REST routes and the MCP tools now refuse it up front with the
 * formats that work and the way to convert, and never reach the worker.
 *
 * The SSRF guards (DNS), the rate limiter, the DB, and the GCP provider
 * (network) are the mocked boundaries; the real handlers, tool handlers, and
 * input check run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		mcp3dGenerate: async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 }),
		mcp3dStatus: async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 }),
	},
	clientIp: () => '203.0.113.9',
}));

vi.mock('../../api/_lib/db.js', () => ({
	sql: async () => [],
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: async () => ({ pressured: false }),
}));

// The MCP tools check URLs through ssrf-guard, the REST routes through ssrf.
vi.mock('../../api/_lib/ssrf-guard.js', async (importOriginal) => ({
	...(await importOriginal()),
	assertSafePublicUrl: async (raw) => new URL(raw),
}));

class FakeSsrfError extends Error {}
vi.mock('../../api/_lib/ssrf.js', () => ({
	SsrfError: FakeSsrfError,
	assertPublicHttpsUrl: async (raw) => {
		if (typeof raw !== 'string' || !raw.startsWith('https://')) throw new FakeSsrfError('must be https');
		return new URL(raw).href;
	},
}));

const submitted = [];
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		supportsMode: () => true,
		submit: async (request) => {
			submitted.push(request);
			return { extJobId: 'job-mesh-input-test-000000000000', eta: 20 };
		},
	}),
}));

const { isFbxMeshUrl, fbxUnsupportedMessage, MESH_INPUT_FORMATS, STYLIZE_FBX_MESSAGE, SEGMENT_FBX_MESSAGE } =
	await import('../../api/_lib/mesh-input.js');

const AUTH = { userId: null, rateKey: 'test-caller' };

async function studioTool(name) {
	const { toolDefs } = await import('../../api/_mcp3d/tools/studio.js');
	return toolDefs.find((t) => t.name === name);
}

function mkReq(body) {
	return {
		method: 'POST',
		url: '/',
		headers: { 'content-type': 'application/json' },
		rawBody: Buffer.from(JSON.stringify(body)),
		on() {},
		destroy() {},
	};
}

function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b === undefined ? '' : String(b);
			this.writableEnded = true;
		},
	};
}

async function post(route, body) {
	const { default: handler } = await import(`../../api/${route}.js`);
	const res = mkRes();
	await handler(mkReq(body), res);
	return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

beforeEach(() => {
	submitted.length = 0;
	process.env.GCP_RECONSTRUCTION_KEY = 'test-shared-worker-key';
});

describe('isFbxMeshUrl', () => {
	it('matches an FBX path in any case, ignoring the query string', () => {
		expect(isFbxMeshUrl('https://cdn.example/rig.fbx')).toBe(true);
		expect(isFbxMeshUrl('https://cdn.example/rig.FBX?sig=abc&exp=1')).toBe(true);
	});

	it('does not match other formats, an fbx query value, or a malformed URL', () => {
		expect(isFbxMeshUrl('https://cdn.example/scene.dae')).toBe(false);
		expect(isFbxMeshUrl('https://cdn.example/model.glb?name=rig.fbx')).toBe(false);
		expect(isFbxMeshUrl('not a url')).toBe(false);
	});
});

describe('the FBX refusal copy', () => {
	it('names every format the trimesh workers read', () => {
		expect(MESH_INPUT_FORMATS).toBe('GLB, GLTF, OBJ, STL, PLY, OFF or DAE');
	});

	it('names the lane, the formats, and the remesh convert path', () => {
		for (const [lane, message] of [
			['stylize', STYLIZE_FBX_MESSAGE],
			['segment', SEGMENT_FBX_MESSAGE],
		]) {
			expect(message).toContain(`not supported by ${lane}`);
			expect(message).toContain(MESH_INPUT_FORMATS);
			expect(message).toContain('remesh_model');
			expect(message).toContain('/api/forge-remesh');
		}
		expect(SEGMENT_FBX_MESSAGE).toBe(fbxUnsupportedMessage('segment', 'split an FBX into parts'));
	});
});

describe('stylize_model MCP tool', () => {
	it('refuses an FBX mesh_url with the supported formats and queues nothing', async () => {
		const def = await studioTool('stylize_model');
		const out = await def.handler({ mesh_url: 'https://cdn.example/rig.fbx', style: 'voxel' }, AUTH);
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain(MESH_INPUT_FORMATS);
		expect(submitted).toHaveLength(0);
	});

	it('still queues a DAE mesh', async () => {
		const def = await studioTool('stylize_model');
		const out = await def.handler({ mesh_url: 'https://cdn.example/scene.dae', style: 'voxel' }, AUTH);
		expect(out.isError).toBeFalsy();
		expect(submitted).toHaveLength(1);
		expect(submitted[0]).toMatchObject({ mode: 'stylize', sourceUrl: 'https://cdn.example/scene.dae' });
	});
});

describe('segment_model MCP tool', () => {
	it('refuses an FBX mesh_url with the supported formats and queues nothing', async () => {
		const def = await studioTool('segment_model');
		const out = await def.handler({ mesh_url: 'https://cdn.example/Character.FBX?sig=1' }, AUTH);
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toBe(`Error: ${SEGMENT_FBX_MESSAGE}`);
		expect(submitted).toHaveLength(0);
	});

	it('still queues a DAE mesh', async () => {
		const def = await studioTool('segment_model');
		const out = await def.handler({ mesh_url: 'https://cdn.example/scene.dae' }, AUTH);
		expect(out.isError).toBeFalsy();
		expect(submitted).toHaveLength(1);
		expect(submitted[0]).toMatchObject({ mode: 'segment', sourceUrl: 'https://cdn.example/scene.dae' });
	});

	it('no longer advertises FBX in its mesh_url schema', async () => {
		const def = await studioTool('segment_model');
		const desc = def.inputSchema.properties.mesh_url.description;
		expect(desc).toContain('GLB/GLTF/OBJ/STL/PLY/OFF/DAE');
		expect(desc).toMatch(/FBX is refused/);
	});
});

describe('POST /api/forge-segment', () => {
	it('answers 400 unsupported_mesh_format for an FBX and queues nothing', async () => {
		const res = await post('forge-segment', { mesh_url: 'https://cdn.example/rig.fbx' });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: 'unsupported_mesh_format', message: SEGMENT_FBX_MESSAGE });
		expect(submitted).toHaveLength(0);
	});

	it('still queues a GLB', async () => {
		const res = await post('forge-segment', { mesh_url: 'https://cdn.example/mesh.glb', max_parts: 8 });
		expect(res.status).toBe(202);
		expect(submitted).toHaveLength(1);
		expect(submitted[0]).toMatchObject({ mode: 'segment', sourceUrl: 'https://cdn.example/mesh.glb' });
	});
});

describe('POST /api/forge-stylize', () => {
	it('answers 400 unsupported_mesh_format for an FBX and queues nothing', async () => {
		const res = await post('forge-stylize', { mesh_url: 'https://cdn.example/rig.fbx', style: 'voxel' });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: 'unsupported_mesh_format', message: STYLIZE_FBX_MESSAGE });
		expect(submitted).toHaveLength(0);
	});
});
