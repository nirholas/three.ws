/**
 * FBX input on the stylize lane.
 *
 * workers/stylize reads meshes with trimesh, which has no FBX reader, and its
 * image carries no converter. An FBX used to be accepted, queued, and then fail
 * inside the worker as an opaque internal error. The REST route and the
 * stylize_model MCP tool now refuse it up front with the formats that work and
 * the way to convert, and never reach the worker.
 *
 * The SSRF guard (DNS) and the GCP provider (network) are the mocked
 * boundaries; the real tool handler and input check run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { mcp3dGenerate: async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 }) },
	clientIp: () => '203.0.113.9',
}));

vi.mock('../../api/_lib/ssrf-guard.js', async (importOriginal) => ({
	...(await importOriginal()),
	assertSafePublicUrl: async (raw) => new URL(raw),
}));

const submitted = [];
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		supportsMode: () => true,
		submit: async (request) => {
			submitted.push(request);
			return { extJobId: 'job-stylize-test-000000000000', eta: 20 };
		},
	}),
}));

const { isFbxMeshUrl, STYLIZE_FBX_MESSAGE, STYLIZE_INPUT_FORMATS } = await import('../../api/_lib/stylize-input.js');

const AUTH = { userId: null, rateKey: 'test-caller' };

async function stylizeTool() {
	const { toolDefs } = await import('../../api/_mcp3d/tools/studio.js');
	return toolDefs.find((t) => t.name === 'stylize_model');
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

	it('names every format the worker reads and how to convert an FBX', () => {
		expect(STYLIZE_INPUT_FORMATS).toBe('GLB, GLTF, OBJ, STL, PLY, OFF or DAE');
		expect(STYLIZE_FBX_MESSAGE).toContain(STYLIZE_INPUT_FORMATS);
		expect(STYLIZE_FBX_MESSAGE).toContain('remesh_model');
	});
});

describe('stylize_model MCP tool', () => {
	it('refuses an FBX mesh_url with the supported formats and queues nothing', async () => {
		const def = await stylizeTool();
		const out = await def.handler({ mesh_url: 'https://cdn.example/rig.fbx', style: 'voxel' }, AUTH);
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain(STYLIZE_INPUT_FORMATS);
		expect(submitted).toHaveLength(0);
	});

	it('still queues a DAE mesh', async () => {
		const def = await stylizeTool();
		const out = await def.handler({ mesh_url: 'https://cdn.example/scene.dae', style: 'voxel' }, AUTH);
		expect(out.isError).toBeFalsy();
		expect(submitted).toHaveLength(1);
		expect(submitted[0]).toMatchObject({ mode: 'stylize', sourceUrl: 'https://cdn.example/scene.dae' });
	});
});
