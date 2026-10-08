// A self-serve Premium pass key only bypasses payment on the routes the pass is
// sold for. Before this gate any active x402_subscriptions key, including a
// $19.99 archive-search pass, skipped the 402 on every paid route, so the pass
// launched coins on the platform's SOL and ran GPU pipelines for free.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let sub = null;
const logAccess = vi.fn();
vi.mock('../api/_lib/x402/api-keys.js', () => ({
	lookupSubscription: vi.fn(async () => sub),
	checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 10, limit: 120, resetAt: Date.now() + 60_000 })),
	logAccess: (...a) => logAccess(...a),
}));
vi.mock('../api/_lib/aws-marketplace-bridge.js', () => ({
	isAwsCustomerInactive: vi.fn(async () => false),
	meterAwsSubscriptionUsage: vi.fn(),
}));
vi.mock('../api/_lib/auth.js', () => ({
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
	hasScope: vi.fn(() => false),
}));
vi.mock('../api/_lib/rate-limit.js', () => ({ clientIp: () => '127.0.0.1' }));

const { installAccessControl, subscriptionCoversRoute } = await import('../api/_lib/x402/access-control.js');

const req = { headers: { 'x-api-key': 'x402_live_abcdef' } };
const hook = installAccessControl({ requiredScope: 'x402:bypass' });

beforeEach(() => { logAccess.mockClear(); });

describe('premium pass key scope', () => {
	it('grants the archive route it is sold for', async () => {
		sub = { id: 's1', name: 'pass', meta: { source: 'premium-pass' } };
		const r = await hook(req, { path: '/api/news/archive' });
		expect(r?.grantAccess).toBe(true);
	});

	it('does not bypass payment on any other paid route; the caller gets the 402', async () => {
		sub = { id: 's1', name: 'pass', meta: { source: 'premium-pass' } };
		for (const path of ['/api/x402/pump-launch', '/api/x402/vanity', '/api/x402/pipeline', '/api/x402/llm-proxy']) {
			const r = await hook(req, { path });
			expect(r, path).toBeNull();
		}
		expect(logAccess).toHaveBeenCalledWith(expect.objectContaining({ granted: false, reason: 'Premium pass does not cover this route' }));
	});

	it('leaves operator-issued partner keys at full scope', async () => {
		sub = { id: 'p1', name: 'Partner', meta: { source: 'admin' } };
		const r = await hook(req, { path: '/api/x402/pipeline' });
		expect(r?.grantAccess).toBe(true);
		expect(subscriptionCoversRoute({ meta: null }, '/api/x402/anything')).toBe(true);
	});
});
