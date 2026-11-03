// A VRoid Hub creator's license is stored on the avatar at import. These tests
// drive the real handlers and pin that each surface asks the gate before it
// exceeds that license, answering 403 license_restricted, and that an ordinary
// avatar (no VRoid block) and the creator's own avatar are never blocked.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVroidBlock } from '../api/_lib/vroid/license-gate.js';

const AVATAR = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';

const CLOSED = {
	characterization_allowed_user: 'author',
	redistribution: 'disallow',
	modification: 'disallow',
	personal_commercial_use: 'disallow',
	corporate_commercial_use: 'disallow',
	credit: 'necessary',
};
const OPEN = {
	characterization_allowed_user: 'everyone',
	redistribution: 'allow',
	modification: 'allow',
	personal_commercial_use: 'profit',
	corporate_commercial_use: 'allow',
	credit: 'unnecessary',
};
const metaFor = (license, isAuthor = false) => ({
	vroid: buildVroidBlock({
		characterModelId: '123',
		characterId: '45',
		creatorName: 'Alex',
		characterName: 'Mika',
		license,
		isAuthor,
		importedAt: '2026-11-03T00:00:00.000Z',
	}),
});

const calls = [];
let avatarRow = null;
let body = {};

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...vals) => {
		const q = strings.join('?').toLowerCase();
		calls.push({ q, vals });
		if (/join avatars/.test(q)) return avatarRow ? [avatarRow] : [];
		if (/from agent_identities/.test(q)) return [{ id: 'a1', user_id: 'u1', meta: {}, avatar_id: avatarRow?.id ?? null }];
		if (/from avatars/.test(q)) return avatarRow ? [avatarRow] : [];
		if (/update agent_identities/.test(q)) return [{ id: 'a1', user_id: 'u1', meta: {} }];
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

vi.mock('../api/_lib/http.js', async (orig) => ({
	...(await orig()),
	readJson: vi.fn(async () => body),
}));

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getSessionUser: vi.fn(async () => ({ id: 'u1' })),
	authenticateBearer: vi.fn(async () => null),
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', async (orig) => {
	const real = await orig();
	const ok = async () => ({ success: true });
	return { ...real, limits: new Proxy({}, { get: () => ok }), clientIp: () => '127.0.0.1' };
});
vi.mock('../api/_lib/avatars.js', async (orig) => ({
	...(await orig()),
	updateAvatar: vi.fn(async ({ id, patch }) => ({ id, ...patch, storage_key: 'u/u1/a.glb' })),
}));
vi.mock('../api/_lib/webhook-dispatch.js', () => ({ dispatchWebhooks: vi.fn(async () => {}) }));

const { handleUpdate } = await import('../api/agents.js');
const { default: avatarHandler } = await import('../api/avatars/[id].js');
const { default: priceHandler } = await import('../api/marketplace/asset-price.js');

function res() {
	return {
		statusCode: 0,
		headers: {},
		setHeader(k, v) { this.headers[k] = v; },
		getHeader(k) { return this.headers[k]; },
		end(b) { this.body = b; },
		json() { return JSON.parse(this.body || '{}'); },
	};
}
const req = (method, extra = {}) => ({ method, headers: { origin: 'https://three.ws' }, url: '/x', query: {}, ...extra });
const wrote = (re) => calls.some((c) => re.test(c.q));

beforeEach(() => {
	calls.length = 0;
	avatarRow = null;
	body = {};
});

