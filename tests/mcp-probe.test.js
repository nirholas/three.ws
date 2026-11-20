// The synthetic MCP connector probe (api/_lib/mcp-probe.js) against the real
// handlers, served over a real node:http server in this process: /api/mcp-grok,
// /api/mcp-studio and /api/mcp, plus the protected-resource metadata route
// (api/wk.js) the OAuth challenge points at. The probe speaks Streamable HTTP
// over the loopback socket exactly as it does against production. The only
// substitution is the database: api/_lib/db.js runs on PGlite with the
// production schema, so the handlers' analytics writes never reach Neon.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

let server;
let origin;
let probe;
const routes = new Map();
const API_KEY = 'sk_test_mcpprobe0000000000000000000000000000';

// The vercel.json route the challenge's resource_metadata URL lands on:
// /.well-known/oauth-protected-resource(/api/<name>) -> /api/wk?name=...&path=$1
const WK_RE = /^\/\.well-known\/oauth-protected-resource(\/api\/[a-z0-9-]+)$/;

beforeAll(async () => {
	const { pg } = await createFullSchemaDb();
	holder.db = createPgliteSql({ pg });
	// /api/mcp admits no anonymous notification, so that case runs as a real
	// account holding a real API key, authenticated by api/_lib/auth.js.
	const { sha256 } = await import('../api/_lib/crypto.js');
	const [{ id: userId }] = await holder.db.sql`insert into users (email) values ('probe@mcp-probe.test') returning id`;
	await holder.db.sql`insert into api_keys (user_id, name, prefix, token_hash, scope) values (${userId}, 'probe', ${API_KEY.slice(0, 12)}, ${await sha256(API_KEY)}, 'avatars:read')`;

	server = createServer(async (req, res) => {
		const url = new URL(req.url, 'http://internal');
		const wk = WK_RE.exec(url.pathname);
		if (wk) {
			req.query = { name: 'oauth-protected-resource', path: wk[1] };
			return routes.get('wk')(req, res);
		}
		// A connector that accepts the connection and never answers: the timeout path.
		if (url.pathname === '/api/hang') return;
		req.query = Object.fromEntries(url.searchParams);
		const handler = routes.get(url.pathname);
		if (!handler) {
			res.statusCode = 404;
			return res.end('not found');
		}
		return handler(req, res);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${server.address().port}`;
	// The challenge and the metadata document name this origin, so the probe's
	// metadata fetch stays on the loopback server.
	process.env.PUBLIC_APP_ORIGIN = origin;

	routes.set('/api/mcp-grok', (await import('../api/mcp-grok.js')).default);
	routes.set('/api/mcp-studio', (await import('../api/mcp-studio.js')).default);
	routes.set('/api/mcp', (await import('../api/mcp.js')).default);
	routes.set('wk', (await import('../api/wk.js')).default);
	probe = await import('../api/_lib/mcp-probe.js');
}, 300_000);

afterAll(async () => {
	await new Promise((resolve) => server?.close(resolve));
});

const manifest = JSON.parse(readFileSync(new URL('../public/.well-known/mcp.json', import.meta.url), 'utf8'));

describe('grokFacingTargets', () => {
	it('derives the Grok-facing servers from the manifest, sign-in URL included', () => {
		const targets = probe.grokFacingTargets(manifest);
		const paths = targets.map((t) => t.path).sort();
		expect(paths).toEqual(['/api/mcp-grok', '/api/mcp-studio']);
		for (const t of targets) expect(t.signIn).toBe(`https://three.ws${t.path}?auth=oauth`);
	});

	it('leaves out servers a keyless connector cannot open', () => {
		const paths = probe.grokFacingTargets(manifest).map((t) => t.path);
		for (const p of ['/api/mcp', '/api/mcp-agent', '/api/mcp-bazaar', '/api/ibm-mcp']) expect(paths).not.toContain(p);
	});

	it('moves every URL onto another origin', () => {
		const targets = probe.grokFacingTargets(manifest, { base: 'http://localhost:3280' });
		for (const t of targets) {
			expect(t.server).toBe(`http://localhost:3280${t.path}`);
			expect(t.signIn).toBe(`http://localhost:3280${t.path}?auth=oauth`);
		}
	});

	it('follows a server added to the manifest in the same shape', () => {
		const next = { ...manifest, servers: [...manifest.servers, { name: 'New', endpoint: 'https://three.ws/api/mcp-new', signIn: 'https://three.ws/api/mcp-new?auth=oauth' }] };
		expect(probe.grokFacingTargets(next).map((t) => t.path)).toContain('/api/mcp-new');
	});
});

