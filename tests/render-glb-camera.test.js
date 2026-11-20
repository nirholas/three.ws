// Camera control for /api/render/glb: azimuth, elevation and field of view.
//
// Hero clips (docs/hero-clips.md) feed Grok Imagine Video several real renders
// of one model from distinct angles, so the renderer has to take a camera. The
// default output must not move: every OG card, thumbnail and share card on the
// platform is a GET to this endpoint with no camera fields, and the CDN holds a
// day of those PNGs.
//
// These run real renders through the CPU lane on a small, deliberately
// asymmetric GLB built in-process, so a camera that is parsed but never reaches
// the rasterizer fails here.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';

let glbBytes = null;

vi.mock('../api/_lib/fetch-model.js', () => ({
	fetchModel: vi.fn(async () => ({ bytes: glbBytes, contentType: 'model/gltf-binary' })),
}));

vi.mock('../api/_lib/rate-limit.js', () => ({
	clientIp: () => '203.0.113.9',
	limits: { renderIp: async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 1000 }) },
}));

vi.mock('../api/_lib/ssrf-guard.js', async (orig) => {
	const real = await orig();
	return { ...real, assertSafePublicUrl: async () => {} };
});

// An L-shaped pair of boxes in two colours: every azimuth shows a different
// silhouette, so two camera angles can never render the same picture.
async function buildAsymmetricGlb() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene('s');
	const box = (sx, sy, sz, ox, oy, oz, color) => {
		const p = [];
		const idx = [];
		const corners = [
			[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
			[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
		];
		for (const [x, y, z] of corners) p.push(ox + x * sx, oy + y * sy, oz + z * sz);
		const faces = [
			[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
			[2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3],
		];
		for (const f of faces) idx.push(...f);
		const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer);
		const ind = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer);
		const mat = doc.createMaterial().setBaseColorFactor(color).setRoughnessFactor(0.6);
		const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(ind).setMaterial(mat);
		scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
	};
	box(1.6, 0.4, 0.4, -0.8, 0, -0.2, [0.9, 0.2, 0.1, 1]);
	box(0.4, 1.4, 0.4, 0.4, 0.4, -0.2, [0.1, 0.4, 0.9, 1]);
	return new NodeIO().writeBinary(doc);
}

function makeRes() {
	return {
		statusCode: 0,
		headers: {},
		body: null,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete this.headers[k.toLowerCase()];
		},
		writeHead(status, headers) {
			this.statusCode = status;
			Object.assign(this.headers, headers || {});
			return this;
		},
		end(body) {
			if (body !== undefined) this.body = body;
			return this;
		},
		on() {},
	};
}

async function get(query) {
	const { default: handler } = await import('../api/render/glb.js');
	const req = { method: 'GET', url: `/api/render/glb?${query}`, headers: { host: 'three.ws' }, on() {} };
	const res = makeRes();
	await handler(req, res);
	return res;
}

const GLB = 'glbUrl=https://example.com/l.glb&width=96&height=96';

beforeEach(async () => {
	if (!glbBytes) glbBytes = await buildAsymmetricGlb();
	const { clearModelCache } = await import('../api/_lib/render-cpu.js');
	clearModelCache();
	delete process.env.RENDER_CPU_LANE;
});

