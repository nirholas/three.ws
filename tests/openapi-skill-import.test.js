// POST/GET /api/skills/import (api/skills/import.js) and the public bundle
// host /api/skills/import/:id/* (api/skills/import/[id]/[...file].js).
//
// The database is an in-memory openapi_skill_imports table that understands
// exactly the statements api/_lib/openapi-skill-imports.js issues. The spec
// fetch runs against a real local HTTP server serving the same synthetic
// fixture packages/skill-import's own suite uses, so the generation path
// under test is the real @three-ws/skill-import code, not a stub; only the
// SSRF guard (which would otherwise refuse a loopback address on purpose) is
// swapped for a passthrough so that real local server is reachable in tests.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
	readFileSync(path.join(__dirname, '../packages/skill-import/tests/fixtures/sample-openapi.json'), 'utf8'),
);

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';

const db = { rows: [], seq: 0 };

function nextUuid() {
	db.seq += 1;
	return `bbbbbbbb-bbbb-4bbb-8bbb-${String(db.seq).padStart(12, '0')}`;
}

function query(q, values) {
	if (q.startsWith('insert into openapi_skill_imports')) {
		const [user_id, source_url, kind, manifest, skill_md, tools, handlers_src] = values;
		const row = {
			id: nextUuid(),
			user_id,
			source_url,
			kind,
			manifest: JSON.parse(manifest),
			skill_md,
			tools: tools ? JSON.parse(tools) : null,
			handlers_src,
			enabled: false,
			created_at: new Date().toISOString(),
		};
		db.rows.push(row);
		return [{ ...row }];
	}
	if (q.startsWith('select') && q.includes('from openapi_skill_imports where user_id') && q.includes('order by created_at')) {
		return db.rows.filter((r) => r.user_id === values[0]).map((r) => ({ ...r }));
	}
	if (q.startsWith('select') && q.includes('from openapi_skill_imports where id') && q.includes('and user_id')) {
		return db.rows.filter((r) => r.id === values[0] && r.user_id === values[1]).map((r) => ({ ...r }));
	}
	if (q.startsWith('select') && q.includes('from openapi_skill_imports where id') && !q.includes('and user_id')) {
		return db.rows.filter((r) => r.id === values[0]).map((r) => ({ ...r }));
	}
	if (q.startsWith('update openapi_skill_imports set enabled')) {
		const [enabled, id, user_id] = values;
		const row = db.rows.find((r) => r.id === id && r.user_id === user_id);
		if (row) row.enabled = enabled;
		return row ? [{ ...row }] : [];
	}
	if (q.startsWith('delete from openapi_skill_imports where id') && q.includes('and user_id')) {
		db.rows = db.rows.filter((r) => !(r.id === values[0] && r.user_id === values[1]));
		return [];
	}
	throw new Error(`unexpected query in test: ${q.slice(0, 120)}`);
}

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn((strings, ...values) => {
		const q = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
		return Promise.resolve().then(() => query(q, values));
	}),
}));

const authState = { user: null };
vi.mock('../api/_lib/auth.js', () => ({
	getRequestUser: vi.fn(async () => authState.user),
	hasScope: (granted, required) => {
		const g = new Set(String(granted || '').split(/\s+/).filter(Boolean));
		return required.split(/\s+/).every((s) => g.has(s));
	},
}));

vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { openapiSkillImportUser: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));

// Real network call, just not through the pinned-DNS SSRF guard: a loopback
// test server is exactly what that guard exists to refuse in production.
vi.mock('../api/_lib/ssrf-guard.js', async () => {
	const actual = await vi.importActual('../api/_lib/ssrf-guard.js');
	return { ...actual, fetchSafePublicUrlPinned: (url, init) => fetch(url, init) };
});

const { default: importHandler } = await import('../api/skills/import.js');
const { default: draftHandler } = await import('../api/skills/import/[id].js');
const { default: fileHandler } = await import('../api/skills/import/[id]/[...file].js');

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

async function callImport(method, body) {
	const req = Readable.from(body != null ? [Buffer.from(JSON.stringify(body))] : []);
	req.method = method;
	req.url = '/api/skills/import';
	req.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
	const res = mockRes();
	await importHandler(req, res);
	return { status: res.statusCode, body: res.json };
}

async function callDraft(method, id, body) {
	const req = Readable.from(body != null ? [Buffer.from(JSON.stringify(body))] : []);
	req.method = method;
	req.url = `/api/skills/import/${id}`;
	req.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
	req.query = { id };
	const res = mockRes();
	await draftHandler(req, res);
	return { status: res.statusCode, body: res.json };
}

async function callFile(id, file) {
	const req = Readable.from([]);
	req.method = 'GET';
	req.url = `/api/skills/import/${id}/${file}`;
	req.headers = { origin: 'http://localhost:3000' };
	req.query = { id, file: file.split('/') };
	const res = mockRes();
	await fileHandler(req, res);
	return { status: res.statusCode, body: res.json, text: res._body };
}

let server;
let specUrl;

beforeAll(async () => {
	server = createServer((req, res) => {
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify(FIXTURE));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	specUrl = `http://127.0.0.1:${server.address().port}/openapi.json`;
});

afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
	db.rows = [];
	db.seq = 0;
	authState.user = { id: OWNER, source: 'session' };
});

