// @vitest-environment jsdom
// The Microsoft Marketplace free trial banner (src/microsoft-trial-banner.js):
// which subscription it describes, the copy for each trial state, and the real
// mount path against a stubbed subscriptions endpoint: it renders under the
// header, is a labelled region, links to Microsoft, and a dismiss hides it for
// the rest of the session without refetching.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickTrial, trialCopy, mountTrialBanner } from '../src/microsoft-trial-banner.js';
import { MANAGE_IN_MICROSOFT_URL as MANAGE } from '../api/_lib/microsoft-trial.js';

function sub(over = {}) {
	return {
		id: 'sub-1', plan: 'pro', plan_id: 'pro-monthly', status: 'Subscribed',
		is_free_trial: true, trial_ends_at: '2026-11-30T00:00:00.000Z', trial_days_left: 14,
		plan_price_label: '$49.00 per month', auto_renew: true, manage_url: MANAGE, ...over,
	};
}

describe('pickTrial', () => {
	it('picks the active trial that ends soonest', () => {
		const a = sub({ id: 'a', trial_ends_at: '2026-12-10T00:00:00Z' });
		const b = sub({ id: 'b', trial_ends_at: '2026-11-20T00:00:00Z' });
		expect(pickTrial([a, b]).id).toBe('b');
	});
	it('ignores paid, cancelled and pending subscriptions', () => {
		expect(pickTrial([
			sub({ is_free_trial: false }),
			sub({ status: 'Unsubscribed' }),
			sub({ status: 'PendingFulfillmentStart', trial_ends_at: null }),
		])).toBeNull();
		expect(pickTrial(undefined)).toBeNull();
	});
});

describe('trialCopy', () => {
	it('names days left, the plan and the Partner Center price', () => {
		const c = trialCopy(sub());
		expect(c.headline).toBe('Your Microsoft free trial has 14 days left.');
		expect(c.detail).toBe('After November 30, 2026 it converts to the Pro plan at $49.00 per month, billed by Microsoft.');
	});
	it('falls back to the plan name with no invented price', () => {
		const c = trialCopy(sub({ plan_price_label: null }));
		expect(c.detail).toBe('After November 30, 2026 it converts to the paid Pro plan, billed by Microsoft.');
		expect(c.detail).not.toMatch(/\$/);
	});
	it('says tomorrow and today near the end', () => {
		expect(trialCopy(sub({ trial_days_left: 1 })).headline).toMatch(/ends tomorrow\.$/);
		expect(trialCopy(sub({ trial_days_left: 0 })).headline).toMatch(/ends today\.$/);
	});
	it('does not promise a conversion when auto-renew is off', () => {
		const c = trialCopy(sub({ auto_renew: false }));
		expect(c.detail).toMatch(/will not convert/);
		expect(c.detail).not.toMatch(/\$49/);
	});
	it('uses no dash characters', () => {
		for (const s of [sub(), sub({ auto_renew: false }), sub({ plan_price_label: null })]) {
			const c = trialCopy(s);
			expect(`${c.headline} ${c.detail}`).not.toMatch(/[\u2013\u2014]/);
		}
	});
});

describe('mountTrialBanner', () => {
	let fetchMock;
	beforeEach(() => {
		sessionStorage.clear();
		document.body.innerHTML = '<div id="nav-container"><header class="nav"></header></div><main id="main"></main>';
		window.matchMedia = window.matchMedia || ((q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
		fetchMock = vi.fn(async () => new Response(JSON.stringify({ plan: 'pro', subscriptions: [sub()] }), { status: 200, headers: { 'content-type': 'application/json' } }));
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => { vi.unstubAllGlobals(); });

	it('renders an accessible region under the header with the Microsoft link', async () => {
		await mountTrialBanner();
		const el = document.querySelector('.ms-trial-banner');
		expect(el).not.toBeNull();
		expect(el.previousElementSibling.id).toBe('nav-container');
		expect(el.getAttribute('role')).toBe('region');
		expect(el.getAttribute('aria-label')).toBe('Free trial');
		expect(el.textContent).toContain('14 days left');
		expect(el.textContent).toContain('$49.00 per month');
		const link = el.querySelector('.ms-trial-banner__link');
		expect(link.href).toBe(MANAGE);
		expect(link.rel).toContain('noopener');
		expect(el.querySelector('.ms-trial-banner__details').getAttribute('href')).toBe('/microsoft/activate?subscription=sub-1');
		expect(String(fetchMock.mock.calls[0][0])).toContain('/api/microsoft-marketplace/subscriptions');
	});

	it('stays hidden for the session after dismiss and reuses the cached list', async () => {
		await mountTrialBanner();
		document.querySelector('.ms-trial-banner__close').click();
		expect(sessionStorage.getItem('ms-trial-banner:dismissed')).toBe('1');
		document.querySelector('.ms-trial-banner')?.remove();
		await mountTrialBanner();
		expect(document.querySelector('.ms-trial-banner')).toBeNull();

		sessionStorage.removeItem('ms-trial-banner:dismissed');
		await mountTrialBanner();
		expect(document.querySelector('.ms-trial-banner')).not.toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('shows nothing without a trial or when the request fails', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ subscriptions: [sub({ is_free_trial: false })] }), { status: 200 }));
		await mountTrialBanner();
		expect(document.querySelector('.ms-trial-banner')).toBeNull();

		sessionStorage.clear();
		fetchMock.mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 }));
		await mountTrialBanner();
		expect(document.querySelector('.ms-trial-banner')).toBeNull();
	});
});
