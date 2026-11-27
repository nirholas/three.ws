/**
 * The MCP studio tools accept a hidden "three-detail" engine that maps to the
 * Hunyuan3D lane. Hunyuan3D's licence excludes the EU, the UK and South Korea,
 * so a caller there (or one we cannot place) must never be told, or routed, to
 * that engine. The tools reconstruct through the platform provider either way;
 * what changes is the engine the call is resolved to and reports.
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
			return { extJobId: 'job-mcp-region-test-0000000000000', eta: 20 };
		},
	}),
}));

const AUTH = { userId: null, rateKey: 'test-caller' };

async function imageTo3d(args, headers) {
	const { toolDefs } = await import('../../api/_mcp3d/tools/studio.js');
	const tool = toolDefs.find((t) => t.name === 'image_to_3d');
	const req = { method: 'POST', url: '/', headers: { 'content-type': 'application/json', ...headers } };
	return tool.handler(args, AUTH, req);
}

const args = { image_url: 'https://cdn.example.com/chair.png', backend: 'three-detail' };

beforeEach(() => {
	submitted.length = 0;
	process.env.GCP_RECONSTRUCTION_KEY = 'test-shared-worker-key';
});

describe('MCP three-detail engine and the Hunyuan3D territory rule', () => {
	for (const [label, headers] of [
		['Germany', { 'x-client-region': 'DE' }],
		['the United Kingdom', { 'x-client-geo-location': 'GB,London' }],
		['South Korea', { 'x-client-region': 'KR' }],
		['an unknown country', {}],
		['a forged Vercel country header', { 'x-vercel-ip-country': 'US' }],
	]) {
		it(`does not resolve to the Detail engine for ${label}, and still starts a job`, async () => {
			const out = await imageTo3d(args, headers);
			expect(out.isError).toBeFalsy();
			expect(out.structuredContent.engine).not.toBe('three-detail');
			expect(out.structuredContent.job_id).toBeTruthy();
			expect(submitted).toHaveLength(1);
		});
	}

	it('honours the Detail engine for an allowed country', async () => {
		const out = await imageTo3d(args, { 'x-client-region': 'US' });
		expect(out.structuredContent.engine).toBe('three-detail');
	});
});
