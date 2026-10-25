// Account routes (earnings, referral code, referral card, transaction history)
// accepted ANY valid bearer. A narrow key (an `inference`-only key, a connector
// preset) could read the owner's earnings or rewrite their referral code. These
// routes now demand the `profile` scope from a bearer, mirroring api/api-keys/[id].js.
// A cookie session is the person and is unaffected.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from './_helpers/monetization.js';

let sessionUser = null;
let bearer = null;
vi.mock('../api/_lib/auth.js', () => {
	return {
		getSessionUser: vi.fn(async () => sessionUser),
		authenticateBearer: vi.fn(async () => bearer),
		extractBearer: vi.fn(() => 'sk_live_synthetic'),
		hasScope: (granted, required) =>
			required.split(/\s+/).every((s) => String(granted || '').split(/\s+/).includes(s)),
	};
});
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', () => {
	const ok = async () => ({ success: true, reset: Date.now() + 1000, limit: 100, remaining: 99 });
	return {
		limits: new Proxy({}, { get: () => ok }),
		clientIp: () => '127.0.0.1',
	};
});
vi.mock('../api/_lib/services/MonetizationService.js', () => ({
	MonetizationService: class {
		async getCreatorEconomics() {
			return { pending_usd: 0 };
		}
	},
}));
vi.mock('../api/_lib/referrals.js', () => ({
	getReferralCodeAvailability: vi.fn(async () => ({ available: true })),
	setReferralCode: vi.fn(async () => ({ referral_code: 'ABC', changed: true })),
	getMembershipCard: vi.fn(async () => ({})),
	getReferredUsers: vi.fn(async () => []),
	getReferralFunnel: vi.fn(async () => ({})),
	REFERRAL_CODE_MIN_LEN: 3,
	REFERRAL_CODE_MAX_LEN: 20,
}));

const routes = {
	earnings: () => import('../api/users/earnings.js'),
	'referral-code': () => import('../api/users/referral-code.js'),
	referrals: () => import('../api/users/referrals.js'),
	'transaction-history': () => import('../api/users/me/transaction-history.js'),
};

beforeEach(() => {
	sessionUser = null;
	bearer = null;
});

describe.each(Object.keys(routes))('%s bearer scope', (name) => {
	it('refuses a bearer without the profile scope with 403 insufficient_scope', async () => {
		bearer = { userId: 'u1', scope: 'inference avatars:read', source: 'apikey' };
		const { default: handler } = await routes[name]();
		const r = await invoke(handler, { method: 'GET', url: `/api/users/${name}` });
		expect(r.status ?? r.statusCode).toBe(403);
		expect(JSON.stringify(r.payload ?? r.json ?? r.body)).toContain('insufficient_scope');
	});

	it('lets a bearer holding profile through the scope gate', async () => {
		bearer = { userId: 'u1', scope: 'profile', source: 'apikey' };
		const { default: handler } = await routes[name]();
		const r = await invoke(handler, { method: 'GET', url: `/api/users/${name}` });
		expect(r.status ?? r.statusCode).not.toBe(403);
	});

	it('does not scope-limit a cookie session', async () => {
		sessionUser = { id: 'u1' };
		const { default: handler } = await routes[name]();
		const r = await invoke(handler, { method: 'GET', url: `/api/users/${name}` });
		expect(r.status ?? r.statusCode).not.toBe(403);
	});
});