describe('parseRenderCamera', () => {
	it('returns no camera fields when none are given, so the default framing is untouched', async () => {
		const { parseRenderCamera } = await import('../api/_lib/render-camera.js');
		expect(parseRenderCamera({})).toEqual({ camera: {} });
		expect(parseRenderCamera({ azimuth: '', elevation: null, fov: undefined })).toEqual({ camera: {} });
	});

	it('maps azimuth to yaw, elevation to pitch, and keeps fov', async () => {
		const { parseRenderCamera } = await import('../api/_lib/render-camera.js');
		expect(parseRenderCamera({ azimuth: '90', elevation: '20', fov: '35' })).toEqual({
			camera: { yaw: 90, pitch: 20, fov: 35 },
		});
	});

	it('wraps azimuth into (-180, 180]', async () => {
		const { parseRenderCamera } = await import('../api/_lib/render-camera.js');
		expect(parseRenderCamera({ azimuth: 450 }).camera.yaw).toBe(90);
		expect(parseRenderCamera({ azimuth: -270 }).camera.yaw).toBe(90);
		expect(parseRenderCamera({ azimuth: 180 }).camera.yaw).toBe(180);
	});

	it('rejects values a caller could not have meant, with a message they can act on', async () => {
		const { parseRenderCamera } = await import('../api/_lib/render-camera.js');
		expect(parseRenderCamera({ azimuth: 'left' }).error).toMatch(/azimuth/);
		expect(parseRenderCamera({ elevation: 95 }).error).toMatch(/elevation/);
		expect(parseRenderCamera({ fov: 4 }).error).toMatch(/fov/);
		expect(parseRenderCamera({ fov: 150 }).error).toMatch(/fov/);
	});
});

describe('GET /api/render/glb camera params', () => {
	it('renders different pictures for different azimuths', async () => {
		const front = await get(`${GLB}&azimuth=0`);
		const side = await get(`${GLB}&azimuth=90`);
		expect(front.statusCode).toBe(200);
		expect(side.statusCode).toBe(200);
		expect(front.headers['content-type']).toBe('image/png');
		expect(Buffer.compare(front.body, side.body)).not.toBe(0);
		expect(side.headers['x-render-azimuth']).toBe('90');
	});

	it('changes the picture with elevation and field of view', async () => {
		const base = await get(`${GLB}&azimuth=30`);
		const high = await get(`${GLB}&azimuth=30&elevation=50`);
		const wide = await get(`${GLB}&azimuth=30&fov=70`);
		expect(Buffer.compare(base.body, high.body)).not.toBe(0);
		expect(Buffer.compare(base.body, wide.body)).not.toBe(0);
	});

	it('leaves the default render byte-identical when no camera is given', async () => {
		const { renderGlbToPngCpu } = await import('../api/_lib/render-cpu.js');
		const reference = await renderGlbToPngCpu({ glbUrl: 'https://example.com/l.glb', width: 96, height: 96, background: '#0a0a0a' });
		const res = await get(GLB);
		expect(res.statusCode).toBe(200);
		expect(Buffer.compare(res.body, reference)).toBe(0);
		expect(res.headers['x-render-azimuth']).toBeUndefined();
	});

	it('answers 400 for an out-of-range camera instead of rendering something else', async () => {
		const res = await get(`${GLB}&elevation=120`);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error_description || JSON.parse(res.body).message || res.body).toMatch(/elevation/);
	});

	it('honours a transparent background alongside a camera', async () => {
		const res = await get(`${GLB}&azimuth=180&background=transparent`);
		expect(res.statusCode).toBe(200);
		expect(res.headers['x-render-background']).toBe('transparent');
	});
});

describe('chromium lane takes the same camera', () => {
	it('puts the requested yaw, pitch and fov into the render page', async () => {
		let html = '';
		const browser = {
			connected: true,
			on() {},
			async newPage() {
				return {
					async setRequestInterception() {},
					on() {},
					async setViewport() {},
					async setContent(h) {
						html = h;
					},
					async waitForFunction() {},
					async evaluate() {
						return null;
					},
					async screenshot() {
						return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
					},
					async close() {},
				};
			},
		};
		const { renderGlbToPngBrowser, __setBrowserForTests } = await import('../api/_lib/render-glb.js');
		__setBrowserForTests(browser);
		try {
			await renderGlbToPngBrowser({ glbUrl: 'https://example.com/l.glb', width: 96, height: 96, pose: 'bind', yaw: 135, pitch: 25, fov: 40 });
		} finally {
			__setBrowserForTests(null);
		}
		expect(html).toContain('const CAMERA = {"yaw":135,"pitch":25,"fov":40}');
	});
});
