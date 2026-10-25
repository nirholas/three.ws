import { describe, it, expect, vi, beforeEach } from 'vitest';

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

for (const [name, path, extra] of [
	['scene-upload', '../api/scene-upload.js', {}],
	['scene-glb-upload', '../api/scene-glb-upload.js', {}],
	['motion-swap upload', '../api/motion-swap.js', { action: 'upload' }],
]) {
	describe(`${name} content_type allowlist`, () => {
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
		for (const ct of ['constructor', 'tostring', '__proto__', 'hasownproperty', 'valueof']) {
			it(`rejects inherited property name "${ct}"`, async () => {
				const handler = (await import(path)).default;
				const req = {
					method: 'POST',
					url: '/x',
					headers: { 'content-type': 'application/json', origin: 'https://three.ws' },
					body: { ...extra, content_type: ct, size_bytes: 10 },
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
				expect(res.statusCode).toBe(400);
				expect(presign).not.toHaveBeenCalled();
			});
		}
	});
}
