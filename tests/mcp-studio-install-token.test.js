// Install tokens for the free 3D studio (POST /api/mcp-studio/install, then
// `?install=<token>` on any studio connector URL). Cloud agents reach the studio
// from one shared egress, so per-IP caps would ration every user of an agent as
// one caller. These tests run the real handlers over the real in-memory limiter
// (no Redis in the test env) and pin the order's three cases: two tokens from
// one IP get independent budgets, no token keys exactly as before, and minting a
// token is itself rate-limited. Only the GPU call (generate) is stubbed.
//
// Making a model now needs a three.ws account, so generation caps key on the
// account first: an install token keys everything else (the transport cap) and
// can no longer split one account's generation budget. Bearers here are
// `test-acct:<id>`, resolved by the stubbed authenticateBearer below.

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('../api/_mcp-studio/gpt-forge-client.js', async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, generate: vi.fn(), rig: vi.fn(), directPrompt: vi.fn(async () => null) };
});

vi.mock('../api/_lib/auth.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		authenticateBearer: vi.fn(async (bearer) =>
			typeof bearer === 'string' && bearer.startsWith('test-acct:')
				? { userId: bearer.slice('test-acct:'.length), source: 'apikey', scope: 'avatars:write' }
				: null,
		),
	};
});

const SECRET = 'install-token-test-secret-0123456789abcdef';
let generate, studioHandlerFull, installHandler, tokens, handler;

beforeAll(async () => {
	process.env.MCP_INSTALL_SECRET = SECRET;
	({ generate } = await import('../api/_mcp-studio/gpt-forge-client.js'));
	studioHandlerFull = (await import('../api/mcp-studio.js')).default;
	installHandler = (await import('../api/mcp-studio/install.js')).default;
	tokens = await import('../api/_mcp-studio/install-token.js');
	handler = await import('../api/_mcp-studio/handler.js');
});

afterEach(() => {
	vi.mocked(generate).mockReset();
});

// A minimal node-style req/res pair for driving a real HTTP handler.
function httpPair({ url, body, ip, method = 'POST', headers = {} }) {
	const payload = Buffer.from(body === undefined ? '' : JSON.stringify(body));
	const req = {
		method,
		url,
		headers: { host: 'three.ws', 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
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
	const out = { status: 200, headers: {}, body: '' };
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
			out.status = this.statusCode;
			this.headersSent = true;
		},
		write(chunk) {
			out.body += chunk;
		},
	};
	return { req, res, out };
}

async function mint(ip) {
	const { req, res, out } = httpPair({ url: '/api/mcp-studio/install', ip });
	await installHandler(req, res);
	return { status: out.status, headers: out.headers, json: JSON.parse(out.body) };
}

let rpcId = 0;
// `account` is the signed-in user id, or null for an anonymous call.
async function forge(ip, token, account) {
	vi.mocked(generate).mockResolvedValue({ status: 'done', glb_url: 'https://three.ws/cdn/forge/fixture.glb' });
	const url = token ? `/api/mcp-studio?install=${encodeURIComponent(token)}` : '/api/mcp-studio';
	const body = { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: 'forge_free', arguments: { prompt: 'a brass lantern' } } };
	const headers = account ? { authorization: `Bearer test-acct:${account}` } : {};
	const { req, res, out } = httpPair({ url, body, ip, headers });
	await studioHandlerFull(req, res);
	return { status: out.status, headers: out.headers, json: JSON.parse(out.body) };
}

// The burst cap (4 a minute) is the first one a fast caller meets.
async function exhaust(ip, token, account) {
	for (let i = 0; i < 4; i++) {
		const r = await forge(ip, token, account);
		expect(r.json.error, `call ${i + 1} should pass`).toBeUndefined();
	}
	return forge(ip, token, account);
}

