// Referral farming controls beyond the monthly cap: attribution claims are
// bounded per IP, and a referrer's activation rewards are bounded per day so a
// scripted ring cannot burn the whole monthly allowance in one burst.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from './_helpers/monetization.js';
import { parseRewardConfig } from '../api/_lib/referral-rewards.js';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({
	sql: (...a) => sqlMock(...a),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/auth.js', () => ({ getSessionUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));
const claimLimiter = vi.fn();
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		authIp: async () => ({ success: true }),
		referralClaimIp: (...a) => claimLimiter(...a),
	},
	clientIp: () => '203.0.113.7',
}));
vi.mock('../api/_lib/credits.js', () => ({ creditAccount: vi.fn(async () => ({ replay: false })) }));

beforeEach(() => {
	sqlMock.mockReset().mockResolvedValue([]);
	claimLimiter.mockReset();
});

describe('POST /api/users/referral-claim', () => {
	it('answers 429 once the per-IP claim budget is spent, before touching the database', async () => {
		claimLimiter.mockResolvedValue({ success: false, reset: Date.now() + 1000, limit: 10, remaining: 0 });
		const { default: handler } = await import('../api/users/referral-claim.js');
		const r = await invoke(handler, { method: 'POST', url: '/api/users/referral-claim', body: { code: 'ABC123' } });
		expect(r.status).toBe(429);
		expect(claimLimiter).toHaveBeenCalledWith('203.0.113.7');
		expect(sqlMock).not.toHaveBeenCalled();
	});
});

describe('referrer daily activation cap', () => {
	it('defaults to a daily cap far below the monthly cap and clamps env input', () => {
		expect(parseRewardConfig({}).dailyCap).toBe(20);
		expect(parseRewardConfig({ REFERRAL_ACTIVATION_DAILY_CAP: '5' }).dailyCap).toBe(5);
		expect(parseRewardConfig({ REFERRAL_ACTIVATION_DAILY_CAP: '-1' }).dailyCap).toBe(20);
	});

	it('withholds the referrer reward once the daily cap is reached', async () => {
		const { grantReferralActivationReward } = await import('../api/_lib/referral-rewards.js');
		const { creditAccount } = await import('../api/_lib/credits.js');
		creditAccount.mockClear();
		sqlMock.mockImplementation(async (strings) => {
			const q = strings.join(' ').replace(/\s+/g, ' ');
			if (/referred_by_id, display_name/.test(q)) return [{ id: 'new', referred_by_id: 'ref' }];
			if (/from users where id/.test(q)) return [{ id: 'ref' }];
			if (/count\(\*\)/.test(q) && /1 day/.test(q)) return [{ count: 20 }];
			if (/count\(\*\)/.test(q)) return [{ count: 0 }];
			return [];
		});
		const r = await grantReferralActivationReward({ referredUserId: 'new' });
		expect(r.referrerCapped).toBe(true);
		expect(r.referrerCredited).toBe(false);
	});
});
