// $THREE hold-to-access gate on rare *.threews.sol names (names.first_dibs, Genesis).
//
// While THREEWS_RARE_NAMES_PUBLIC_AT is in the future, claiming a label above
// Common rarity needs a Genesis pass. Common labels and an unset/elapsed window
// are untouched.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { signTierPass } from '../api/_lib/three-tier.js';
import { rareNameWindowOpen } from '../api/_lib/early-window.js';
import { GATED_FEATURES } from '../api/_lib/three-access.js';
import { priceName } from '../api/_lib/pricing/name-rarity.js';

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getSessionUser: async () => ({ id: 'visitor-1' }),
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../api/_lib/db.js', async (orig) => ({
	...(await orig()),
	sql: Object.assign(async () => [], { json: (v) => v }),
}));
vi.mock('../api/_lib/threews-sns.js', async (orig) => ({
	...(await orig()),
	hasOwnerKey: () => true,
	getSubdomainOwner: async () => null,
}));

let handler;
const WALLET = 'THREEsynthetic1111111111111111111111111111';
const FUTURE = () => new Date(Date.now() + 3600_000).toISOString();

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}
async function check(label) {
	const r = Readable.from([]);
	r.method = 'GET';
	r.url = `/api/threews/subdomain?label=${encodeURIComponent(label)}`;
	r.headers = { origin: 'http://localhost:3000' };
	const res = mockRes();
	await handler(r, res);
	return res;
}
async function claim(label, headers = {}) {
	const r = Readable.from([Buffer.from(JSON.stringify({ label }))]);
	r.method = 'POST';
	r.url = '/api/threews/subdomain';
	r.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', ...headers };
	const res = mockRes();
	await handler(r, res);
	return res;
}

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	delete process.env.HOLDER_PASS_SECRET;
	handler = (await import('../api/threews/subdomain.js')).default;
});
beforeEach(() => { process.env.THREEWS_RARE_NAMES_PUBLIC_AT = FUTURE(); });
afterEach(() => { delete process.env.THREEWS_RARE_NAMES_PUBLIC_AT; });

describe('names.first_dibs registry', () => {
	it('is enforced, Genesis-tier', () => {
		expect(GATED_FEATURES['names.first_dibs']).toMatchObject({ enforced: true, minLevel: 4 });
	});
	it('fixtures: "ab" is rare-priced, "a-much-longer-handle" is Common', () => {
		expect(priceName('ab').free).toBe(false);
		expect(priceName('a-much-longer-handle').free).toBe(true);
	});
});

describe('rare name window', () => {
	const now = Date.UTC(2026, 10, 5);
	it('is open only while the configured instant is in the future', () => {
		expect(rareNameWindowOpen({ THREEWS_RARE_NAMES_PUBLIC_AT: new Date(now + 1).toISOString() }, now)).toBe(true);
		expect(rareNameWindowOpen({ THREEWS_RARE_NAMES_PUBLIC_AT: new Date(now).toISOString() }, now)).toBe(false);
		expect(rareNameWindowOpen({}, now)).toBe(false);
		expect(rareNameWindowOpen({ THREEWS_RARE_NAMES_PUBLIC_AT: 'garbage' }, now)).toBe(false);
	});
});

describe('POST /api/threews/subdomain during the rare-name window', () => {
	it('blocks a non-holder claiming a rare label with a Genesis 402', async () => {
		const res = await claim('ab');
		expect(res.statusCode).toBe(402);
		expect(res.json.error).toBe('three_hold_required');
		expect(res.json.feature).toBe('names.first_dibs');
		expect(res.json.required).toMatchObject({ level: 4, id: 'genesis' });
	});

	it('blocks a Gold pass (below Genesis)', async () => {
		const pass = signTierPass({ wallet: WALLET, level: 3, tierId: 'gold', usd: 600 });
		const res = await claim('ab', { 'x-three-tier-pass': pass });
		expect(res.statusCode).toBe(402);
	});

	it('lets a Genesis pass past the gate', async () => {
		const pass = signTierPass({ wallet: WALLET, level: 4, tierId: 'genesis', usd: 3000 });
		const res = await claim('ab', { 'x-three-tier-pass': pass });
		expect(res.statusCode).not.toBe(402);
	});

	it('never gates a Common label', async () => {
		const res = await claim('a-much-longer-handle');
		expect(res.statusCode).not.toBe(402);
	});

	it('does not gate anything once the window is unset', async () => {
		delete process.env.THREEWS_RARE_NAMES_PUBLIC_AT;
		const res = await claim('ab');
		expect(res.statusCode).not.toBe(402);
	});
});

describe('GET /api/threews/subdomain reports the holder window so the page can show it', () => {
	it('flags a rare label inside the window with its Genesis requirement and public open time', async () => {
		const res = await check('ab');
		expect(res.statusCode).toBe(200);
		const w = res.json.data.holder_window;
		expect(w).toMatchObject({ feature: 'names.first_dibs', required: { level: 4, id: 'genesis' } });
		expect(new Date(w.public_opens_at).toISOString()).toBe(process.env.THREEWS_RARE_NAMES_PUBLIC_AT);
		expect(res.json.data.rarity).toMatchObject({ tier: priceName('ab').rarity, free: false });
		expect(res._headers['cache-control']).toBe('no-store');
	});

	it('reports no window for a Common label', async () => {
		const res = await check('a-much-longer-handle');
		expect(res.json.data.holder_window).toBeNull();
	});

	it('reports no window once the configured instant is unset', async () => {
		delete process.env.THREEWS_RARE_NAMES_PUBLIC_AT;
		const res = await check('ab');
		expect(res.json.data.holder_window).toBeNull();
	});
});
