// Making a 3D model needs an account, on the MCP studio surfaces too.
//
// /api/mcp-studio, /api/mcp-chatgpt and /api/mcp-grok used to run every
// generation anonymously. Now a tool that creates or rigs a model (or hosts
// frames of one, or saves a persona) answers an anonymous caller with an
// isError result carrying the Apps SDK auth hint
// (`_meta["mcp/www_authenticate"]`), so a host such as ChatGPT prompts the user
// to connect their account, and nothing reaches the forge. A signed-in caller
// runs the tool as before, and the forge submit names the account
// (x-forge-on-behalf-user) so the model is theirs. Reads that create nothing
// (job status, the catalog, docs) stay open. Tool descriptors declare which is
// which with `securitySchemes`.

import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';
process.env.CRON_SECRET = 'vitest-cron-secret-creator-gate';

const API_KEY = 'sk_live_fixture_studio_creator_0123456789abcdef';
const API_KEY_HASH = createHash('sha256').update(API_KEY).digest('hex');
const KEY_ROW = {
	id: '6f1d2c3b-0000-4000-8000-00000000c0df',
	user_id: '9a8b7c6d-0000-4000-8000-0000000000bb',
	scope: 'avatars:read avatars:write',
	expires_at: null,
	revoked_at: null,
};

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...values) => {
		if (!Array.isArray(strings)) return Promise.resolve([]);
		const text = strings.join('?');
		if (/from api_keys where token_hash/.test(text)) return Promise.resolve(values.includes(API_KEY_HASH) ? [KEY_ROW] : []);
		return Promise.resolve([]);
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false, isStoragePressured: () => false };
});

vi.mock('../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const real = await importOriginal();
	const pass = async () => ({ success: true, limit: 1, remaining: 1, reset: Date.now() + 1000 });
	return {
		...real,
		limits: {
			...real.limits,
			studioIp: pass,
			studioGenBurst: pass,
			studioGenHourly: pass,
			studioGenPoolHourly: pass,
			studioGenerateGlobal: pass,
			mcpUser: pass,
		},
	};
});

const { dispatch, toolCatalogFor, CREATOR_TOOL_NAMES } = await import('../api/_mcp-studio/dispatch.js');
const { default: studioHandler } = await import('../api/mcp-studio.js');
const { default: chatgptHandler } = await import('../api/mcp-chatgpt.js');

const anon = { userId: null, rateKey: '127.0.0.1', scope: '' };
const ACCOUNT = { userId: KEY_ROW.user_id, source: 'apikey', scope: KEY_ROW.scope };

function mkReq(url = '/api/mcp-studio') {
	return { url, headers: { host: 'three.ws', 'x-forwarded-proto': 'https' } };
}

