// The 360 capture tools on the free studio server (api/_mcp-studio/pano-tools.js).
//
// Each tool is a thin client of the REST lanes /api/pano-capture and
// /api/pano-scene. The lanes themselves are tested with their own suites; here a
// local HTTP server that speaks contract C4 stands in for them, so the tests pin
// what the tools send (body, query, forwarded account) and how they shape what
// comes back.

import { createServer } from 'node:http';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';
process.env.CRON_SECRET = 'vitest-cron-secret-pano-tools';

vi.mock('../api/_lib/db.js', () => ({
	sql: () => Promise.resolve([]),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));
vi.mock('../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { dispatch, toolCatalogFor, CREATOR_TOOL_NAMES } = await import('../api/_mcp-studio/dispatch.js');
const { PANO_TOOL_CATALOG, PANO_TOOL_NAMES } = await import('../api/_mcp-studio/pano-tools.js');
const { POLICY } = await import('@three-ws/mcp-policy');

const USER_ID = '9a8b7c6d-0000-4000-8000-0000000000bb';
const ACCOUNT = { userId: USER_ID, source: 'apikey', scope: 'avatars:read avatars:write' };
const anon = { userId: null, rateKey: '127.0.0.1', scope: '' };
const JOB = '0d3e6f58-7a1c-4b0e-9d2a-5c8f1e2b3a47';

const NAMES = ['pano_capture_start', 'pano_capture_status', 'pano_capture_list', 'pano_scene_create', 'pano_scene_status'];
const FORBIDDEN = /x402|payment|wallet|usdc|solana|\$three|pump\.fun|token|coin|credit|price|\bpaid\b|crypto|onchain|web3|mint/i;

let lane;
let origin;
let seen;
let respond;

beforeAll(async () => {
	lane = createServer((req, res) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			seen.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
			const out = respond(req) || { status: 404, body: { error: 'not_found', message: 'no such lane' } };
			res.writeHead(out.status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(out.body));
		});
	});
	await new Promise((resolve) => lane.listen(0, '127.0.0.1', resolve));
	origin = `127.0.0.1:${lane.address().port}`;
});

afterAll(() => new Promise((resolve) => lane.close(resolve)));

beforeEach(() => {
	seen = [];
	respond = () => null;
});

function mkReq() {
	return { url: '/api/mcp-studio', headers: { host: origin } };
}

async function call(name, args, { account = ACCOUNT, surface = 'full' } = {}) {
	const out = await dispatch(
		{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
		account ? { ...anon, userId: account.userId } : anon,
		mkReq(),
		{ surface, account },
	);
	return out;
}

describe('pano tool catalog', () => {
	it('declares exactly the five tools', () => {
		expect([...PANO_TOOL_NAMES].sort()).toEqual([...NAMES].sort());
		expect(PANO_TOOL_CATALOG.map((t) => t.name).sort()).toEqual([...NAMES].sort());
	});

	it('lists them on the full and Grok surfaces but not the ChatGPT one', () => {
		for (const surface of ['full', 'grok']) {
			const names = toolCatalogFor(surface).map((t) => t.name);
			for (const n of NAMES) expect(names).toContain(n);
		}
		const chatgpt = toolCatalogFor('chatgpt').map((t) => t.name);
		for (const n of NAMES) expect(chatgpt).not.toContain(n);
	});

	it('requires an account for every pano tool and declares oauth2 up front', () => {
		for (const n of NAMES) expect(CREATOR_TOOL_NAMES.has(n)).toBe(true);
		for (const t of toolCatalogFor('full').filter((x) => NAMES.includes(x.name))) {
			expect(t.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['avatars:write'] }]);
		}
	});

	it('closed schemas, titles, honest annotations, no payment or coin vocabulary', () => {
		for (const t of PANO_TOOL_CATALOG) {
			expect(t.title.length).toBeGreaterThan(0);
			expect(t.inputSchema.additionalProperties).toBe(false);
			const readOnly = /status|list/.test(t.name);
			expect(t.annotations).toMatchObject({ readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: true });
		}
		expect(FORBIDDEN.test(JSON.stringify(PANO_TOOL_CATALOG))).toBe(false);
	});

	it('descriptions state what a job returns, how long it takes and that the files are owned', () => {
		const start = PANO_TOOL_CATALOG.find((t) => t.name === 'pano_capture_start').description;
		expect(start).toMatch(/PLY/);
		expect(start).toMatch(/SPZ/);
		expect(start).toMatch(/minutes/);
		expect(start).toMatch(/three-ws capture 360/);
		expect(start).toMatch(/public https URL/);
		expect(PANO_TOOL_CATALOG.find((t) => t.name === 'pano_scene_create').description).toMatch(/GLB/);
	});

	it('every tool has a tier in the shared policy table', () => {
		const table = POLICY['threews-3d-studio-free'];
		for (const n of NAMES) expect(table[n], n).toBeTruthy();
	});
});

