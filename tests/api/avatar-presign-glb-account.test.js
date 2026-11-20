// api/avatar/presign-glb.js - uploading a 3D model needs an account.
//
// The /play "bring your own avatar" drop zone and the world-prop picker upload a
// .glb through this grant, and every peer in the room then downloads and renders
// it. It used to sign a PUT for anyone, filing anonymous uploads under a shared
// `u/anon/` prefix: an arbitrary model, from nobody, shown to everyone, with no
// owner to answer for it or remove it. Every other creation and upload endpoint
// already answers an anonymous caller with 401 `sign_in_required`
// (api/_lib/creator-account.js); this one now does too.

import { describe, it, expect, beforeEach, vi } from 'vitest';

let currentUser = null;
const presignMock = vi.fn(async ({ key }) => `https://bucket.example.test/${key}?sig=stub`);
const uploadLimit = vi.fn(async () => ({ success: true, limit: 60, remaining: 59, reset: 0 }));
const publicIpLimit = vi.fn(async () => ({ success: true, limit: 60, remaining: 59, reset: 0 }));

vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: async () => currentUser,
	getRequestUser: async () => currentUser,
}));
vi.mock('../../api/_lib/r2.js', () => ({
	presignUpload: (...args) => presignMock(...args),
	publicUrl: (key) => `https://cdn.example.test/${key}`,
}));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { upload: (...args) => uploadLimit(...args), publicIp: (...args) => publicIpLimit(...args) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn() }));

const { default: handler } = await import('../../api/avatar/presign-glb.js');

function makeRes() {
	return {
		statusCode: 0,
		body: null,
		headers: {},
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; },
		get headersSent() { return this.body !== null; },
		get writableEnded() { return this.body !== null; },
	};
}

function makeReq(body) {
	return {
		method: 'POST',
		url: '/api/avatar/presign-glb',
		headers: { host: 'three.ws' },
		socket: { remoteAddress: '127.0.0.1' },
		body,
	};
}

const parse = (res) => (typeof res.body === 'string' && res.body ? JSON.parse(res.body) : null);
const GLB = { filename: 'me.glb', content_type: 'model/gltf-binary', bytes: 2_000_000 };

beforeEach(() => {
	currentUser = null;
	presignMock.mockClear();
	uploadLimit.mockClear();
	publicIpLimit.mockClear();
});

describe('POST /api/avatar/presign-glb', () => {
	it('refuses an anonymous caller with sign_in_required and signs nothing', async () => {
		const res = makeRes();
		await handler(makeReq(GLB), res);
		expect(res.statusCode).toBe(401);
		const body = parse(res);
		expect(body.error).toBe('sign_in_required');
		expect(body.message).toMatch(/^Sign in to upload a 3D model\./);
		expect(body.sign_in_url).toBe('/login');
		expect(body.api_keys_url).toBe('/dashboard/api-keys');
		expect(presignMock).not.toHaveBeenCalled();
	});

	it('signs a PUT under the signed-in account, rate-limited per account', async () => {
		currentUser = { id: 'user-7' };
		const res = makeRes();
		await handler(makeReq(GLB), res);
		expect(res.statusCode).toBe(200);
		const body = parse(res);
		expect(body.storage_key).toMatch(/^u\/user-7\/avatar\/[0-9a-f-]+\.glb$/);
		expect(body.upload_url).toContain(body.storage_key);
		expect(body.public_url).toBe(`https://cdn.example.test/${body.storage_key}`);
		expect(uploadLimit).toHaveBeenCalledWith('user-7');
		expect(publicIpLimit).not.toHaveBeenCalled();
	});

	it('still enforces the declared-size cap for an account', async () => {
		currentUser = { id: 'user-7' };
		const res = makeRes();
		await handler(makeReq({ ...GLB, bytes: 17 * 1024 * 1024 }), res);
		expect(res.statusCode).toBe(413);
		expect(presignMock).not.toHaveBeenCalled();
	});
});
