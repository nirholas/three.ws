// Two concurrent issue-key calls for the same marketplace row must not leave an
// orphan, unrevokable key: the loser of the link race revokes its own mint and
// returns the winner's subscription.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../../api/_lib/db.js', () => ({
	sql: (...a) => sqlMock(...a),
}));
const createMock = vi.fn();
const revokeMock = vi.fn();
vi.mock('../../api/_lib/x402/api-keys.js', () => ({
	createSubscription: (...a) => createMock(...a),
	revokeSubscription: (...a) => revokeMock(...a),
}));
vi.mock('../../api/_lib/aws-marketplace.js', () => ({ meterUsage: vi.fn() }));

const { issueSubscriptionForCustomer } = await import('../../api/_lib/aws-marketplace-bridge.js');

const text = (strings) => strings.join('?').replace(/\s+/g, ' ');

beforeEach(() => {
	vi.clearAllMocks();
	createMock.mockResolvedValue({ id: 'sub-loser', key_prefix: 'kp', token: 'tok', rate_limit_per_minute: 60 });
});

describe('issueSubscriptionForCustomer concurrency', () => {
	it('revokes its own mint and returns the winner when the link race is lost', async () => {
		sqlMock.mockImplementation(async (strings) => {
			const q = text(strings);
			if (/^ select c\.x402_subscription_id/.test(q) && sqlMock.mock.calls.length === 1) return [{}];
			if (/update aws_marketplace_customers/.test(q)) return []; // CAS lost
			if (/select c\.x402_subscription_id/.test(q))
				return [{ x402_subscription_id: 'sub-winner', key_prefix: 'wp', rate_limit_per_minute: 60, revoked_at: null, expires_at: null }];
			return [];
		});
		const out = await issueSubscriptionForCustomer({ id: 'row-1' });
		expect(revokeMock).toHaveBeenCalledWith('sub-loser');
		expect(out.subscriptionId).toBe('sub-winner');
		expect(out.token).toBeNull();
		expect(out.alreadyIssued).toBe(true);
	});

	it('keeps its mint when the link write wins', async () => {
		sqlMock.mockImplementation(async (strings) => {
			const q = text(strings);
			if (/update aws_marketplace_customers/.test(q)) return [{ id: 'row-1' }];
			return [{}];
		});
		const out = await issueSubscriptionForCustomer({ id: 'row-1' });
		expect(revokeMock).not.toHaveBeenCalled();
		expect(out.subscriptionId).toBe('sub-loser');
		expect(out.token).toBe('tok');
	});
});
