// Making or uploading anything needs an account. The direct creation endpoints
// (GPU reconstructions, restyles, splats, motion, garments, exports, print
// prep) and the presigned upload endpoints used to accept anyone, so a script
// could run GPU jobs and host files on the platform with nothing tying them to
// a person. Each now runs api/_lib/creator-account.js requireCreator first:
//   - no account          -> 401 sign_in_required, before any work or presign
//   - signed-in account   -> past the gate
// and stores uploads under a per-account folder so the sweep and any takedown
// can trace an object back to its owner.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const auth = { user: null };
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => auth.user,
	getSessionUser: async () => auth.user,
}));

const presign = vi.fn(async ({ key }) => `https://r2.example/${key}?sig=1`);
vi.mock('../api/_lib/r2.js', async (orig) => ({
	...(await orig()),
	presignUpload: (args) => presign(args),
	publicUrl: (k) => `https://cdn.example/${k}`,
	objectStorageUsable: async () => ({ ok: true }),
}));

const provider = { submit: vi.fn(async () => ({ id: 'task-1', status: 'queued' })), status: vi.fn() };
vi.mock('../api/_providers/gcp.js', async (orig) => ({
	...(await orig()),
	createRegenProvider: () => provider,
}));

vi.mock('../api/_lib/rate-limit.js', async (orig) => ({
	...(await orig()),
	limits: new Proxy({}, { get: () => async () => ({ success: true, reset: Date.now() + 1000 }) }),
	clientIp: () => '203.0.113.9',
}));

function call(handler, { body, url = '/x', method = 'POST' } = {}) {
	return new Promise((resolve) => {
		const res = {
			statusCode: 200,
			headers: {},
			headersSent: false,
			setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
			getHeader(k) { return this.headers[k.toLowerCase()]; },
			removeHeader(k) { delete this.headers[k.toLowerCase()]; },
			writeHead(c, h) { this.statusCode = c; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; },
			write() { return true; },
			end(b) {
				this.headersSent = true;
				let parsed = null;
				try { parsed = b ? JSON.parse(String(b)) : null; } catch { parsed = null; }
				resolve({ status: this.statusCode, body: parsed, headers: this.headers });
			},
		};
		Promise.resolve(
			handler(
				{
					method,
					url,
					headers: { host: 'three.ws', origin: 'https://three.ws', 'content-type': 'application/json' },
					body,
					socket: { remoteAddress: '203.0.113.9' },
				},
				res,
			),
		).then(() => { if (!res.headersSent) resolve({ status: res.statusCode, body: null, headers: res.headers }); });
	});
}

const MESH = 'https://three.ws/cdn/forge/a.glb';
const IMAGE = 'https://three.ws/cdn/forge/a.png';

// [name, module, body, url?, action phrase in the 401 message]
const CREATION = [
	['forge-rembg', '../api/forge-rembg.js', { image_url: IMAGE }, '/api/forge-rembg', 'remove an image background'],
	['forge-remesh', '../api/forge-remesh.js', { mesh_url: MESH }, '/api/forge-remesh', 'remesh a 3D model'],
	['forge-segment', '../api/forge-segment.js', { mesh_url: MESH }, '/api/forge-segment', 'segment a 3D model'],
	['forge-holopart', '../api/forge-holopart.js', { mesh_url: MESH }, '/api/forge-holopart', 'split a 3D model into parts'],
	['forge-stylize', '../api/forge-stylize.js', { mesh_url: MESH, style: 'chrome' }, '/api/forge-stylize', 'restyle a 3D model'],
	['forge-splat', '../api/forge-splat.js', { image_url: IMAGE }, '/api/forge-splat', 'make a 3D splat'],
	['forge-motion', '../api/forge-motion.js', { prompt: 'a person waving hello' }, '/api/forge-motion', 'make an animation'],
	['forge-nim', '../api/forge-nim.js', { mode: 'text', prompt: 'a brass telescope' }, '/api/forge-nim', 'make a 3D model'],
	['nim-forge', '../api/nim-forge.js', { prompt: 'a brass telescope' }, '/api/nim-forge', 'make a 3D model'],
	['garment-forge', '../api/garment-forge.js', { prompt: 'a red hoodie' }, '/api/garment-forge', 'make a garment'],
	['scene-capture', '../api/scene-capture.js', { video_url: 'https://three.ws/cdn/v.mp4' }, '/api/scene-capture', 'reconstruct a scene'],
	['forge-gameready (holder path)', '../api/forge-gameready.js', { mesh_url: MESH, formats: ['glb'] }, '/api/forge-gameready', 'make a game-ready model'],
	['export-usd', '../api/forge/export-usd.js', { glb_url: MESH }, '/api/forge/export-usd', 'export a model to OpenUSD'],
	['print/prepare', '../api/print/prepare.js', { glb_url: MESH }, '/api/print/prepare', 'prepare a model for printing'],
	['dad/generate', '../api/dad/generate.js', { image_url: IMAGE }, '/api/dad/generate', 'make a 3D avatar'],
	['motion-swap job', '../api/motion-swap.js', { video_url: 'https://three.ws/cdn/v.mp4' }, '/api/motion-swap', 'capture motion from a video'],
];

