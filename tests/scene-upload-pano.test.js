import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/scene-upload also presigns 360 photos for /pano-scene: image/jpeg,
// image/png, and a raw Insta360 .insp (application/octet-stream, accepted only
// when the filename ends in .insp).
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'creator-test-user' }),
}));

const presign = vi.fn(async ({ key }) => `https://r2.example/${key}?sig=1`);
vi.mock('../api/_lib/r2.js', () => ({
	presignUpload: presign,
	publicUrl: (k) => `https://cdn.example/${k}`,
	objectStorageUsable: async () => ({ ok: true }),
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true, reset: Date.now() + 1000 }) }),
	clientIp: () => '127.0.0.1',
}));

async function post(body) {
	const handler = (await import('../api/scene-upload.js')).default;
	const req = {
		method: 'POST',
		url: '/api/scene-upload',
		headers: { 'content-type': 'application/json', origin: 'https://three.ws' },
		body,
	};
	const res = {
		statusCode: 200,
		headers: {},
		setHeader(k, v) { this.headers[k] = v; },
		getHeader(k) { return this.headers[k]; },
		writeHead(c) { this.statusCode = c; },
		end(b) { this.payload = b; },
	};
	await handler(req, res);
	return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
}

describe('scene-upload accepts 360 photos', () => {
	beforeEach(() => {
		presign.mockClear();
		Object.assign(process.env, {
			S3_ENDPOINT: 'https://r2.example',
			S3_BUCKET: 'b',
			S3_PUBLIC_DOMAIN: 'https://cdn.example',
			S3_ACCESS_KEY_ID: 'k',
			S3_SECRET_ACCESS_KEY: 's',
		});
	});

	it('presigns a JPEG and a PNG with the matching extension', async () => {
		const jpg = await post({ content_type: 'image/jpeg', size_bytes: 5_000_000 });
		expect(jpg.status).toBe(200);
		expect(jpg.body.storage_key).toMatch(/^capture\/uploads\/[0-9a-f]+\/[0-9a-f-]+\.jpg$/);
		const png = await post({ content_type: 'image/png', size_bytes: 5_000_000 });
		expect(png.status).toBe(200);
		expect(png.body.storage_key).toMatch(/\.png$/);
	});

	it('presigns octet-stream only for a .insp filename', async () => {
		const insp = await post({ content_type: 'application/octet-stream', size_bytes: 20_000_000, filename: 'IMG_20261121_101500_00_001.INSP' });
		expect(insp.status).toBe(200);
		expect(insp.body.storage_key).toMatch(/\.insp$/);
		expect(insp.body.headers['content-type']).toBe('application/octet-stream');

		presign.mockClear();
		const exe = await post({ content_type: 'application/octet-stream', size_bytes: 20_000_000, filename: 'payload.exe' });
		expect(exe.status).toBe(400);
		const bare = await post({ content_type: 'application/octet-stream', size_bytes: 20_000_000 });
		expect(bare.status).toBe(400);
		expect(presign).not.toHaveBeenCalled();
	});

	it('still rejects an unrelated type and keeps video types working', async () => {
		expect((await post({ content_type: 'image/gif', size_bytes: 10 })).status).toBe(400);
		expect((await post({ content_type: 'video/mp4', size_bytes: 10 })).status).toBe(200);
	});
});
