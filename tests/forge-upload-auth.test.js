import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/forge-upload used to hand any anonymous caller a presigned PUT into our
// object storage and a public URL on our CDN. Nothing screened the bytes, and
// nothing tied them to a person, so the endpoint worked as a free, anonymous
// image host on the three.ws domain. Uploading a photo now needs an account
// (a session cookie or an API key). Text-to-3D stays open to everyone.

const requestUser = vi.fn();
const presign = vi.fn();
const uploadLimit = vi.fn();

vi.mock('../api/_lib/auth.js', () => ({ getRequestUser: (req) => requestUser(req) }));
vi.mock('../api/_lib/r2.js', () => ({
	presignUpload: (args) => presign(args),
	publicUrl: (key) => `https://three.ws/cdn/${key}`,
	objectStorageUsable: async () => ({ ok: true }),
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { upload: (key) => uploadLimit(key) },
	clientIp: () => '127.0.0.1',
}));
const sha = (raw) => createHash('sha256').update(raw).digest('hex');
vi.mock('../api/_lib/forge-store.js', () => ({
	hashClient: (raw) => (raw ? sha(raw) : 'anon'),
}));

const { default: handler } = await import('../api/forge-upload.js');

function call({ body = { content_type: 'image/png', size_bytes: 1024 }, headers = {} } = {}) {
	return new Promise((resolve) => {
		const sent = {};
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader(k, v) { sent[k.toLowerCase()] = v; },
			getHeader(k) { return sent[k.toLowerCase()]; },
			removeHeader(k) { delete sent[k.toLowerCase()]; },
			writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; },
			write() { return true; },
			end(out) { this.headersSent = true; resolve({ status: this.statusCode, body: out ? JSON.parse(String(out)) : null }); },
		};
		handler(
			{
				method: 'POST',
				url: '/api/forge-upload',
				headers: { host: 'three.ws', 'content-type': 'application/json', ...headers },
				rawBody: Buffer.from(JSON.stringify(body)),
				socket: { remoteAddress: '127.0.0.1' },
			},
			res,
		);
	});
}

beforeEach(() => {
	requestUser.mockReset();
	presign.mockReset();
	uploadLimit.mockReset();
	presign.mockResolvedValue('https://storage.example/signed');
	uploadLimit.mockResolvedValue({ success: true });
});

describe('POST /api/forge-upload', () => {
	it('refuses an anonymous caller with a sign-in prompt and never presigns', async () => {
		requestUser.mockResolvedValue(null);
		const got = await call({ headers: { 'x-forge-client': 'browser-1' } });
		expect(got.status).toBe(401);
		expect(got.body.error).toBe('sign_in_required');
		expect(got.body.message).toMatch(/sign in/i);
		expect(got.body.sign_in_url).toBe('/login');
		expect(presign).not.toHaveBeenCalled();
		expect(uploadLimit).not.toHaveBeenCalled();
	});

	it('presigns for a signed-in account under a prefix derived from the account, not the browser', async () => {
		requestUser.mockResolvedValue({ id: 'user-1' });
		const got = await call({ headers: { 'x-forge-client': 'browser-1' } });
		expect(got.status).toBe(200);
		const prefix = `forge/uploads/${sha('user:user-1').slice(0, 12)}/`;
		expect(got.body.storage_key.startsWith(prefix)).toBe(true);
		expect(got.body.storage_key).toMatch(/\/[0-9a-f-]{36}\.png$/);
		// The browser id no longer decides where an upload lands.
		expect(got.body.storage_key.startsWith(`forge/uploads/${sha('browser-1').slice(0, 12)}/`)).toBe(false);
		expect(got.body.public_url).toBe(`https://three.ws/cdn/${got.body.storage_key}`);
		expect(uploadLimit).toHaveBeenCalledWith('forge:user:user-1');
	});

	it('accepts an API-key caller the same way', async () => {
		requestUser.mockResolvedValue({ id: 'user-2', source: 'bearer', scope: '' });
		const got = await call({ headers: { authorization: 'Bearer tw_key' } });
		expect(got.status).toBe(200);
		expect(got.body.storage_key.startsWith(`forge/uploads/${sha('user:user-2').slice(0, 12)}/`)).toBe(true);
	});
});
