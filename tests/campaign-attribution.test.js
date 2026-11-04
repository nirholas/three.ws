import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	parseCampaignTag,
	normalizeCampaign,
	validateTouch,
	captureFirstTouch,
	trackingDisabled,
	STORAGE_KEY,
	FIRST_TOUCH_TTL_MS,
} from '../public/campaign-attribution.js';

const csvIds = readFileSync(new URL('../marketing/growth/campaigns.csv', import.meta.url), 'utf8')
	.split('\n')
	.slice(1)
	.map((l) => l.split(',')[0].replace(/"/g, ''))
	.filter(Boolean);

describe('campaign ids', () => {
	it('reads every id in campaigns.csv', () => {
		expect(csvIds.length).toBeGreaterThan(10);
		for (const id of csvIds) {
			expect(normalizeCampaign(id), id).toBe(id.toLowerCase());
			expect(parseCampaignTag(`?utm_campaign=${id.toLowerCase()}&utm_source=x`)?.campaign).toBe(id.toLowerCase());
		}
	});
	it('accepts the short c= form and prefers utm_campaign', () => {
		expect(parseCampaignTag('?c=MKT-2026-11-GCP-AGENT')?.campaign).toBe('mkt-2026-11-gcp-agent');
		expect(parseCampaignTag('?utm_campaign=mkt-2026-10-three-x402x&c=MKT-2026-11-GCP-AGENT')?.campaign).toBe('mkt-2026-10-three-x402x');
	});
	it('rejects unknown shapes and oversize values', () => {
		for (const bad of ['spring-sale', 'mkt-26-11-x', 'mkt-2026-11-', `mkt-2026-11-${'a'.repeat(80)}`, '<script>', 'mkt-2026-11-a b']) {
			expect(parseCampaignTag(`?utm_campaign=${encodeURIComponent(bad)}`), bad).toBeNull();
		}
		expect(parseCampaignTag('')).toBeNull();
	});
	it('drops a malformed source rather than storing it', () => {
		expect(parseCampaignTag('?c=MKT-2026-11-GCP-AGENT&utm_source=BAD%20SOURCE')).toEqual({
			campaign: 'mkt-2026-11-gcp-agent',
			source: null,
			medium: null,
		});
	});
});

describe('validateTouch', () => {
	const ok = { anon_id: '0b0f6f8e-6b5d-4f7e-9d49-2d6b2e0c1a11', campaign: 'MKT-2026-11-GCP-AGENT', source: 'x', medium: 'social', landing_path: '/forge' };
	it('accepts a well-formed touch and normalizes it', () => {
		const r = validateTouch(ok);
		expect(r.ok).toBe(true);
		expect(r.touch.campaign).toBe('mkt-2026-11-gcp-agent');
	});
	it('stores nothing identifying: only the fields of the ledger row survive', () => {
		const r = validateTouch({ ...ok, ip: '1.2.3.4', referrer: 'https://x.test/a/b?token=1', user_agent: 'curl' });
		expect(Object.keys(r.touch).sort()).toEqual(['anonId', 'campaign', 'landingPath', 'medium', 'source']);
		expect(JSON.stringify(r.touch)).not.toMatch(/1\.2\.3\.4|token|curl/);
	});
	it('strips a query string from the landing path and rejects non-paths', () => {
		expect(validateTouch({ ...ok, landing_path: '/forge?token=secret#x' }).touch.landingPath).toBe('/forge');
		expect(validateTouch({ ...ok, landing_path: 'https://evil.test/' }).ok).toBe(false);
	});
	it('rejects a bad anon id, unknown campaign and oversize landing path', () => {
		expect(validateTouch({ ...ok, anon_id: 'nope' }).ok).toBe(false);
		expect(validateTouch({ ...ok, campaign: 'free-money' }).ok).toBe(false);
		expect(validateTouch({ ...ok, landing_path: '/' + 'a'.repeat(300) }).ok).toBe(false);
		expect(validateTouch(null).ok).toBe(false);
	});
});

function memoryStorage(initial = {}) {
	const m = new Map(Object.entries(initial));
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

describe('captureFirstTouch', () => {
	let fetchImpl;
	beforeEach(() => {
		fetchImpl = vi.fn(async () => ({ ok: true }));
	});
	const loc = (search, pathname = '/forge') => ({ search, pathname });

	it('records one touch and remembers it locally', async () => {
		const storage = memoryStorage();
		const t = await captureFirstTouch({ location: loc('?utm_campaign=MKT-2026-11-GCP-AGENT&utm_source=test'), storage, nav: {}, fetchImpl, now: 1000, uuid: () => 'a' });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
		expect(sent).toEqual({ anon_id: 'a', campaign: 'mkt-2026-11-gcp-agent', source: 'test', medium: null, landing_path: '/forge' });
		expect(t.ts).toBe(1000);
		expect(JSON.parse(storage.getItem(STORAGE_KEY)).campaign).toBe('mkt-2026-11-gcp-agent');
	});
	it('never replaces a live first touch with a later campaign', async () => {
		const storage = memoryStorage();
		await captureFirstTouch({ location: loc('?c=MKT-2026-11-GCP-AGENT'), storage, nav: {}, fetchImpl, now: 1000, uuid: () => 'a' });
		const second = await captureFirstTouch({ location: loc('?c=MKT-2026-11-QUICKNODE'), storage, nav: {}, fetchImpl, now: 2000, uuid: () => 'b' });
		expect(second).toBeNull();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(JSON.parse(storage.getItem(STORAGE_KEY)).campaign).toBe('mkt-2026-11-gcp-agent');
	});
	it('records a new first touch once the 30 day window has passed', async () => {
		const storage = memoryStorage();
		await captureFirstTouch({ location: loc('?c=MKT-2026-11-GCP-AGENT'), storage, nav: {}, fetchImpl, now: 1000, uuid: () => 'a' });
		const later = await captureFirstTouch({ location: loc('?c=MKT-2026-11-QUICKNODE'), storage, nav: {}, fetchImpl, now: 1000 + FIRST_TOUCH_TTL_MS + 1, uuid: () => 'b' });
		expect(later.campaign).toBe('mkt-2026-11-quicknode');
	});
	it('does nothing without a valid tag, under Do Not Track, or when the server refuses', async () => {
		const storage = memoryStorage();
		expect(await captureFirstTouch({ location: loc('?utm_source=x'), storage, nav: {}, fetchImpl })).toBeNull();
		expect(await captureFirstTouch({ location: loc('?c=MKT-2026-11-GCP-AGENT'), storage, nav: { doNotTrack: '1' }, fetchImpl })).toBeNull();
		expect(trackingDisabled({ globalPrivacyControl: true })).toBe(true);
		const refused = vi.fn(async () => ({ ok: false }));
		expect(await captureFirstTouch({ location: loc('?c=MKT-2026-11-GCP-AGENT'), storage, nav: {}, fetchImpl: refused })).toBeNull();
		expect(storage.getItem(STORAGE_KEY)).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});
	it('never throws when storage or fetch fail', async () => {
		const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
		await expect(captureFirstTouch({ location: loc('?c=MKT-2026-11-GCP-AGENT'), storage: boom, nav: {}, fetchImpl })).resolves.toBeNull();
		const down = vi.fn(async () => { throw new Error('offline'); });
		await expect(captureFirstTouch({ location: loc('?c=MKT-2026-11-GCP-AGENT'), storage: memoryStorage(), nav: {}, fetchImpl: down })).resolves.toBeNull();
	});
});