describe('install token format', () => {
	it('mints a token that verifies, and rejects a forged or altered one', () => {
		const { token, id } = tokens.mintInstallToken();
		expect(token).toMatch(/^tws_[0-9a-z]+_[0-9a-f]{64}$/);
		expect(tokens.verifyInstallToken(token)?.id).toBe(id);
		const flipped = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
		expect(tokens.verifyInstallToken(flipped)).toBeNull();
		expect(tokens.verifyInstallToken(`tws_zzz_${'a'.repeat(64)}`)).toBeNull();
		expect(tokens.verifyInstallToken('grk_0f8e2c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b')).toBeNull();
		expect(tokens.verifyInstallToken(undefined)).toBeNull();
	});

	it('refuses a token signed under another secret', () => {
		const { token } = tokens.mintInstallToken();
		process.env.MCP_INSTALL_SECRET = 'a-different-deployment-secret';
		try {
			expect(tokens.verifyInstallToken(token)).toBeNull();
		} finally {
			process.env.MCP_INSTALL_SECRET = SECRET;
		}
	});

	it('reads the token from the connector URL query', () => {
		const { token, id } = tokens.mintInstallToken();
		expect(tokens.installTokenFrom({ url: `/api/mcp-grok?install=${token}` })?.id).toBe(id);
		expect(tokens.installTokenFrom({ url: '/api/mcp-grok' })).toBeNull();
	});
});

