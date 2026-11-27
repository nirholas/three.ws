// Forge hardening 35: "change this" and "more like this" must do what their
// labels say. Reproduces the defects measured on 2026-11-27 against
// api/forge-iterate.js:
//   - a look-only instruction ("make it red", "less shiny") started a full
//     text-to-3D geometry job, so the shape the user liked was thrown away;
//   - a refinement from v1 composed against the ORIGINAL prompt the client sent,
//     silently dropping v1's change;
//   - versions stored no seed or inputs, so "do that again" was impossible, and
//     a client lineage round-trip stripped whatever extra fields it carried;
//   - an instruction identical to the change that made the version, or one that
//     names a different object entirely, went straight to the GPU.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'user-labels' }),
}));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { forgeIterate: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));

const restyle = vi.fn();
vi.mock('../api/_lib/material-studio-store.js', async (orig) => ({
	...(await orig()),
	restyleMaterialFromInstruction: (...args) => restyle(...args),
}));

const { default: handler } = await import('../api/forge-iterate.js');
const { MaterialStudioError } = await import('../api/_lib/material-studio-store.js');

function mockReq(body) {
	return {
		method: 'POST',
		url: '/api/forge-iterate',
		headers: { host: 'three.ws', 'x-forwarded-proto': 'https', 'content-type': 'application/json', 'x-forge-client': 'c-1' },
		body,
	};
}

function mockRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b;
		},
	};
}

const out = (res) => JSON.parse(res.body || '{}');
const forgeOk = (body) => ({ status: 200, ok: true, json: async () => body });
const geometryCalls = (fetchMock) => fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/forge'));

const ORIGIN = 'https://three.ws/cdn/forge/origin.glb';

describe('forge-iterate: a look-only instruction keeps the shape', () => {
	let fetchMock;
	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		restyle.mockReset();
	});
	afterEach(() => vi.unstubAllGlobals());

	it('"make it red" restyles the surface and starts no geometry job', async () => {
		restyle.mockResolvedValueOnce({
			glbUrl: 'https://three.ws/cdn/material-studio/restyle/red.glb',
			factors: { name: 'Red', baseColorFactor: [0.8, 0.1, 0.1] },
		});
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, instruction: 'make it red', parent_prompt: 'a round robot' }), res);
		expect(res.statusCode).toBe(200);
		expect(geometryCalls(fetchMock)).toHaveLength(0);
		expect(restyle).toHaveBeenCalledTimes(1);
		expect(restyle.mock.calls[0][0]).toMatchObject({ glbUrl: ORIGIN, instruction: 'make it red' });
		const body = out(res);
		expect(body.kind).toBe('look');
		expect(body.glbUrl).toBe('https://three.ws/cdn/material-studio/restyle/red.glb');
		// The prompt that describes the version carries the look forward, so a
		// later shape change keeps the colour the user chose.
		expect(body.prompt).toBe('a round robot, red');
		expect(body.lineage[1]).toMatchObject({ parentIndex: 0, refKind: 'restyle', instruction: 'make it red' });
		expect(body.lineage[1].inputs).toMatchObject({ mode: 'look', instruction: 'make it red', seed: null });
	});

	it('"less shiny" is a look change too', async () => {
		restyle.mockResolvedValueOnce({ glbUrl: 'https://three.ws/cdn/material-studio/restyle/matte.glb', factors: {} });
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, instruction: 'less shiny', parent_prompt: 'a lamp' }), res);
		expect(res.statusCode).toBe(200);
		expect(geometryCalls(fetchMock)).toHaveLength(0);
	});

	it('a look request whose language model is down answers honestly and still starts no geometry job', async () => {
		restyle.mockRejectedValueOnce(new MaterialStudioError('no model', { status: 503, code: 'no_provider' }));
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, instruction: 'make it metallic', parent_prompt: 'a vase' }), res);
		expect(res.statusCode).toBe(503);
		expect(out(res)).toMatchObject({ error: 'look_unavailable', fallback: 'materials', kind: 'look' });
		expect(geometryCalls(fetchMock)).toHaveLength(0);
	});

	it('mode "shape" rebuilds the shape even for a colour word, when the user asks for it', async () => {
		fetchMock.mockResolvedValueOnce(forgeOk({ status: 'done', glb_url: 'https://three.ws/cdn/x/red.glb' }));
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, instruction: 'make it red', parent_prompt: 'a robot', mode: 'shape' }), res);
		expect(res.statusCode).toBe(200);
		expect(restyle).not.toHaveBeenCalled();
		expect(geometryCalls(fetchMock)).toHaveLength(1);
		expect(out(res).kind).toBe('shape');
	});

	it('a colour on one named part is not a whole-model restyle, so it rebuilds', async () => {
		fetchMock.mockResolvedValueOnce(forgeOk({ status: 'done', glb_url: 'https://three.ws/cdn/x/helmet.glb' }));
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, instruction: 'make the helmet red', parent_prompt: 'a knight' }), res);
		expect(restyle).not.toHaveBeenCalled();
		expect(geometryCalls(fetchMock)).toHaveLength(1);
	});
});

