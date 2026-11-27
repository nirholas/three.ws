// api/material-studio.js - restyling or uploading a 3D model needs an account.
//
// The /restyle page and the restyle_material MCP tool both go through this
// endpoint. It used to persist any GLB anyone posted (?action=upload) and write
// AI-restyled and colorway copies of any model URL (?action=restyle, variants)
// for an anonymous caller, rate-limited only per IP: a free, unaccountable model
// host. Every other creation and upload endpoint answers that caller with 401
// `sign_in_required` (api/_lib/creator-account.js); this one now does too, and
// limits a signed-in caller per account.

import { describe, it, expect, beforeEach, vi } from 'vitest';

let currentUser = null;
const persist = vi.fn(async (bytes) => ({ url: 'https://cdn.example.test/material-studio/checkpoints/a.glb', bytes: bytes.length }));
const restyle = vi.fn(async ({ glbUrl }) => ({ glbUrl: 'https://cdn.example.test/r.glb', sourceGlbUrl: glbUrl, lineage: [], activeIndex: 0 }));
const variants = vi.fn(async () => ({ variants: [{ glbUrl: 'https://cdn.example.test/v1.glb', label: 'v1', seed: 1 }], lineage: [], activeIndex: 0 }));
const recordRestyle = vi.fn(async () => {});
const uploadLimit = vi.fn(async () => ({ success: true, limit: 120, remaining: 119, reset: 0 }));
const restyleLimit = vi.fn(async () => ({ success: true, limit: 40, remaining: 39, reset: 0 }));

vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: async () => currentUser,
	getRequestUser: async () => currentUser,
}));
vi.mock('../../api/_lib/material-studio-store.js', () => ({
	MaterialStudioError: class MaterialStudioError extends Error {},
	validateAndPersistGlb: (...a) => persist(...a),
	restyleMaterialFromInstruction: (...a) => restyle(...a),
	generateSeededVariants: (...a) => variants(...a),
}));
vi.mock('../../api/_lib/material-restyle-store.js', () => ({ recordMaterialRestyle: (...a) => recordRestyle(...a) }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		materialStudioUpload: (...a) => uploadLimit(...a),
		materialStudioRestyle: (...a) => restyleLimit(...a),
	},
	clientIp: () => '127.0.0.1',
}));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn() }));

const { default: handler } = await import('../../api/material-studio.js');

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

function makeReq(action, body, contentType = 'application/json') {
	return {
		method: action ? 'POST' : 'GET',
		url: action ? `/api/material-studio?action=${action}` : '/api/material-studio',
		headers: { host: 'three.ws', 'content-type': contentType },
		socket: { remoteAddress: '127.0.0.1' },
		body,
	};
}

const parse = (res) => (typeof res.body === 'string' && res.body ? JSON.parse(res.body) : null);
const GLB = Buffer.from('glTF\x02\x00\x00\x00', 'binary');
const RESTYLE = { glb_url: 'https://cdn.example.test/src.glb', instruction: 'make it chrome' };

beforeEach(() => {
	currentUser = null;
	for (const m of [persist, restyle, variants, recordRestyle, uploadLimit, restyleLimit]) m.mockClear();
});

describe('POST /api/material-studio without an account', () => {
	const cases = [
		['upload', GLB, 'model/gltf-binary', /^Sign in to upload a 3D model\./],
		['restyle', RESTYLE, 'application/json', /^Sign in to restyle a 3D model\./],
		['variants', { glb_url: RESTYLE.glb_url, preset: 'metal' }, 'application/json', /^Sign in to restyle a 3D model\./],
	];
	for (const [action, body, ct, message] of cases) {
		it(`refuses ?action=${action} with sign_in_required and makes nothing`, async () => {
			const res = makeRes();
			await handler(makeReq(action, body, ct), res);
			expect(res.statusCode).toBe(401);
			const out = parse(res);
			expect(out.error).toBe('sign_in_required');
			expect(out.message).toMatch(message);
			expect(out.sign_in_url).toBe('/login');
			expect(out.api_keys_url).toBe('/dashboard/api-keys');
			expect(persist).not.toHaveBeenCalled();
			expect(restyle).not.toHaveBeenCalled();
			expect(variants).not.toHaveBeenCalled();
		});
	}
});

describe('POST /api/material-studio with an account', () => {
	beforeEach(() => {
		currentUser = { id: 'user-7' };
	});

	it('persists an upload, rate-limited per account', async () => {
		const res = makeRes();
		await handler(makeReq('upload', GLB, 'model/gltf-binary'), res);
		expect(res.statusCode).toBe(200);
		expect(parse(res).url).toMatch(/^https:\/\/cdn\.example\.test\//);
		expect(uploadLimit).toHaveBeenCalledWith('user:user-7');
	});

	it('restyles and records the result against the account', async () => {
		const res = makeRes();
		await handler(makeReq('restyle', RESTYLE), res);
		expect(res.statusCode).toBe(200);
		expect(restyleLimit).toHaveBeenCalledWith('user:user-7');
		expect(recordRestyle).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-7', action: 'restyle' }));
	});

	// Same shape checks as a generation prompt (src/shared/restyle-instruction.js):
	// cleaned, then 3 to 300 characters. Nothing screens what is asked for.
	it('rejects a two-character instruction with instruction_too_short and restyles nothing', async () => {
		const res = makeRes();
		await handler(makeReq('restyle', { ...RESTYLE, instruction: ' ab ' }), res);
		expect(res.statusCode).toBe(400);
		expect(parse(res).error).toBe('instruction_too_short');
		expect(restyle).not.toHaveBeenCalled();
	});

	it('rejects an instruction over 300 characters with instruction_too_long', async () => {
		const res = makeRes();
		await handler(makeReq('restyle', { ...RESTYLE, instruction: 'x'.repeat(301) }), res);
		expect(res.statusCode).toBe(400);
		expect(parse(res).error).toBe('instruction_too_long');
		expect(restyle).not.toHaveBeenCalled();
	});

	it('passes the cleaned instruction on: control characters stripped, whitespace collapsed', async () => {
		const res = makeRes();
		await handler(makeReq('restyle', { ...RESTYLE, instruction: '  polished\u0000\n\n white   marble ' }), res);
		expect(res.statusCode).toBe(200);
		expect(restyle).toHaveBeenCalledWith(expect.objectContaining({ instruction: 'polished white marble' }));
	});

	it('records each colorway variant against the account', async () => {
		const res = makeRes();
		await handler(makeReq('variants', { glb_url: RESTYLE.glb_url, preset: 'metal' }), res);
		expect(res.statusCode).toBe(200);
		expect(recordRestyle).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-7', action: 'variants' }));
	});
});

describe('GET /api/material-studio', () => {
	it('says an account is needed instead of promising none', async () => {
		const res = makeRes();
		await handler(makeReq(null), res);
		expect(res.statusCode).toBe(200);
		const doc = parse(res);
		expect(doc.description).not.toMatch(/no wallet or account required/i);
		expect(doc.description).toMatch(/three\.ws account/);
	});
});
