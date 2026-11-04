// $THREE hold-to-access gate on the drop early window (drops.early, Gold).
//
//   • inside the window, a non-holder reveal      → 402 three_hold_required
//   • inside the window, a Gold pass              → gate lets it through
//   • inside the window, a Silver pass            → still 402 (below Gold)
//   • inside the window, the drop's creator       → never locked out
//   • after the window / on a legacy drop         → open to everyone
//
// drop-store and auth are stubbed with fixtures of the exact row shape; the
// window math itself is covered with an injected clock.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Readable } from 'node:stream';
import { signTierPass } from '../api/_lib/three-tier.js';
import {
	clampEarlyMinutes,
	defaultEarlyMinutes,
	dropEarlyWindowOpen,
	publicOpensAt,
} from '../api/_lib/early-window.js';
import { GATED_FEATURES } from '../api/_lib/three-access.js';

const state = { drop: null };

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getSessionUser: async () => ({ id: 'visitor-1' }),
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../api/_lib/drop-store.js', async (orig) => ({
	...(await orig()),
	dropsConfigured: () => true,
	getDropBySlug: async () => state.drop,
	claimForReveal: async () => null,
	getItem: async () => ({ index: 0, status: 'revealed' }),
}));

let handler;
const WALLET = 'THREEsynthetic1111111111111111111111111111';

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}
function mockReq(body, headers = {}) {
	const r = Readable.from([Buffer.from(JSON.stringify(body))]);
	r.method = 'POST';
	r.url = '/api/drops/reveal';
	r.query = { action: 'reveal' };
	r.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', ...headers };
	return r;
}
function drop(over = {}) {
	return {
		id: 'd1', slug: 'neon', status: 'live', supply: 10, layers: [], style: 'neon',
		is_owner: false, public_opens_at: new Date(Date.now() + 600_000).toISOString(), ...over,
	};
}
async function reveal(headers) {
	const res = mockRes();
	await handler(mockReq({ slug: 'neon', index: 0 }, headers), res);
	return res;
}

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	delete process.env.HOLDER_PASS_SECRET;
	handler = (await import('../api/drops/[action].js')).default;
});

describe('drops.early registry', () => {
	it('is enforced, Gold-tier', () => {
		expect(GATED_FEATURES['drops.early']).toMatchObject({ enforced: true, minLevel: 3 });
	});
});

describe('early window math', () => {
	const now = Date.UTC(2026, 10, 5, 12, 0, 0);
	it('is open strictly before public_opens_at', () => {
		const at = new Date(now + 1000).toISOString();
		expect(dropEarlyWindowOpen({ public_opens_at: at }, now)).toBe(true);
		expect(dropEarlyWindowOpen({ public_opens_at: at }, now + 1000)).toBe(false);
		expect(dropEarlyWindowOpen({ public_opens_at: at }, now + 5000)).toBe(false);
	});
	it('treats a legacy row (null) as open to everyone', () => {
		expect(dropEarlyWindowOpen({ public_opens_at: null }, now)).toBe(false);
		expect(dropEarlyWindowOpen(null, now)).toBe(false);
	});
	it('computes the public open instant from minutes', () => {
		expect(publicOpensAt(15, now).getTime()).toBe(now + 15 * 60_000);
		expect(publicOpensAt(0, now).getTime()).toBe(now);
	});
	it('clamps and defaults the creator-chosen window', () => {
		expect(clampEarlyMinutes(-5)).toBe(0);
		expect(clampEarlyMinutes(99999999)).toBe(10080);
		expect(clampEarlyMinutes('abc', 15)).toBe(15);
		expect(defaultEarlyMinutes({})).toBe(15);
		expect(defaultEarlyMinutes({ DROPS_EARLY_DEFAULT_MINUTES: '0' })).toBe(0);
	});
});

describe('POST /api/drops/reveal inside the early window', () => {
	it('blocks a non-holder with a Gold-tier hold-or-pay 402', async () => {
		state.drop = drop();
		const res = await reveal();
		expect(res.statusCode).toBe(402);
		expect(res.json.error).toBe('three_hold_required');
		expect(res.json.feature).toBe('drops.early');
		expect(res.json.required).toMatchObject({ level: 3, id: 'gold' });
	});

	it('lets a Gold pass through to the reveal path', async () => {
		state.drop = drop();
		const pass = signTierPass({ wallet: WALLET, level: 3, tierId: 'gold', usd: 600 });
		const res = await reveal({ 'x-three-tier-pass': pass });
		expect(res.statusCode).not.toBe(402);
		expect(res.json.already).toBe(true);
	});

	it('still blocks a Silver pass (below Gold)', async () => {
		state.drop = drop();
		const pass = signTierPass({ wallet: WALLET, level: 2, tierId: 'silver', usd: 150 });
		const res = await reveal({ 'x-three-tier-pass': pass });
		expect(res.statusCode).toBe(402);
		expect(res.json.reason).toBe('insufficient_tier');
	});

	it('never locks the creator out of their own drop', async () => {
		state.drop = drop({ is_owner: true });
		const res = await reveal();
		expect(res.statusCode).not.toBe(402);
	});
});

describe('POST /api/drops/reveal once the window closes', () => {
	it('is open to a non-holder after public_opens_at', async () => {
		state.drop = drop({ public_opens_at: new Date(Date.now() - 1000).toISOString() });
		const res = await reveal();
		expect(res.statusCode).not.toBe(402);
	});

	it('is open on a legacy drop with no window', async () => {
		state.drop = drop({ public_opens_at: null });
		const res = await reveal();
		expect(res.statusCode).not.toBe(402);
	});
});