describe('chooseProbeCall', () => {
	it('prefers the per-server read, then the first safe read listed', () => {
		const tools = [{ name: 'forge_free' }, { name: 'search_catalog' }, { name: 'search_docs' }];
		expect(probe.chooseProbeCall('/api/mcp-grok', tools).name).toBe('search_docs');
		expect(probe.chooseProbeCall('/api/mcp-studio', tools).name).toBe('search_catalog');
		expect(probe.chooseProbeCall('/api/other', [{ name: 'getting_started' }]).name).toBe('getting_started');
	});

	it('never picks a tool that writes or generates', () => {
		expect(probe.chooseProbeCall('/api/mcp-grok', [{ name: 'forge_free' }, { name: 'rig_mesh' }])).toBeNull();
	});
});

describe('probeServer against the real handlers', () => {
	const target = (path) => ({ server: `${origin}${path}`, path, signIn: `${origin}${path}?auth=oauth` });

	for (const [path, tool] of [
		['/api/mcp-grok', 'search_docs'],
		['/api/mcp-studio', 'search_catalog'],
	]) {
		it(`${path}: every connector step passes with timings and no conformance warning`, async () => {
			const r = await probe.probeServer(target(path), { stepTimeoutMs: 60_000 });
			expect(r.error).toBeNull();
			expect(r.ok).toBe(true);
			expect(r.failedStep).toBeNull();
			expect(Object.keys(r.latencyMs)).toEqual(probe.STEPS);
			for (const ms of Object.values(r.latencyMs)) expect(Number.isInteger(ms) && ms >= 0).toBe(true);
			expect(r.detail.protocolVersion).toBe('2025-06-18');
			expect(r.detail.sessionIssued).toBe(true);
			expect(r.detail.toolCount).toBeGreaterThan(0);
			expect(r.detail.tool).toBe(tool);
			expect(r.detail.warnings).toEqual([]);
			expect(probe.handshakeMs(r.latencyMs)).toBe(r.latencyMs.initialize + r.latencyMs['notifications/initialized'] + r.latencyMs['tools/list']);
		}, 120_000);
	}

	it('names initialize when the URL is not an MCP server', async () => {
		const r = await probe.probeServer({ server: `${origin}/api/nowhere`, signIn: null });
		expect(r.ok).toBe(false);
		expect(r.failedStep).toBe('initialize');
		expect(r.error).toMatch(/HTTP 404/);
		expect(Object.keys(r.latencyMs)).toEqual(['initialize']);
	});

	it('names oauth_challenge when the sign-in URL does not challenge', async () => {
		const r = await probe.probeServer({ server: `${origin}/api/mcp-grok`, path: '/api/mcp-grok', signIn: `${origin}/api/mcp-grok` }, { stepTimeoutMs: 60_000 });
		expect(r.ok).toBe(false);
		expect(r.failedStep).toBe('oauth_challenge');
		expect(r.error).toMatch(/answered HTTP 200, expected 401/);
	}, 120_000);

	it('bounds a step that never answers', async () => {
		const r = await probe.probeServer({ server: `${origin}/api/hang`, signIn: null }, { stepTimeoutMs: 300 });
		expect(r.failedStep).toBe('initialize');
		expect(r.error).toBe('timed out after 300ms');
		expect(r.latencyMs.initialize).toBeGreaterThanOrEqual(250);
	});
});

// MCP 2025-06-18, Streamable HTTP: "If the input is a JSON-RPC response or
// notification: if the server accepts the input, the server MUST return HTTP
// status code 202 Accepted with no body." Production answered 200 with the body
// `null` until this was fixed.
describe('notifications get 202 with no body', () => {
	async function notify(path, headers = {}) {
		const res = await fetch(`${origin}${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
			body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
		});
		return { status: res.status, body: await res.text() };
	}

	for (const path of ['/api/mcp-grok', '/api/mcp-studio']) {
		it(path, async () => {
			expect(await notify(path)).toEqual({ status: 202, body: '' });
		}, 60_000);
	}

	it('/api/mcp (signed in)', async () => {
		expect(await notify('/api/mcp', { authorization: `Bearer ${API_KEY}` })).toEqual({ status: 202, body: '' });
	}, 60_000);

	it('a batch of notifications only is one 202', async () => {
		const res = await fetch(`${origin}/api/mcp-grok`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
			body: JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/initialized' }]),
		});
		expect(res.status).toBe(202);
		expect(await res.text()).toBe('');
	}, 60_000);

	it('a request still gets its 200 JSON-RPC result', async () => {
		const res = await fetch(`${origin}/api/mcp-grok`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
		});
		expect(res.status).toBe(200);
		expect((await res.json()).id).toBe(7);
	}, 60_000);
});