describe('agent bound to a VRoid avatar (public_agent)', () => {
	it('refuses to attach a character whose license keeps it off public agents', async () => {
		avatarRow = { id: AVATAR, source_meta: metaFor(CLOSED) };
		body = { avatar_id: AVATAR };
		const r = res();
		await handleUpdate(req('PATCH'), r, 'a1', { userId: 'u1', source: 'session' });
		expect(r.statusCode).toBe(403);
		expect(r.json().error).toBe('license_restricted');
		expect(r.json().error_description).toContain("Alex's VRoid Hub license");
		expect(wrote(/update agent_identities/)).toBe(false);
	});

	it('allows a character whose license permits public agents', async () => {
		avatarRow = { id: AVATAR, source_meta: metaFor(OPEN) };
		body = { avatar_id: AVATAR };
		const r = res();
		await handleUpdate(req('PATCH'), r, 'a1', { userId: 'u1', source: 'session' });
		expect(r.statusCode).toBe(200);
	});

	it('allows the creator to put their own closed character on an agent', async () => {
		avatarRow = { id: AVATAR, source_meta: metaFor(CLOSED, true) };
		body = { avatar_id: AVATAR };
		const r = res();
		await handleUpdate(req('PATCH'), r, 'a1', { userId: 'u1', source: 'session' });
		expect(r.statusCode).toBe(200);
	});

	it('does not touch an ordinary avatar', async () => {
		avatarRow = { id: AVATAR, source_meta: {} };
		body = { avatar_id: AVATAR };
		const r = res();
		await handleUpdate(req('PATCH'), r, 'a1', { userId: 'u1', source: 'session' });
		expect(r.statusCode).toBe(200);
	});
});

describe('avatar PATCH (export, modify)', () => {
	beforeEach(() => {
		avatarRow = { id: AVATAR, owner_id: 'u1', source_meta: metaFor(CLOSED) };
	});

	it('refuses to make a no-redistribution character public or unlisted', async () => {
		for (const visibility of ['public', 'unlisted']) {
			body = { visibility };
			const r = res();
			await avatarHandler(req('PATCH', { query: { id: AVATAR } }), r);
			expect(r.statusCode).toBe(403);
			expect(r.json().error).toBe('license_restricted');
		}
	});

	it('lets the owner keep it private and rename it', async () => {
		body = { visibility: 'private', name: 'Mika' };
		const r = res();
		await avatarHandler(req('PATCH', { query: { id: AVATAR } }), r);
		expect(r.statusCode).toBe(200);
	});

	it('refuses an appearance change when the license disallows modification', async () => {
		body = { appearance: null };
		const r = res();
		await avatarHandler(req('PATCH', { query: { id: AVATAR } }), r);
		expect(r.statusCode).toBe(403);
		expect(r.json().action).toBe('modify');
	});

	it('refuses replacing the GLB when the license disallows modification', async () => {
		body = { glbUrl: 'u/u1/new.glb' };
		const r = res();
		await avatarHandler(req('PATCH', { query: { id: AVATAR } }), r);
		expect(r.statusCode).toBe(403);
		expect(r.json().action).toBe('modify');
	});

	it('allows the public visibility when redistribution is allowed', async () => {
		avatarRow = { id: AVATAR, owner_id: 'u1', source_meta: metaFor(OPEN) };
		body = { visibility: 'public' };
		const r = res();
		await avatarHandler(req('PATCH', { query: { id: AVATAR } }), r);
		expect(r.statusCode).toBe(200);
	});
});

describe('sale price (export + monetize)', () => {
	const post = async (item_type, amount) => {
		body = { item_type, item_id: item_type === 'agent' ? AGENT : AVATAR, amount, currency_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', chain: 'solana', mint_decimals: 6 };
		const r = res();
		await priceHandler(req('POST'), r);
		return r;
	};

	beforeEach(() => {
		avatarRow = { id: AVATAR, owner_id: 'u1', user_id: 'u1', source_meta: metaFor(CLOSED) };
	});

	it('refuses to put a price on a character whose license forbids commercial use', async () => {
		const r = await post('avatar', 1_000_000);
		expect(r.statusCode).toBe(403);
		expect(r.json().error).toBe('license_restricted');
		expect(wrote(/insert into asset_prices/)).toBe(false);
	});

	it('refuses a price on an agent that wears such a character', async () => {
		const r = await post('agent', 1_000_000);
		expect(r.statusCode).toBe(403);
		expect(r.json().error).toBe('license_restricted');
	});

	it('still lets the owner set the price back to free', async () => {
		const r = await post('avatar', 0);
		expect(r.statusCode).toBe(200);
	});

	it('allows a price when export and a commercial grant are both open', async () => {
		avatarRow = { id: AVATAR, owner_id: 'u1', user_id: 'u1', source_meta: metaFor(OPEN) };
		const r = await post('avatar', 1_000_000);
		expect(r.statusCode).toBe(200);
	});
});
