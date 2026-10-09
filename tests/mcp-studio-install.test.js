// Install tokens for the keyless 3D Studio MCP servers, against the REAL
// mcp_studio_installs migration in an in-process Postgres (PGlite) and the REAL
// rate limiters (in-memory store, no Redis). Pins the three contracts:
//   - two tokens from one IP get independent per-caller budgets;
//   - no token (or an unknown one) behaves exactly as before: keyed on the IP;
//   - minting a token is itself rate limited per IP, and stores only a hash.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		const out = await dbState.pg.query(text, values);
		return out.rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

vi.mock('../api/_mcp-studio/gpt-forge-client.js', async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, generate: vi.fn(async () => ({ status: 'done', glb_url: 'https://three.ws/cdn/a.glb' })), rig: vi.fn(), directPrompt: vi.fn(async () => null) };
});

const studio = (await import('../api/mcp-studio.js')).default;
const grok = (await import('../api/mcp-grok.js')).default;
const install = (await import('../api/mcp-studio/install.js')).default;
const { createInstallToken, resolveInstallToken, clearInstallCache, isInstallTokenShape, hashInstallToken } = await import('../api/_lib/mcp-studio-installs.js');
const { describeReset, installParam } = await import('../api/_mcp-studio/handler.js');

const MIGRATION = readFileSync(new URL('../api/_lib/migrations/20261009120000_mcp_studio_installs.sql', import.meta.url), 'utf8');

function pair(method, url, body, ip) {
	const payload = Buffer.from(body ? JSON.stringify(body) : '');
	const req = {
		method,
		url,
		headers: { host: 'three.ws', 'content-type': 'application/json', 'x-forwarded-for': ip },
		socket: { remoteAddress: ip },
		async *[Symbol.asyncIterator]() {
			yield payload;
		},
		on(event, cb) {
			if (event === 'data') cb(payload);
			if (event === 'end') cb();
			return this;
		},
	};
	const out = { headers: {}, body: '' };
	const res = {
		statusCode: 200,
		headersSent: false,
		setHeader(k, v) {
			out.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return out.headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete out.headers[k.toLowerCase()];
		},
		end(chunk) {
			if (chunk) out.body += chunk;
			this.headersSent = true;
		},
		write(chunk) {
			out.body += chunk;
		},
	};
	return { req, res, out };
}

let ipCounter = 0;
const freshIp = () => `198.51.100.${(ipCounter += 1)}`;

const gen = (id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'forge_free', arguments: { prompt: 'a lunar lander' } } });

async function callGen(handler, url, ip, id = 1) {
	const { req, res, out } = pair('POST', url, gen(id), ip);
	await handler(req, res);
	return { status: res.statusCode, out, json: out.body ? JSON.parse(out.body) : null };
}

async function mint(ip) {
	const { req, res, out } = pair('POST', '/api/mcp-studio/install', null, ip);
	await install(req, res);
	return { status: res.statusCode, out, json: JSON.parse(out.body) };
}

beforeAll(() => {
	dbState.pg = new PGlite();
});

beforeEach(async () => {
	await dbState.pg.exec('drop table if exists mcp_studio_installs');
	await dbState.pg.exec(MIGRATION);
	clearInstallCache();
});

describe('install token storage', () => {
	it('mints a well-formed token and stores only its hash', async () => {
		const token = await createInstallToken();
		expect(isInstallTokenShape(token)).toBe(true);
		const rows = (await dbState.pg.query('select token_hash from mcp_studio_installs')).rows;
		expect(rows).toHaveLength(1);
		expect(rows[0].token_hash).toBe(hashInstallToken(token));
		expect(rows[0].token_hash).not.toContain(token);
	});

	it('resolves a known token to a stable key and an unknown or malformed one to null', async () => {
		const token = await createInstallToken();
		clearInstallCache();
		const key = await resolveInstallToken(token);
		expect(key).toMatch(/^inst:[0-9a-f]{32}$/);
		expect(await resolveInstallToken(token)).toBe(key);
		expect(await resolveInstallToken(`inst_${'0'.repeat(32)}`)).toBeNull();
		expect(await resolveInstallToken('inst_short')).toBeNull();
		expect(await resolveInstallToken(null)).toBeNull();
		expect(await resolveInstallToken(['inst_x'])).toBeNull();
	});

	it('reads the token from the parsed query or the raw url', () => {
		expect(installParam({ query: { install: 'inst_a' }, url: '/x' })).toBe('inst_a');
		expect(installParam({ url: '/api/mcp-studio?install=inst_b' })).toBe('inst_b');
		expect(installParam({ url: '/api/mcp-studio' })).toBeNull();
	});
});