describe('POST /api/mcp-studio/install', () => {
	it('returns a token and connector URLs for every studio surface', async () => {
		const r = await mint('198.51.100.10');
		expect(r.status).toBe(201);
		expect(r.headers['cache-control']).toBe('no-store');
		expect(tokens.verifyInstallToken(r.json.token)).not.toBeNull();
		expect(r.json.connector_url).toBe(`https://three.ws/api/mcp-studio?install=${r.json.token}`);
		expect(r.json.connector_urls.grok).toBe(`https://three.ws/api/mcp-grok?install=${r.json.token}`);
		expect(r.json.limits.generations_per_hour).toBe(30);
	});

	it('is rate-limited per IP: the eleventh mint in an hour is refused, another IP is not', async () => {
		const ip = '198.51.100.20';
		for (let i = 0; i < 10; i++) expect((await mint(ip)).status).toBe(201);
		const denied = await mint(ip);
		expect(denied.status).toBe(429);
		expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
		expect(denied.json.error_description).toContain('10 new tokens per hour');
		expect(denied.json.reset_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect((await mint('198.51.100.21')).status).toBe(201);
	});

	it('answers 405 to anything but POST', async () => {
		const { req, res, out } = httpPair({ url: '/api/mcp-studio/install', ip: '198.51.100.22', method: 'GET' });
		await installHandler(req, res);
		expect(out.status).toBe(405);
	});
});

describe('generation caps keyed on the account', () => {
	it('keys generation on the account, so a second install token does not lift its cap', async () => {
		const ip = '203.0.113.40';
		const a = (await mint(ip)).json.token;
		const b = (await mint(ip)).json.token;

		const capped = await exhaust(ip, a, 'acct-install-1');
		expect(capped.status).toBe(200);
		expect(capped.json.error.code).toBe(handler.STUDIO_RATE_LIMITED);
		expect(capped.json.error.data.limit).toBe('generation_burst');
		expect(capped.json.error.data.keyed_on).toBe('account');

		// The same account behind another token is still capped.
		const sameAccount = await forge(ip, b, 'acct-install-1');
		expect(sameAccount.json.error.data.keyed_on).toBe('account');

		// Another account on the same IP has its own budget.
		const other = await forge(ip, b, 'acct-install-2');
		expect(other.json.error).toBeUndefined();
		expect(other.json.result.isError).toBeFalsy();
	});

	it('refuses an anonymous creation before it spends any quota or reaches the forge', async () => {
		const ip = '203.0.113.41';
		for (let i = 0; i < 6; i++) {
			const r = await forge(ip, null, null);
			expect(r.json.error).toBeUndefined();
			expect(r.json.result.isError).toBe(true);
			expect(r.json.result.structuredContent.status).toBe('sign_in_required');
		}
		expect(generate).not.toHaveBeenCalled();
		// Signing in from that IP generates straight away: nothing was charged.
		expect((await forge(ip, null, 'acct-install-3')).json.error).toBeUndefined();
		expect(generate).toHaveBeenCalledTimes(1);
	});

	it('picks the account over an install token', () => {
		const { token } = tokens.mintInstallToken();
		const req = { url: `/api/mcp-studio?install=${token}`, headers: {} };
		expect(handler.studioCaller('full', {}, req, '203.0.113.44', undefined, { userId: 'u-1' })).toEqual({ key: 'acct:u-1', kind: 'account' });
	});

	it('picks the install token over the surface subject and the IP', () => {
		const { token, id } = tokens.mintInstallToken();
		const sid = 'grk_0f8e2c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
		const req = { url: `/api/mcp-grok?install=${token}`, headers: { 'mcp-session-id': sid } };
		expect(handler.studioCaller('grok', {}, req, '203.0.113.43')).toEqual({ key: `inst:${id}`, kind: 'install' });
		expect(handler.studioCaller('grok', {}, { url: '/api/mcp-grok', headers: { 'mcp-session-id': sid } }, '203.0.113.43')).toEqual({ key: sid, kind: 'session' });
		expect(handler.studioCaller('full', {}, { url: '/api/mcp-studio', headers: {} }, '203.0.113.43')).toEqual({ key: '203.0.113.43', kind: 'ip' });
	});
});

describe('denials name the limit, the reset and the remedy', () => {
	it('tells a per-IP caller how to get an install token', () => {
		const now = Date.now();
		const d = handler.studioDenial({ bucket: 'burst', kind: 'ip', result: { reset: now + 55_000 }, surfacePath: '/api/mcp-studio', now });
		expect(d.message).toContain('4 generations per minute for your IP address');
		expect(d.message).toMatch(/resets at \d{4}-\d{2}-\d{2}T[\d:.]+Z \(in \d+ s\)/);
		expect(d.message).toContain('POST https://three.ws/api/mcp-studio/install');
		expect(d.message).toContain('https://three.ws/api/mcp-studio?install=<token>');
		expect(d.data.remedy).toEqual({
			kind: 'install_token',
			install_endpoint: 'https://three.ws/api/mcp-studio/install',
			connector_url: 'https://three.ws/api/mcp-studio?install=<token>',
		});
	});

	it('tells a capped account when its budget resets', async () => {
		const capped = await exhaust('203.0.113.50', null, 'acct-denial-1');
		const { message, data } = capped.json.error;
		expect(message).toContain('4 generations per minute for this three.ws account');
		expect(message).toMatch(/resets at \d{4}-\d{2}-\d{2}T[\d:.]+Z \(in \d+ s\)/);
		expect(data.remedy).toEqual({ kind: 'account', oauth_server: 'https://three.ws/api/mcp-3d' });
		expect(Date.parse(data.reset_at)).toBeGreaterThan(Date.now());
		expect(Number(capped.headers['retry-after'])).toBe(data.retry_after);
		expect(capped.json.id).toBe(rpcId);
	});

	it('points a caller that already has a token at the account server', () => {
		const d = handler.studioDenial({ bucket: 'hourly', kind: 'install', result: { reset: Date.now() + 60_000 }, surfacePath: '/api/mcp-studio' });
		expect(d.message).toContain('for this install token');
		expect(d.data.remedy).toEqual({ kind: 'account', oauth_server: 'https://three.ws/api/mcp-3d' });
	});

	it('names the platform-wide breaker with no token remedy', () => {
		const d = handler.studioDenial({ bucket: 'global', kind: 'install', result: { reset: Date.now() + 90_000 }, surfacePath: '/api/mcp-grok' });
		expect(d.message).toContain('the whole free studio');
		expect(d.data.keyed_on).toBe('platform');
		expect(d.data.remedy.kind).toBe('account');
	});

	it('answers a batch with one denial per request id', async () => {
		const ip = '203.0.113.52';
		await exhaust(ip, null, 'acct-batch-1');
		vi.mocked(generate).mockResolvedValue({ status: 'done', glb_url: 'https://three.ws/cdn/forge/fixture.glb' });
		const call = (id) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'forge_free', arguments: { prompt: 'a kite' } } });
		const { req, res, out } = httpPair({ url: '/api/mcp-studio', body: [call('a'), call('b')], ip, headers: { authorization: 'Bearer test-acct:acct-batch-1' } });
		await studioHandlerFull(req, res);
		const parsed = JSON.parse(out.body);
		expect(parsed.map((r) => r.id)).toEqual(['a', 'b']);
		expect(parsed.every((r) => r.error?.data?.limit === 'generation_burst')).toBe(true);
	});
});
