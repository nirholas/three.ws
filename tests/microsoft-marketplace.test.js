// Pure rules behind the Microsoft Marketplace SaaS offer
// (api/_lib/microsoft-marketplace.js): webhook token claims, Entra sign-in
// claims, plan mapping and entitlement, tenant matching, the Fulfillment API
// to column mapping, and the hourly metering window.

import { describe, it, expect } from 'vitest';
import {
	MARKETPLACE_APP_ID, MarketplaceError, DIMENSIONS,
	checkWebhookClaims, ssoClaimsFromPayload, identityMatchesSubscription,
	planForMicrosoftPlan, highestPlan, entitles, subscriptionColumns, publicSubscription,
	floorHour, hoursToMeter, settleUsageStatus, chunk,
	METERING_LOOKBACK_HOURS, METERING_BATCH_MAX,
} from '../api/_lib/microsoft-marketplace.js';

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const CLIENT = '0b8d3f4e-1111-4c3a-9a77-5f0d2c1e9a01';
const H = 3_600_000;

function webhookPayload(over = {}) {
	return { iss: `https://sts.windows.net/${TENANT}/`, tid: TENANT, aud: CLIENT, appid: MARKETPLACE_APP_ID, ...over };
}

function expectCode(fn, code) {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(MarketplaceError);
		expect(err.code).toBe(code);
		return;
	}
	throw new Error(`expected ${code}`);
}

describe('checkWebhookClaims', () => {
	const opts = { tenantId: TENANT, clientId: CLIENT };

	it('accepts a v1 token from the publisher tenant sent by the Marketplace app', () => {
		expect(checkWebhookClaims(webhookPayload(), opts)).toBe(true);
	});

	it('accepts a v2 issuer, an api:// audience and azp in place of appid', () => {
		const p = webhookPayload({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: `api://${CLIENT}`, appid: undefined, azp: MARKETPLACE_APP_ID });
		expect(checkWebhookClaims(p, opts)).toBe(true);
	});

	it('rejects another tenant as issuer', () => {
		expectCode(() => checkWebhookClaims(webhookPayload({ iss: 'https://sts.windows.net/00000000-0000-0000-0000-000000000000/' }), opts), 'invalid_webhook_token');
	});

	it('rejects a tid that disagrees with the issuer', () => {
		expectCode(() => checkWebhookClaims(webhookPayload({ tid: 'other' }), opts), 'invalid_webhook_token');
	});

	it('rejects a token for a different audience', () => {
		expectCode(() => checkWebhookClaims(webhookPayload({ aud: 'someone-else' }), opts), 'invalid_webhook_token');
	});

	it('rejects a token the Marketplace app did not request', () => {
		expectCode(() => checkWebhookClaims(webhookPayload({ appid: 'not-marketplace' }), opts), 'invalid_webhook_token');
	});

	it('rejects a missing payload', () => {
		expectCode(() => checkWebhookClaims(null, opts), 'invalid_webhook_token');
	});
});