describe('forge-iterate: a refinement applies to the current version', () => {
	let fetchMock;
	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		restyle.mockReset();
	});
	afterEach(() => vi.unstubAllGlobals());

	const lineage = [
		{ index: 0, parentIndex: null, glbUrl: ORIGIN, prompt: 'a robot', refKind: 'origin' },
		{ index: 1, parentIndex: 0, glbUrl: 'https://three.ws/cdn/v1.glb', prompt: 'a robot, with a jetpack', instruction: 'add a jetpack', refKind: 'text' },
	];

	it('composes against the parent version prompt, not the original prompt the page sent', async () => {
		fetchMock.mockResolvedValueOnce(forgeOk({ status: 'done', glb_url: 'https://three.ws/cdn/v2.glb' }));
		const res = mockRes();
		await handler(
			mockReq({
				glb_url: 'https://three.ws/cdn/v1.glb',
				instruction: 'add wings',
				parent_prompt: 'a robot',
				parent_lineage: lineage,
				parent_index: 1,
			}),
			res,
		);
		expect(res.statusCode).toBe(200);
		const sent = JSON.parse(geometryCalls(fetchMock)[0][1].body);
		expect(sent.prompt).toBe('a robot, with a jetpack, add wings');
	});

	it('works from the parent version GLB even if the page sent another URL', async () => {
		restyle.mockResolvedValueOnce({ glbUrl: 'https://three.ws/cdn/material-studio/restyle/a.glb', factors: {} });
		const res = mockRes();
		await handler(
			mockReq({ glb_url: ORIGIN, instruction: 'make it gold', parent_lineage: lineage, parent_index: 1 }),
			res,
		);
		expect(restyle.mock.calls[0][0].glbUrl).toBe('https://three.ws/cdn/v1.glb');
	});
});