function call(name, args, id = 1) {
	return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

// A finished forge job, the synchronous-done shape /api/gpt-forge answers.
function doneForge() {
	return vi.fn(async () => ({
		ok: true,
		status: 200,
		json: async () => ({ status: 'done', glb_url: 'https://three.ws/cdn/creations/model.glb', job_id: 'JOB_1' }),
	}));
}

// A minimal http.IncomingMessage stand-in the studio handler can read a body from.
function httpReq({ url = '/api/mcp-studio', body, headers = {} }) {
	const raw = Buffer.from(JSON.stringify(body));
	return {
		method: 'POST',
		url,
		headers: { host: 'three.ws', 'x-forwarded-proto': 'https', 'content-type': 'application/json', ...headers },
		socket: { remoteAddress: '203.0.113.9' },
		async *[Symbol.asyncIterator]() {
			yield raw;
		},
		on(event, cb) {
			if (event === 'data') cb(raw);
			if (event === 'end') cb();
			return this;
		},
	};
}

function httpRes() {
	const headers = {};
	return {
		statusCode: 200,
		headers,
		body: '',
		headersSent: false,
		setHeader(k, v) {
			headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete headers[k.toLowerCase()];
		},
		writeHead(status, h = {}) {
			this.statusCode = status;
			for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
			return this;
		},
		write(chunk) {
			this.body += String(chunk);
			return true;
		},
		end(chunk) {
			if (chunk) this.body += String(chunk);
			this.writableEnded = true;
		},
		get json() {
			return JSON.parse(this.body);
		},
	};
}

let realFetch;
beforeEach(() => {
	realFetch = globalThis.fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	vi.restoreAllMocks();
});

describe('studio creator tools need an account', () => {
	it('names every tool that creates, rigs, renders or saves something', () => {
		expect([...CREATOR_TOOL_NAMES].sort()).toEqual(
			['create_agent_persona', 'forge_avatar', 'forge_free', 'look_at_model', 'mesh_forge', 'refine_model', 'rig_mesh', 'text_to_avatar', 'pano_capture_start', 'pano_capture_status', 'pano_capture_list', 'pano_scene_create', 'pano_scene_status'].sort(),
		);
	});

	for (const surface of ['full', 'chatgpt', 'grok']) {
		it(`refuses an anonymous forge_free on the ${surface} surface with a sign-in challenge and never submits`, async () => {
			globalThis.fetch = doneForge();
			const path = { full: '/api/mcp-studio', chatgpt: '/api/mcp-chatgpt', grok: '/api/mcp-grok' }[surface];
			const r = await dispatch(call('forge_free', { prompt: 'a brass telescope' }), anon, mkReq(path), { surface });
			expect(r.error).toBeUndefined();
			expect(r.result.isError).toBe(true);
			expect(r.result.structuredContent).toMatchObject({ error: true, status: 'sign_in_required' });
			expect(r.result.structuredContent.api_keys_url).toBe('https://three.ws/dashboard/api-keys');
			expect(r.result.structuredContent.sign_in_url).toBe(`https://three.ws${path}?auth=oauth`);
			const challenge = r.result._meta['mcp/www_authenticate'];
			expect(Array.isArray(challenge)).toBe(true);
			expect(challenge[0]).toMatch(/^Bearer resource_metadata="https:\/\/three\.ws\/\.well-known\/oauth-protected-resource[^"]*"/);
			expect(challenge[0]).toContain('error="insufficient_scope"');
			expect(r.result.content[0].text).toMatch(/Sign in/);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});
	}

	it('refuses every creator tool anonymously before validating or running it', async () => {
		globalThis.fetch = doneForge();
		const args = {
			forge_free: { prompt: 'a brass telescope' },
			text_to_avatar: { prompt: 'a knight' },
			mesh_forge: { prompt: 'a chair' },
			rig_mesh: { glb_url: 'https://three.ws/cdn/creations/model.glb' },
			forge_avatar: { prompt: 'a knight' },
			refine_model: { glb_url: 'https://three.ws/cdn/creations/model.glb', instruction: 'make it metallic' },
			look_at_model: { glb_url: 'https://three.ws/cdn/creations/model.glb' },
			create_agent_persona: { glb_url: 'https://three.ws/cdn/creations/model.glb', name: 'Ada' },
		};
		for (const name of CREATOR_TOOL_NAMES) {
			const r = await dispatch(call(name, args[name]), anon, mkReq(), { surface: 'full' });
			expect(r.result?.isError, name).toBe(true);
			expect(r.result.structuredContent.status, name).toBe('sign_in_required');
		}
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('runs forge_free for a signed-in account and names it on the forge submit', async () => {
		globalThis.fetch = doneForge();
		const r = await dispatch(call('forge_free', { prompt: 'a brass telescope' }), anon, mkReq(), { surface: 'full', account: ACCOUNT });
		expect(r.result.isError).toBeFalsy();
		expect(r.result.structuredContent.glbUrl).toBe('https://three.ws/cdn/creations/model.glb');
		const submit = globalThis.fetch.mock.calls.find(([url, init]) => String(url).includes('/api/gpt-forge') && init?.method === 'POST');
		expect(submit).toBeTruthy();
		const headers = submit[1].headers;
		expect(headers['x-forge-on-behalf-user']).toBe(ACCOUNT.userId);
		expect(headers['x-forge-on-behalf']).toBe('1');
		expect(headers['x-forge-seed']).toBe(process.env.CRON_SECRET);
	});

	it('runs rig_mesh for a signed-in account and names it on the rig submit', async () => {
		globalThis.fetch = vi.fn(async (url, init) => {
			if (String(url).includes('/api/gpt-forge') && init?.method === 'POST') {
				return { ok: true, status: 200, json: async () => ({ status: 'done', glb_url: 'https://three.ws/cdn/creations/rigged.glb', job_id: 'RIG_1' }) };
			}
			return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
		});
		await dispatch(call('rig_mesh', { glb_url: 'https://three.ws/cdn/creations/model.glb' }), anon, mkReq(), { surface: 'full', account: ACCOUNT });
		const submit = globalThis.fetch.mock.calls.find(([url, init]) => String(url).includes('/api/gpt-forge') && init?.method === 'POST');
		expect(submit).toBeTruthy();
		expect(submit[1].headers['x-forge-on-behalf-user']).toBe(ACCOUNT.userId);
	});

	it('leaves the reads that create nothing open to an anonymous caller', async () => {
		const r = await dispatch(call('check_job', { job_id: 'not-a-real-job' }), anon, mkReq(), { surface: 'full' });
		expect(r.result?.structuredContent?.status).not.toBe('sign_in_required');
	});
});

describe('studio tool descriptors declare securitySchemes', () => {
	for (const surface of ['full', 'chatgpt', 'grok']) {
		it(`${surface}: oauth2 on creator tools, noauth on the open reads`, () => {
			for (const tool of toolCatalogFor(surface)) {
				if (CREATOR_TOOL_NAMES.has(tool.name)) {
					expect(tool.securitySchemes, tool.name).toEqual([{ type: 'oauth2', scopes: ['avatars:write'] }]);
				} else {
					expect(tool.securitySchemes, tool.name).toEqual([{ type: 'noauth' }]);
				}
			}
		});
	}
});

describe('studio HTTP handler resolves the account on every surface', () => {
	it('answers an anonymous creation call with HTTP 200 and the in-band challenge', async () => {
		globalThis.fetch = doneForge();
		const res = httpRes();
		await studioHandler(httpReq({ body: call('forge_free', { prompt: 'a brass telescope' }) }), res);
		expect(res.statusCode).toBe(200);
		expect(res.json.result.isError).toBe(true);
		expect(res.json.result._meta['mcp/www_authenticate'][0]).toContain('resource_metadata=');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('runs the call for a caller that sends a three.ws API key', async () => {
		globalThis.fetch = doneForge();
		const res = httpRes();
		await chatgptHandler(
			httpReq({ url: '/api/mcp-chatgpt', body: call('forge_free', { prompt: 'a brass telescope' }), headers: { authorization: `Bearer ${API_KEY}` } }),
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.json.result.isError).toBeFalsy();
		const submit = globalThis.fetch.mock.calls.find(([url, init]) => String(url).includes('/api/gpt-forge') && init?.method === 'POST');
		expect(submit[1].headers['x-forge-on-behalf-user']).toBe(KEY_ROW.user_id);
	});

	it('refuses a bearer that does not verify with a 401 instead of serving it anonymously', async () => {
		const res = httpRes();
		await studioHandler(httpReq({ body: call('forge_free', { prompt: 'a brass telescope' }), headers: { authorization: 'Bearer sk_live_not_a_real_key_000000000000' } }), res);
		expect(res.statusCode).toBe(401);
		expect(String(res.getHeader('www-authenticate'))).toContain('resource_metadata=');
	});

	it('starts OAuth on ?auth=oauth for the studio surface too', async () => {
		const res = httpRes();
		await studioHandler(httpReq({ url: '/api/mcp-studio?auth=oauth', body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } }), res);
		expect(res.statusCode).toBe(401);
	});

	it('still serves discovery anonymously', async () => {
		const res = httpRes();
		await studioHandler(httpReq({ body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }), res);
		expect(res.statusCode).toBe(200);
		expect(res.json.result.tools.some((t) => t.name === 'forge_free')).toBe(true);
	});
});