describe('pano tools: account gate', () => {
	it('answers an anonymous call with a sign-in result and calls no lane', async () => {
		const out = await call('pano_capture_start', { source_url: 'https://example.com/a.mp4', source_kind: 'equirect_video' }, { account: null });
		expect(out.result.isError).toBe(true);
		expect(out.result.structuredContent.status).toBe('sign_in_required');
		expect(seen).toHaveLength(0);
	});
});

describe('pano tools: argument validation', () => {
	it('rejects a call with neither source_url nor source_urls', async () => {
		const out = await call('pano_capture_start', { source_kind: 'equirect_video' });
		expect(out.error?.code).toBe(-32602);
		expect(seen).toHaveLength(0);
	});

	it('rejects a plain http URL and an unknown kind', async () => {
		const http = await call('pano_capture_start', { source_url: 'http://example.com/a.mp4', source_kind: 'equirect_video' });
		expect(http.error?.code).toBe(-32602);
		const kind = await call('pano_capture_start', { source_url: 'https://example.com/a.mp4', source_kind: 'gif' });
		expect(kind.error?.code).toBe(-32602);
		const scene = await call('pano_scene_create', { image_url: 'https://example.com/a.jpg', source_kind: 'equirect_video' });
		expect(scene.error?.code).toBe(-32602);
		expect(seen).toHaveLength(0);
	});
});