describe('POST /api/mcp-studio/install', () => {
	it('returns a connector URL carrying the token', async () => {
		const { status, json, out } = await mint(freshIp());
		expect(status).toBe(201);
		expect(json.connector_url).toBe(`https://three.ws/api/mcp-studio?install=${json.token}`);
		expect(json.grok_connector_url).toBe(`https://three.ws/api/mcp-grok?install=${json.token}`);
		expect(out.headers['cache-control']).toBe('no-store');
	});

	it('rate limits token creation per IP', async () => {
		const ip = freshIp();
		const results = [];
		for (let i = 0; i < 11; i += 1) results.push((await mint(ip)).status);
		expect(results.slice(0, 10).every((s) => s === 201)).toBe(true);
		expect(results[10]).toBe(429);
		expect((await mint(freshIp())).status).toBe(201);
	});

	it('rejects GET', async () => {
		const { req, res } = pair('GET', '/api/mcp-studio/install', null, freshIp());
		await install(req, res);
		expect(res.statusCode).toBe(405);
	});
});

describe('per-caller generation budgets', () => {
	it('gives two tokens from one IP independent budgets', async () => {
		const ip = freshIp();
		const a = (await mint(freshIp())).json.token;
		const b = (await mint(freshIp())).json.token;
		const urlA = `/api/mcp-grok?install=${a}`;
		const urlB = `/api/mcp-grok?install=${b}`;

		for (let i = 0; i < 4; i += 1) expect((await callGen(grok, urlA, ip, i + 1)).status).toBe(200);
		const capped = await callGen(grok, urlA, ip, 99);
		expect(capped.status).toBe(429);
		expect((await callGen(grok, urlB, ip, 1)).status).toBe(200);
	});

	it('answers a capped caller with a JSON-RPC error that names the limit, the reset and the remedy', async () => {
		const ip = freshIp();
		for (let i = 0; i < 4; i += 1) await callGen(studio, '/api/mcp-studio', ip, i + 1);
		const capped = await callGen(studio, '/api/mcp-studio', ip, 77);
		expect(capped.status).toBe(429);
		expect(capped.json.jsonrpc).toBe('2.0');
		expect(capped.json.id).toBe(77);
		const msg = capped.json.error.message;
		expect(msg).toContain('4 generations per minute');
		expect(msg).toMatch(/resets in \d+ (seconds|minutes)/);
		expect(msg).toContain('https://three.ws/api/mcp-studio/install');
		expect(msg).toContain('https://three.ws/api/mcp-studio?install=<token>');
		expect(msg).toContain('https://three.ws/api/mcp');
		expect(capped.json.error.data.retry_after).toBeGreaterThan(0);
		expect(capped.json.error.data.remedy.account_server).toBe('https://three.ws/api/mcp');
		expect(Number(capped.out.headers['retry-after'])).toBeGreaterThan(0);
	});

	it('tells a capped install-token caller that its own budget refills, not to mint another token', async () => {
		const ip = freshIp();
		const token = (await mint(freshIp())).json.token;
		for (let i = 0; i < 4; i += 1) await callGen(studio, `/api/mcp-studio?install=${token}`, ip, i + 1);
		const capped = await callGen(studio, `/api/mcp-studio?install=${token}`, ip, 5);
		expect(capped.status).toBe(429);
		expect(capped.json.error.message).toContain("This installation's budget refills");
		expect(capped.json.error.message).not.toContain('returns a free token');
	});

	it('keys a call with no token, or an unknown token, on the IP exactly as before', async () => {
		const ip = freshIp();
		const bogus = `inst_${'f'.repeat(32)}`;
		// Two calls without a token and two with an unknown one share the IP bucket of 4.
		expect((await callGen(studio, '/api/mcp-studio', ip, 1)).status).toBe(200);
		expect((await callGen(studio, '/api/mcp-studio', ip, 2)).status).toBe(200);
		expect((await callGen(studio, `/api/mcp-studio?install=${bogus}`, ip, 3)).status).toBe(200);
		expect((await callGen(studio, `/api/mcp-studio?install=${bogus}`, ip, 4)).status).toBe(200);
		expect((await callGen(studio, '/api/mcp-studio', ip, 5)).status).toBe(429);
		// A different IP is untouched.
		expect((await callGen(studio, '/api/mcp-studio', freshIp(), 1)).status).toBe(200);
	});
});

describe('describeReset', () => {
	it('words short and long waits', () => {
		const now = Date.UTC(2026, 9, 9, 14, 0, 0);
		expect(describeReset(now + 30_000, now)).toBe('in 30 seconds (at 14:00 UTC)');
		expect(describeReset(now + 12 * 60_000, now)).toBe('in 12 minutes (at 14:12 UTC)');
		expect(describeReset(now + 3 * 3600_000, now)).toBe('in 3 hours (at 17:00 UTC)');
	});
});
