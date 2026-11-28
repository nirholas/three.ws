// A read-only OAuth grant on the studio surfaces cannot make anything.
//
// The consent screen lets a person untick "Create and update avatars"
// (avatars:write) and authorize with read access only. The studio creator
// tools never checked the token's scope, so a connector granted read-only
// access could still generate, rig, refine and save models in the account.
// Meta's Muse connector guidelines (3.1) require exactly that read-only option
// to hold. Now an OAuth token without avatars:write gets an insufficient_scope
// step-up result on the tools that create something, while the account reads
// (render views, 360 capture status and lists) keep working on avatars:read.
// API keys keep their own scope system (key-scopes.js) and are unaffected.

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

const { dispatch } = await import('../api/_mcp-studio/dispatch.js');

const anon = { userId: null, rateKey: '127.0.0.1', scope: '' };
const USER = KEY_ROW.user_id;
const readOnly = { userId: USER, source: 'oauth', clientId: 'muse-reviewer', scope: 'avatars:read profile offline_access' };
const readWrite = { ...readOnly, scope: 'avatars:read avatars:write profile offline_access' };
const apiKey = { userId: USER, source: 'apikey', scope: 'avatars:read' };

const mkReq = (url = '/api/mcp-studio') => ({ url, headers: { host: 'three.ws', 'x-forwarded-proto': 'https' } });
const call = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

function doneForge() {
	return vi.fn(async () => ({
		ok: true,
		status: 200,
		json: async () => ({ status: 'done', glb_url: 'https://three.ws/cdn/creations/model.glb', job_id: 'JOB_1' }),
	}));
}

const GLB = 'https://three.ws/cdn/creations/model.glb';
const WRITES = {
	forge_free: { prompt: 'a brass telescope' },
	mesh_forge: { prompt: 'a chair' },
	text_to_avatar: { prompt: 'a knight' },
	forge_avatar: { prompt: 'a knight' },
	rig_mesh: { glb_url: GLB },
	refine_model: { glb_url: GLB, instruction: 'make it metallic' },
	create_agent_persona: { glb_url: GLB, name: 'Ada' },
	pano_capture_start: { source_url: 'https://three.ws/cdn/pano/clip.mp4', kind: 'equirect_video' },
	pano_scene_create: { image_url: 'https://three.ws/cdn/pano/room.jpg', source_kind: 'equirect' },
};

let realFetch;
beforeEach(() => {
	realFetch = globalThis.fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	vi.restoreAllMocks();
});

describe('read-only OAuth grant on the studio', () => {
	for (const surface of ['full', 'chatgpt', 'grok']) {
		it(`refuses forge_free on the ${surface} surface with an avatars:write step-up and never submits`, async () => {
			globalThis.fetch = doneForge();
			const path = { full: '/api/mcp-studio', chatgpt: '/api/mcp-chatgpt', grok: '/api/mcp-grok' }[surface];
			const r = await dispatch(call('forge_free', WRITES.forge_free), anon, mkReq(path), { surface, account: readOnly });
			expect(r.error).toBeUndefined();
			expect(r.result.isError).toBe(true);
			expect(r.result.structuredContent).toMatchObject({ error: true, status: 'insufficient_scope', required_scope: 'avatars:write' });
			const challenge = r.result._meta['mcp/www_authenticate'][0];
			expect(challenge).toContain('error="insufficient_scope"');
			expect(challenge).toContain('scope="avatars:write"');
			expect(r.result.content[0].text).toMatch(/read-only/);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});
	}

	it('refuses every tool that creates something, before validating or running it', async () => {
		globalThis.fetch = doneForge();
		for (const [name, args] of Object.entries(WRITES)) {
			const r = await dispatch(call(name, args), anon, mkReq(), { surface: 'full', account: readOnly });
			expect(r.result?.isError, name).toBe(true);
			expect(r.result.structuredContent.status, name).toBe('insufficient_scope');
		}
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('still lets the read-only grant reach the account reads', async () => {
		globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
		for (const name of ['look_at_model', 'pano_capture_list', 'pano_capture_status', 'pano_scene_status']) {
			const args = name === 'look_at_model' ? { glb_url: GLB } : name === 'pano_capture_list' ? {} : { job_id: 'JOB_1' };
			const r = await dispatch(call(name, args), anon, mkReq(), { surface: 'full', account: readOnly });
			expect(r.result?.structuredContent?.status, name).not.toBe('insufficient_scope');
			expect(r.result?.structuredContent?.status, name).not.toBe('sign_in_required');
		}
	});

	it('runs forge_free when the grant includes avatars:write', async () => {
		globalThis.fetch = doneForge();
		const r = await dispatch(call('forge_free', WRITES.forge_free), anon, mkReq(), { surface: 'full', account: readWrite });
		expect(r.result.isError).toBeFalsy();
		expect(r.result.structuredContent.glbUrl).toBe(GLB);
	});

	it('leaves API keys on their own scope system', async () => {
		globalThis.fetch = doneForge();
		const r = await dispatch(call('forge_free', WRITES.forge_free), anon, mkReq(), { surface: 'full', account: apiKey });
		expect(r.result.isError).toBeFalsy();
	});
});