describe('pano_capture_start', () => {
	it('posts the contract body with the caller forwarded and returns the job_id', async () => {
		respond = () => ({ status: 202, body: { job_id: JOB, status: 'queued', eta_seconds: 1500 } });
		const out = await call('pano_capture_start', {
			source_urls: ['https://example.com/VID_001.insv', 'https://example.com/VID_002.insv'],
			source_kind: 'insv',
			trim: { start_s: 5, end_s: 65 },
			quality: 'high',
		});
		expect(out.result.isError).toBeFalsy();
		expect(out.result.structuredContent).toEqual({ job_id: JOB, status: 'queued', eta_seconds: 1500 });
		expect(out.result.content[0].text).toContain(JOB);
		expect(out.result.content[0].text).toContain('25 minutes');
		expect(seen).toHaveLength(1);
		expect(seen[0].method).toBe('POST');
		expect(seen[0].url).toBe('/api/pano-capture');
		expect(seen[0].body).toEqual({
			source_kind: 'insv',
			source_urls: ['https://example.com/VID_001.insv', 'https://example.com/VID_002.insv'],
			trim: { start_s: 5, end_s: 65 },
			quality: 'high',
		});
		expect(seen[0].headers['x-forge-on-behalf-user']).toBe(USER_ID);
		expect(seen[0].headers['x-forge-seed']).toBe('vitest-cron-secret-pano-tools');
	});

	it('relays the lane\'s own visitor sentence when the worker is unconfigured', async () => {
		const message = '360 capture is offline on this deployment, so footage cannot be turned into a 3D scene right now.';
		respond = () => ({ status: 503, body: { error: 'unconfigured', message, hint: 'Set GCP_PANO2SPLAT_URL' } });
		const out = await call('pano_capture_start', { source_url: 'https://example.com/a.mp4', source_kind: 'equirect_video' });
		expect(out.result.isError).toBe(true);
		expect(out.result.structuredContent).toMatchObject({ reason: 'unconfigured', http_status: 503, message });
		expect(JSON.stringify(out.result)).not.toMatch(/GCP_PANO2SPLAT_URL/);
	});

	it('relays a rejected source and a rate limit as readable errors', async () => {
		respond = () => ({ status: 400, body: { error: 'invalid_source_url', message: 'Source URL rejected: private address.' } });
		const bad = await call('pano_capture_start', { source_url: 'https://example.com/a.mp4', source_kind: 'equirect_video' });
		expect(bad.result.structuredContent).toMatchObject({ reason: 'invalid_source_url', message: 'Source URL rejected: private address.' });
		respond = () => ({ status: 429, body: { error: 'too_many_active', message: 'You already have 2 captures processing.' } });
		const busy = await call('pano_capture_start', { source_url: 'https://example.com/a.mp4', source_kind: 'equirect_video' });
		expect(busy.result.structuredContent.reason).toBe('too_many_active');
	});

	it('says plainly when the capture service cannot be reached', async () => {
		const saved = mkReq;
		const out = await dispatch(
			{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pano_capture_status', arguments: { job_id: JOB } } },
			{ ...anon, userId: USER_ID },
			{ url: '/api/mcp-studio', headers: { host: '127.0.0.1:9' } },
			{ surface: 'full', account: ACCOUNT },
		);
		expect(saved).toBe(mkReq);
		expect(out.result.isError).toBe(true);
		expect(out.result.structuredContent.reason).toBe('lane_unreachable');
	});
});

describe('pano_capture_status', () => {
	it('reports a running job with its stage and progress', async () => {
		respond = () => ({ status: 200, body: { job_id: JOB, status: 'running', stage: 'sfm', progress: 0.34, source_kind: 'insv' } });
		const out = await call('pano_capture_status', { job_id: JOB });
		expect(seen[0].url).toBe(`/api/pano-capture?job=${JOB}`);
		expect(out.result.isError).toBeFalsy();
		expect(out.result.structuredContent).toMatchObject({ job_id: JOB, status: 'running', stage: 'sfm', progress: 0.34 });
		expect(out.result.content[0].text).toMatch(/34% done/);
		expect(out.result.content[0].text).toMatch(/pano_capture_status/);
	});

	it('returns every owned file and an absolute viewer link when it has succeeded', async () => {
		respond = () => ({
			status: 200,
			body: {
				job_id: JOB,
				status: 'succeeded',
				stage: 'upload',
				progress: 1,
				result: {
					ply_url: 'https://cdn.example.com/captures/pano/u/j/scene.ply',
					spz_url: 'https://cdn.example.com/captures/pano/u/j/scene.spz',
					preview_url: 'https://cdn.example.com/captures/pano/u/j/preview.mp4',
					poster_url: 'https://cdn.example.com/captures/pano/u/j/poster.jpg',
					viewer_url: '/splat?src=https%3A%2F%2Fcdn.example.com%2Fscene.spz',
				},
			},
		});
		const out = await call('pano_capture_status', { job_id: JOB });
		const r = out.result.structuredContent.result;
		expect(r.ply_url).toMatch(/scene\.ply$/);
		expect(r.viewer_url).toBe(`http://${origin}/splat?src=https%3A%2F%2Fcdn.example.com%2Fscene.spz`);
		expect(out.result.structuredContent.viewer_url).toBe(r.viewer_url);
		const text = out.result.content[0].text;
		expect(text).toContain('scene.ply');
		expect(text).toContain('scene.spz');
		expect(text).toContain('preview.mp4');
		expect(text).toContain('poster.jpg');
	});

	it('returns the failure reason as an error', async () => {
		respond = () => ({ status: 200, body: { job_id: JOB, status: 'failed', stage: 'sfm', progress: 0.5, error: { code: 'registration_failed', message: 'The camera path could not be recovered. Walk more slowly.' } } });
		const out = await call('pano_capture_status', { job_id: JOB });
		expect(out.result.isError).toBe(true);
		expect(out.result.content[0].text).toBe('The camera path could not be recovered. Walk more slowly.');
	});

	it('relays a 404 for a job the account does not own', async () => {
		respond = () => ({ status: 404, body: { error: 'not_found', message: 'No capture with that id belongs to this account.' } });
		const out = await call('pano_capture_status', { job_id: JOB });
		expect(out.result.isError).toBe(true);
		expect(out.result.structuredContent.http_status).toBe(404);
	});
});

describe('pano_capture_list', () => {
	it('lists the caller\'s captures newest first with absolute viewer links', async () => {
		respond = () => ({
			status: 200,
			body: {
				captures: [
					{ job_id: JOB, status: 'succeeded', created_at: '2026-11-21T10:00:00.000Z', poster_url: '/p.jpg', viewer_url: '/splat?src=x', source_kind: 'equirect_video' },
					{ job_id: 'b1', status: 'running', created_at: '2026-11-20T10:00:00.000Z', poster_url: null, viewer_url: null, source_kind: 'insv' },
				],
			},
		});
		const out = await call('pano_capture_list', { limit: 1 });
		expect(seen[0].url).toBe('/api/pano-capture?mine=1');
		expect(out.result.structuredContent.total).toBe(2);
		expect(out.result.structuredContent.captures).toHaveLength(1);
		expect(out.result.structuredContent.captures[0].viewer_url).toBe(`http://${origin}/splat?src=x`);
	});

	it('tells the user how to start one when there are none', async () => {
		respond = () => ({ status: 200, body: { captures: [] } });
		const out = await call('pano_capture_list', {});
		expect(out.result.content[0].text).toMatch(/pano_capture_start/);
		expect(out.result.structuredContent.captures).toEqual([]);
	});
});

describe('pano_scene_create and pano_scene_status', () => {
	it('starts a depth shell and returns the signed job handle', async () => {
		respond = () => ({ status: 202, body: { job_id: 'ps1.abc.def', status: 'queued', stage: 'depth', progress: 0 } });
		const out = await call('pano_scene_create', { image_url: 'https://example.com/pano.jpg', source_kind: 'equirect_image' });
		expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/pano-scene', body: { image_url: 'https://example.com/pano.jpg', source_kind: 'equirect_image' } });
		expect(out.result.structuredContent).toEqual({ job_id: 'ps1.abc.def', status: 'queued' });
	});

	it('returns the GLB, PLY and viewer link when the shell is ready', async () => {
		respond = () => ({
			status: 200,
			body: {
				job_id: 'ps1.abc.def',
				status: 'succeeded',
				stage: 'done',
				progress: 1,
				result: { glb_url: 'https://cdn.example.com/s.glb', ply_url: 'https://cdn.example.com/s.ply', viewer_url: '/viewer?src=x', stats: { points: 1 } },
			},
		});
		const out = await call('pano_scene_status', { job_id: 'ps1.abc.def' });
		expect(seen[0].url).toBe('/api/pano-scene?job=ps1.abc.def');
		const r = out.result.structuredContent.result;
		expect(r.glb_url).toBe('https://cdn.example.com/s.glb');
		expect(r.viewer_url).toBe(`http://${origin}/viewer?src=x`);
		expect(out.result.content[0].text).toContain('s.glb');
	});

	it('reports a failed shell', async () => {
		respond = () => ({ status: 200, body: { job_id: 'ps1.abc.def', status: 'failed', stage: 'depth', progress: 0.3, error: { code: 'depth_failed', message: 'Depth estimation failed on this photo. Try another 360 photo.' } } });
		const out = await call('pano_scene_status', { job_id: 'ps1.abc.def' });
		expect(out.result.isError).toBe(true);
		expect(out.result.content[0].text).toMatch(/Try another 360 photo/);
	});
});
