import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let responder = () => [];
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		calls.push({ text: strings.join('?'), values });
		return responder(strings.join('?'), values);
	}),
}));

const { recordTouch, recordConversion, touchForRequest, campaignReport, touchCookie } = await import('../api/_lib/campaign-ledger.js');

const ANON = '0b0f6f8e-6b5d-4f7e-9d49-2d6b2e0c1a11';
const req = (cookie) => ({ headers: cookie ? { cookie } : {} });

beforeEach(() => {
	calls.length = 0;
	responder = () => [];
});

describe('campaign ledger', () => {
	it('inserts a touch with only the campaign fields (no ip, agent or referrer columns)', async () => {
		responder = () => [{ id: 't1', anon_id: ANON, campaign: 'mkt-2026-11-gcp-agent' }];
		const r = await recordTouch({ anonId: ANON, campaign: 'mkt-2026-11-gcp-agent', source: 'x', medium: null, landingPath: '/forge' });
		expect(r.created).toBe(true);
		expect(calls[0].text).toMatch(/insert into campaign_touches \(anon_id, campaign, source, medium, landing_path\)/);
		expect(calls[0].text).toMatch(/on conflict \(anon_id\) do nothing/);
		expect(calls[0].text).not.toMatch(/ip|user_agent|referrer/i);
	});
	it('returns the existing first touch when the browser already has one', async () => {
		let n = 0;
		responder = () => (n++ === 0 ? [] : [{ id: 't0', anon_id: ANON, campaign: 'mkt-2026-11-quicknode' }]);
		const r = await recordTouch({ anonId: ANON, campaign: 'mkt-2026-11-gcp-agent', source: null, medium: null, landingPath: '/' });
		expect(r).toMatchObject({ created: false, campaign: 'mkt-2026-11-quicknode' });
	});
	it('credits a conversion to the cookie touch', async () => {
		responder = (text) => (/from campaign_touches/.test(text) ? [{ id: 't1', campaign: 'c' }] : []);
		expect(await recordConversion(req(`tws_ct=${ANON}`), 'signup', 'u1')).toBe(true);
		const insert = calls.find((c) => /insert into campaign_conversions/.test(c.text));
		expect(insert.values).toEqual(['t1', 'u1', 'signup']);
	});
	it('is silent without a cookie, with a malformed cookie, or an unknown event', async () => {
		expect(await recordConversion(req(), 'signup', 'u1')).toBe(false);
		expect(await touchForRequest(req('tws_ct=not-a-uuid'))).toBeNull();
		expect(await recordConversion(req(`tws_ct=${ANON}`), 'purchase', 'u1')).toBe(false);
		expect(calls).toHaveLength(0);
	});
	it('never throws when the ledger write fails', async () => {
		responder = () => {
			throw new Error('db down');
		};
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(recordConversion(req(`tws_ct=${ANON}`), 'agent_created', 'u1')).resolves.toBe(false);
		warn.mockRestore();
	});
	it('sets a 30 day first-party cookie', () => {
		expect(touchCookie(ANON)).toBe(`tws_ct=${ANON}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
	});
	it('rolls touches and conversions up per campaign', async () => {
		responder = (text) =>
			/from campaign_conversions/.test(text)
				? [{ campaign: 'a', event: 'signup', n: 2 }]
				: [{ campaign: 'a', touches: 5, first_touch_at: 'x', last_touch_at: 'y' }, { campaign: 'b', touches: 9, first_touch_at: 'x', last_touch_at: 'y' }];
		const rows = await campaignReport({ from: '2026-11-01', to: '2026-11-05' });
		expect(rows.map((r) => r.campaign)).toEqual(['b', 'a']);
		expect(rows[1].conversions).toEqual({ signup: 2, agent_created: 0, forge_generation: 0, paid_call: 0 });
	});
});