describe('POST/GET /api/skills/import', () => {
	it('rejects an anonymous caller and a bearer token without the write scope', async () => {
		authState.user = null;
		expect((await callImport('POST', { url: specUrl })).status).toBe(401);
		authState.user = { id: OWNER, source: 'bearer', scope: 'agents:read' };
		expect((await callImport('POST', { url: specUrl })).body).toMatchObject({ error: 'insufficient_scope' });
	});

	it('requires a url', async () => {
		expect((await callImport('POST', {})).status).toBe(400);
	});

	it('imports a real OpenAPI spec end to end and never enables the draft', async () => {
		const { status, body } = await callImport('POST', { url: specUrl });
		expect(status).toBe(201);
		expect(body.data).toMatchObject({ kind: 'openapi', enabled: false });
		expect(body.data.manifest.spec).toBe('skill/0.1');
		expect(body.data.manifest.provides.tools).toEqual(['createWidget', 'getWidget']);
		expect(body.data.bundleUri).toBe(`/api/skills/import/${body.data.id}/`);

		// The row landed with enabled hardcoded false; nothing in the create path
		// can flip it, since no PATCH/enable route exists yet for this feature.
		expect(db.rows).toHaveLength(1);
		expect(db.rows[0].enabled).toBe(false);
	});

	it('lists only the caller\'s own drafts, each one disabled', async () => {
		await callImport('POST', { url: specUrl });
		authState.user = { id: STRANGER, source: 'session' };
		await callImport('POST', { url: specUrl });

		authState.user = { id: OWNER, source: 'session' };
		const { body } = await callImport('GET');
		expect(body.data).toHaveLength(1);
		expect(body.data.every((d) => d.enabled === false)).toBe(true);
	});
});

describe('GET/PATCH/DELETE /api/skills/import/:id', () => {
	it('is the only path that can ever flip enabled, and it is owner-scoped', async () => {
		const created = await callImport('POST', { url: specUrl });
		const id = created.body.data.id;

		expect((await callDraft('GET', id)).body.data.enabled).toBe(false);

		authState.user = { id: STRANGER, source: 'session' };
		expect((await callDraft('PATCH', id, { enabled: true })).status).toBe(404);
		authState.user = { id: OWNER, source: 'session' };

		const enabled = await callDraft('PATCH', id, { enabled: true });
		expect(enabled.status).toBe(200);
		expect(enabled.body.data.enabled).toBe(true);

		expect((await callDraft('PATCH', id, {})).status).toBe(400);

		const deleted = await callDraft('DELETE', id);
		expect(deleted.body.data).toEqual({ deleted: true, id });
		expect((await callDraft('GET', id)).status).toBe(404);
	});
});

describe('GET /api/skills/import/:id/*', () => {
	it('serves the full bundle anonymously, including handlers.js after the server\'s trailing-.js strip', async () => {
		const created = await callImport('POST', { url: specUrl });
		const id = created.body.data.id;

		const manifest = await callFile(id, 'manifest.json');
		expect(manifest.status).toBe(200);
		expect(manifest.body.provides.tools).toEqual(['createWidget', 'getWidget']);

		const skillMd = await callFile(id, 'SKILL.md');
		expect(skillMd.status).toBe(200);
		expect(skillMd.text).toContain('createWidget');

		const tools = await callFile(id, 'tools.json');
		expect(tools.status).toBe(200);
		expect(tools.body.tools.map((t) => t.name)).toEqual(['createWidget', 'getWidget']);

		// server/index.mjs strips a trailing ".js" from the URL before routing,
		// so the file segment this handler actually receives for "handlers.js"
		// is the bare "handlers".
		const handlers = await callFile(id, 'handlers');
		expect(handlers.status).toBe(200);
		expect(handlers.text).toContain('export async function createWidget');
	});

	it('404s on an unknown id', async () => {
		expect((await callFile('00000000-0000-0000-0000-000000000000', 'manifest.json')).status).toBe(404);
	});
});

describe('POST /api/skills/import with an Anchor IDL', () => {
	const LICENSE_IDL = readFileSync(path.join(__dirname, '../contracts/idl/skill_license.json'), 'utf8');
	let idlServer;
	let idlUrl;

	beforeAll(async () => {
		idlServer = createServer((req, res) => {
			res.setHeader('content-type', 'application/json');
			res.end(req.url === '/bad.json' ? JSON.stringify({ openapi: '3.0.0' }) : LICENSE_IDL);
		});
		await new Promise((resolve) => idlServer.listen(0, '127.0.0.1', resolve));
		idlUrl = `http://127.0.0.1:${idlServer.address().port}/skill_license.json`;
	});

	afterAll(async () => {
		await new Promise((resolve) => idlServer.close(resolve));
	});

	it('imports idl_url as a disabled anchor draft with read, preview and destructive send tools', async () => {
		const { status, body } = await callImport('POST', { idl_url: idlUrl });
		expect(status).toBe(201);
		expect(body.data).toMatchObject({ kind: 'anchor', enabled: false, hasHandlers: true });
		const names = body.data.tools.tools.map((t) => t.name);
		expect(names).toEqual(expect.arrayContaining(['read_marketplace', 'preview_mint_skill_license', 'send_mint_skill_license']));
		const send = body.data.tools.tools.find((t) => t.name === 'send_set_minter');
		expect(send.annotations.destructiveHint).toBe(true);
		expect(db.rows[0].enabled).toBe(false);

		const handlers = await callFile(body.data.id, 'handlers.js');
		expect(handlers.status).toBe(200);
		expect(handlers.text).toContain('export async function read_marketplace');
	});

	it('rejects a document that is not an IDL, a bad cluster and an unknown program id', async () => {
		const bad = await callImport('POST', { idl_url: idlUrl.replace('skill_license', 'bad') });
		expect(bad.status).toBe(400);
		expect(bad.body.error).toBe('idl_error');
		expect((await callImport('POST', { idl_url: idlUrl, cluster: 'testnet' })).status).toBe(400);
		expect((await callImport('POST', { program_id: 'not-a-key' })).body.error).toBe('idl_error');
	});
});