describe('ssoClaimsFromPayload', () => {
	const base = {
		oid: 'oid-1', tid: TENANT, aud: CLIENT,
		iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
		nonce: 'n1', email: 'Buyer@Contoso.com', name: 'Buyer One',
	};

	it('builds a tenant-scoped subject and lowercases the email, never marking it verified', () => {
		const c = ssoClaimsFromPayload(base, { nonce: 'n1', clientId: CLIENT });
		expect(c.subject).toBe(`${TENANT}:oid-1`);
		expect(c.tenant_id).toBe(TENANT);
		expect(c.email).toBe('buyer@contoso.com');
		expect(c.email_verified).toBe(false);
		expect(c.display_name).toBe('Buyer One');
	});

	it('falls back to preferred_username only when it is an address', () => {
		const withUpn = ssoClaimsFromPayload({ ...base, email: undefined, preferred_username: 'upn@contoso.com' }, { nonce: 'n1', clientId: CLIENT });
		expect(withUpn.email).toBe('upn@contoso.com');
		const withoutAt = ssoClaimsFromPayload({ ...base, email: undefined, preferred_username: 'buyer' }, { nonce: 'n1', clientId: CLIENT });
		expect(withoutAt.email).toBeNull();
	});

	it('rejects a wrong nonce, audience, issuer, or a token without tenant and object id', () => {
		expectCode(() => ssoClaimsFromPayload(base, { nonce: 'other', clientId: CLIENT }), 'sso_invalid_token');
		expectCode(() => ssoClaimsFromPayload({ ...base, aud: 'x' }, { nonce: 'n1', clientId: CLIENT }), 'sso_invalid_token');
		expectCode(() => ssoClaimsFromPayload({ ...base, iss: 'https://login.microsoftonline.com/other/v2.0' }, { nonce: 'n1', clientId: CLIENT }), 'sso_invalid_token');
		expectCode(() => ssoClaimsFromPayload({ ...base, oid: undefined }, { nonce: 'n1', clientId: CLIENT }), 'sso_invalid_token');
	});
});

describe('identityMatchesSubscription', () => {
	it('matches the beneficiary or purchaser tenant and nothing else', () => {
		const row = { beneficiary_tenant_id: 'b', purchaser_tenant_id: 'p' };
		expect(identityMatchesSubscription({ tenant_id: 'b' }, row)).toBe(true);
		expect(identityMatchesSubscription({ tenant_id: 'p' }, row)).toBe(true);
		expect(identityMatchesSubscription({ tenant_id: 'x' }, row)).toBe(false);
		expect(identityMatchesSubscription({ tenant_id: null }, { beneficiary_tenant_id: null, purchaser_tenant_id: null })).toBe(false);
	});
});

describe('plans and entitlement', () => {
	it('maps the configured Partner Center plan ids and rejects unknown ones', () => {
		expect(planForMicrosoftPlan('pro')).toBe('pro');
		expect(planForMicrosoftPlan('enterprise')).toBe('enterprise');
		expect(planForMicrosoftPlan('platinum')).toBeNull();
		expect(planForMicrosoftPlan('__proto__')).toBeNull();
		expect(planForMicrosoftPlan(undefined)).toBeNull();
	});

	it('picks the highest plan and ignores unknown entries', () => {
		expect(highestPlan([])).toBe('free');
		expect(highestPlan(['pro', 'team', null, 'bogus'])).toBe('team');
		expect(highestPlan(['enterprise', 'pro'])).toBe('enterprise');
	});

	it('grants a plan only while Subscribed', () => {
		expect(entitles('Subscribed')).toBe(true);
		for (const s of ['PendingFulfillmentStart', 'Suspended', 'Unsubscribed', undefined]) expect(entitles(s)).toBe(false);
	});

	it('every metered dimension counts a real usage_events kind', () => {
		expect(DIMENSIONS.length).toBeGreaterThan(0);
		for (const d of DIMENSIONS) {
			expect(d.id).toMatch(/^[a-z0-9_]+$/);
			expect(['tool_call', 'llm']).toContain(d.usage_kind);
		}
	});
});