describe('forge-iterate: every version records its parent and inputs', () => {
	let fetchMock;
	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('a shape version stores parent, prompt, instruction, seed, mode and backend', async () => {
		fetchMock.mockResolvedValueOnce(
			forgeOk({ status: 'done', glb_url: 'https://three.ws/cdn/v1.glb', backend: 'trellis_selfhost', creation_id: 'cr-1' }),
		);
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, instruction: 'add wings', parent_prompt: 'a cat' }), res);
		const sent = JSON.parse(geometryCalls(fetchMock)[0][1].body);
		expect(Number.isInteger(sent.seed)).toBe(true);
		expect(sent.seed).toBeGreaterThan(0);
		expect(sent.seed).toBeLessThanOrEqual(2147483647);
		const v = out(res).lineage[1];
		expect(v.parentIndex).toBe(0);
		expect(v.inputs).toEqual({
			mode: 'shape',
			prompt: 'a cat, add wings',
			instruction: 'add wings',
			parentPrompt: 'a cat',
			seed: sent.seed,
			backend: 'trellis_selfhost',
			creationId: 'cr-1',
		});
	});

	it('an explicit seed is honoured so "do that again" reproduces the run', async () => {
		fetchMock.mockResolvedValueOnce(forgeOk({ status: 'done', glb_url: 'https://three.ws/cdn/v1.glb' }));
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, instruction: 'add wings', parent_prompt: 'a cat', seed: 4242 }), res);
		expect(JSON.parse(geometryCalls(fetchMock)[0][1].body).seed).toBe(4242);
		expect(out(res).lineage[1].inputs.seed).toBe(4242);
	});

	it('a client lineage keeps the inputs of earlier versions across the round trip', async () => {
		fetchMock.mockResolvedValueOnce(forgeOk({ status: 'done', glb_url: 'https://three.ws/cdn/v2.glb' }));
		const inputs = { mode: 'shape', prompt: 'a cat, wings', instruction: 'add wings', parentPrompt: 'a cat', seed: 77, backend: 'trellis_selfhost', creationId: null };
		const res = mockRes();
		await handler(
			mockReq({
				glb_url: 'https://three.ws/cdn/v1.glb',
				instruction: 'add a tail',
				parent_lineage: [
					{ index: 0, parentIndex: null, glbUrl: ORIGIN, prompt: 'a cat', refKind: 'origin' },
					{ index: 1, parentIndex: 0, glbUrl: 'https://three.ws/cdn/v1.glb', prompt: 'a cat, wings', instruction: 'add wings', refKind: 'text', inputs },
				],
			}),
			res,
		);
		expect(out(res).lineage[1].inputs).toEqual(inputs);
		expect(out(res).lineage[2].parentIndex).toBe(1);
	});

	it('"more like this" (mode variation) keeps the subject prompt, takes a new seed and records it as a child', async () => {
		fetchMock.mockResolvedValueOnce(forgeOk({ status: 'done', glb_url: 'https://three.ws/cdn/take2.glb' }));
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, mode: 'variation', parent_prompt: 'a brass teapot', parent_seed: 11 }), res);
		expect(res.statusCode).toBe(200);
		const sent = JSON.parse(geometryCalls(fetchMock)[0][1].body);
		expect(sent.prompt).toBe('a brass teapot');
		expect(sent.seed).not.toBe(11);
		const body = out(res);
		expect(body.kind).toBe('variation');
		expect(body.lineage[1]).toMatchObject({ parentIndex: 0, refKind: 'variation', prompt: 'a brass teapot' });
		expect(body.lineage[1].inputs).toMatchObject({ mode: 'variation', seed: sent.seed });
	});

	it('"more like this" on a model with no known prompt says so instead of generating a random subject', async () => {
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, mode: 'variation' }), res);
		expect(res.statusCode).toBe(422);
		expect(out(res).error).toBe('no_subject');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('forge-iterate: guards', () => {
	let fetchMock;
	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		restyle.mockReset();
	});
	afterEach(() => vi.unstubAllGlobals());

	it('an instruction identical to the change that made this version is refused with a pointer to Try again', async () => {
		const res = mockRes();
		await handler(
			mockReq({
				glb_url: 'https://three.ws/cdn/v1.glb',
				instruction: '  Add  wings. ',
				parent_lineage: [
					{ index: 0, parentIndex: null, glbUrl: ORIGIN, prompt: 'a cat', refKind: 'origin' },
					{ index: 1, parentIndex: 0, glbUrl: 'https://three.ws/cdn/v1.glb', prompt: 'a cat, wings', instruction: 'add wings', refKind: 'text' },
				],
			}),
			res,
		);
		expect(res.statusCode).toBe(409);
		expect(out(res).error).toBe('same_instruction');
		expect(out(res).message).toMatch(/try again/i);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(restyle).not.toHaveBeenCalled();
	});

	it('an instruction that asks for a different object is pointed at a new generation', async () => {
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, instruction: 'turn it into a pickup truck', parent_prompt: 'a ceramic owl figurine' }), res);
		expect(res.statusCode).toBe(422);
		expect(out(res)).toMatchObject({ error: 'different_object', suggested_prompt: 'a pickup truck' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('allow_new_subject lets the user iterate into a different object on purpose', async () => {
		fetchMock.mockResolvedValueOnce(forgeOk({ status: 'done', glb_url: 'https://three.ws/cdn/truck.glb' }));
		const res = mockRes();
		await handler(
			mockReq({ glb_url: ORIGIN, instruction: 'turn it into a pickup truck', parent_prompt: 'a ceramic owl figurine', allow_new_subject: true }),
			res,
		);
		expect(res.statusCode).toBe(200);
	});

	it('a whitespace-only instruction is refused before any work', async () => {
		const res = mockRes();
		await handler(mockReq({ glb_url: ORIGIN, instruction: '   ' }), res);
		expect(res.statusCode).toBe(400);
		expect(out(res).error).toBe('missing_instruction');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