const UPLOADS = [
	['scene-upload', '../api/scene-upload.js', { content_type: 'video/mp4', size_bytes: 1000 }, 'capture/uploads/', 'upload a video'],
	['scene-glb-upload', '../api/scene-glb-upload.js', { content_type: 'model/gltf-binary', size_bytes: 1000 }, 'scene/shares/', 'share a scene'],
	['motion-swap upload', '../api/motion-swap.js', { action: 'upload', content_type: 'video/mp4', size_bytes: 1000 }, 'motion-swap/uploads/', 'upload a video'],
	['print/upload', '../api/print/upload.js', { content_type: 'model/gltf-binary', size_bytes: 1000 }, 'print/uploads/', 'upload a model to print'],
];

beforeEach(() => {
	auth.user = null;
	presign.mockClear();
	provider.submit.mockClear();
	Object.assign(process.env, {
		// Workers that answer 503 unconfigured before reading the caller. The
		// .invalid host can never resolve, so a signed-in call stops at the
		// network boundary instead of reaching a real worker.
		GCP_GARMENT_FORGE_URL: 'https://garment.invalid',
		GCP_USD_EXPORT_URL: 'https://usd.invalid',
		GCP_RECONSTRUCTION_KEY: 'test-key',
		S3_ENDPOINT: 'https://r2.example',
		S3_BUCKET: 'b',
		S3_PUBLIC_DOMAIN: 'https://cdn.example',
		S3_ACCESS_KEY_ID: 'k',
		S3_SECRET_ACCESS_KEY: 's',
	});
});

describe('direct creation endpoints need an account', () => {
	for (const [name, mod, body, url, action] of CREATION) {
		it(`${name}: refuses an anonymous caller before any work`, async () => {
			const handler = (await import(mod)).default;
			const got = await call(handler, { body, url });
			expect(got.status).toBe(401);
			expect(got.body).toMatchObject({ error: 'sign_in_required', sign_in_url: '/login', api_keys_url: '/dashboard/api-keys' });
			expect(got.body.message).toContain(`Sign in to ${action}`);
			expect(got.headers['www-authenticate']).toMatch(/^Bearer /);
			expect(provider.submit).not.toHaveBeenCalled();
		});

		it(`${name}: lets a signed-in account past the gate`, async () => {
			auth.user = { id: 'user-42' };
			const handler = (await import(mod)).default;
			const got = await call(handler, { body, url });
			expect(got.status).not.toBe(401);
		});
	}
});

describe('upload endpoints need an account', () => {
	for (const [name, mod, body, prefix, action] of UPLOADS) {
		it(`${name}: refuses an anonymous caller and signs nothing`, async () => {
			const handler = (await import(mod)).default;
			const got = await call(handler, { body });
			expect(got.status).toBe(401);
			expect(got.body).toMatchObject({ error: 'sign_in_required' });
			expect(got.body.message).toContain(`Sign in to ${action}`);
			expect(presign).not.toHaveBeenCalled();
		});

		it(`${name}: signs a signed-in upload into that account's folder`, async () => {
			auth.user = { id: 'user-42' };
			const handler = (await import(mod)).default;
			const got = await call(handler, { body });
			expect(got.status).toBe(200);
			expect(presign).toHaveBeenCalledTimes(1);
			const { key } = presign.mock.calls[0][0];
			expect(key.startsWith(prefix)).toBe(true);
			// <prefix><12-char owner hash>/<uuid>.<ext>: the sweep lists the prefix
			// recursively, so the per-account folder stays inside its ceiling.
			expect(key.slice(prefix.length)).toMatch(/^[0-9a-f]{12}\/[0-9a-f-]{36}\.\w+$/);
		});
	}

	it('keeps one account in one folder and two accounts apart', async () => {
		const handler = (await import('../api/scene-upload.js')).default;
		const body = { content_type: 'video/mp4', size_bytes: 1000 };
		auth.user = { id: 'user-a' };
		await call(handler, { body });
		await call(handler, { body });
		auth.user = { id: 'user-b' };
		await call(handler, { body });
		const folders = presign.mock.calls.map(([{ key }]) => key.split('/')[2]);
		expect(folders[0]).toBe(folders[1]);
		expect(folders[2]).not.toBe(folders[0]);
	});
});