describe('subscriptionColumns', () => {
	const sub = {
		id: 'sub-1', name: 'three.ws for Contoso', offerId: 'three-ws', planId: 'team', quantity: 5,
		saasSubscriptionStatus: 'Subscribed',
		purchaser: { emailId: 'p@contoso.com', objectId: 'po', tenantId: 'pt' },
		beneficiary: { emailId: 'b@contoso.com', objectId: 'bo', tenantId: 'bt' },
		term: { startDate: '2026-11-01T00:00:00Z', endDate: '2026-12-01T00:00:00Z' },
		autoRenew: true, isTest: true,
	};

	it('maps the Fulfillment API object onto columns', () => {
		const c = subscriptionColumns(sub);
		expect(c).toMatchObject({
			id: 'sub-1', offer_id: 'three-ws', plan_id: 'team', quantity: 5, saas_status: 'Subscribed',
			purchaser_tenant_id: 'pt', beneficiary_email: 'b@contoso.com', beneficiary_tenant_id: 'bt',
			term_end: '2026-12-01T00:00:00Z', auto_renew: true, is_test: true,
		});
	});

	it('keeps quantity null for a flat-rate plan, so activation never sends quantity 0', () => {
		expect(subscriptionColumns({ ...sub, quantity: undefined }).quantity).toBeNull();
		expect(subscriptionColumns({ ...sub, quantity: null }).quantity).toBeNull();
		expect(subscriptionColumns({ ...sub, quantity: 0 }).quantity).toBeNull();
	});

	it('treats an unrecognised status as not yet active', () => {
		expect(subscriptionColumns({ ...sub, saasSubscriptionStatus: 'Something' }).saas_status).toBe('PendingFulfillmentStart');
	});

	it('the public view entitles only a Subscribed row on a known plan', () => {
		const row = { ...subscriptionColumns(sub), user_id: 'u1' };
		expect(publicSubscription(row)).toMatchObject({ plan: 'team', entitled: true, linked: true, status: 'Subscribed' });
		expect(publicSubscription({ ...row, plan_id: 'unknown' }).entitled).toBe(false);
		expect(publicSubscription({ ...row, saas_status: 'Suspended' }).entitled).toBe(false);
	});
});

describe('metering window', () => {
	const now = new Date('2026-11-04T15:20:00Z');

	it('floors to the hour', () => {
		expect(floorHour('2026-11-04T15:59:59Z').toISOString()).toBe('2026-11-04T15:00:00.000Z');
	});

	it('meters every completed hour after metered_through', () => {
		const hours = hoursToMeter({ meteredThrough: new Date('2026-11-04T11:00:00Z'), activatedAt: null, now });
		expect(hours.map((h) => h.toISOString())).toEqual([
			'2026-11-04T12:00:00.000Z', '2026-11-04T13:00:00.000Z', '2026-11-04T14:00:00.000Z',
		]);
	});

	it('starts at the activation hour when nothing was metered yet', () => {
		const hours = hoursToMeter({ meteredThrough: null, activatedAt: new Date('2026-11-04T13:45:00Z'), now });
		expect(hours.map((h) => h.toISOString())).toEqual(['2026-11-04T13:00:00.000Z', '2026-11-04T14:00:00.000Z']);
	});

	it('never includes the current, unfinished hour', () => {
		const hours = hoursToMeter({ meteredThrough: new Date('2026-11-04T14:00:00Z'), activatedAt: null, now });
		expect(hours).toEqual([]);
	});

	it('never reaches past the acceptance window', () => {
		const hours = hoursToMeter({ meteredThrough: new Date('2026-10-01T00:00:00Z'), activatedAt: null, now });
		expect(hours.length).toBeLessThanOrEqual(METERING_LOOKBACK_HOURS);
		expect(now.getTime() - hours[0].getTime()).toBeLessThan(24 * H);
	});

	it('settles Microsoft per-event statuses', () => {
		expect(settleUsageStatus('Accepted')).toBe('accepted');
		expect(settleUsageStatus('Duplicate')).toBe('accepted');
		expect(settleUsageStatus('Expired')).toBe('expired');
		for (const s of ['ResourceNotFound', 'ResourceNotAuthorized', 'InvalidDimension', 'InvalidQuantity', 'BadArgument', undefined]) {
			expect(settleUsageStatus(s)).toBe('rejected');
		}
	});

	it('keeps transient verdicts pending so the next tick retries them', () => {
		expect(settleUsageStatus('Error')).toBe('pending');
		expect(settleUsageStatus('ResourceNotActive')).toBe('pending');
	});

	it('chunks into Metering API sized batches', () => {
		const list = Array.from({ length: 60 }, (_, i) => i);
		const parts = chunk(list, METERING_BATCH_MAX);
		expect(parts.map((p) => p.length)).toEqual([25, 25, 10]);
		expect(parts.flat()).toEqual(list);
	});
});
