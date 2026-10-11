import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeCode, claimLinkCode, pollLinkCode, linkCodeLogin } from '../src/link-code.js';

const origin = 'https://example.test';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const claim = { id: 'c1', claim_secret: 's3cret', poll_every_ms: 1000, expires_at: new Date(Date.now() + 600_000).toISOString(), scopes: ['read', 'generate'] };
const noSleep = () => Promise.resolve();

afterEach(() => vi.unstubAllGlobals());

describe('normalizeCode', () => {
	it('formats typed codes', () => {
		expect(normalizeCode('bcdf ghjk')).toBe('BCDF-GHJK');
		expect(normalizeCode('BCDFGHJK')).toBe('BCDF-GHJK');
	});
	it('rejects vowels, wrong length and junk', () => {
		expect(normalizeCode('ABCD-EFGH')).toBeNull();
		expect(normalizeCode('BCDF')).toBeNull();
		expect(normalizeCode('')).toBeNull();
	});
});

describe('claimLinkCode', () => {
	it('rejects an invalid code without any request', async () => {
		const f = vi.fn();
		vi.stubGlobal('fetch', f);
		await expect(claimLinkCode({ origin, code: 'nope' })).rejects.toMatchObject({ code: 'invalid_code' });
		expect(f).not.toHaveBeenCalled();
	});
	it('posts the normalized code as a cli device', async () => {
		const f = vi.fn(async () => json(200, claim));
		vi.stubGlobal('fetch', f);
		await claimLinkCode({ origin, code: 'bcdfghjk' });
		const [url, init] = f.mock.calls[0];
		expect(url).toBe(`${origin}/api/auth/link-codes/claim`);
		const body = JSON.parse(init.body);
		expect(body.code).toBe('BCDF-GHJK');
		expect(body.device_kind).toBe('cli');
	});
});

describe('pollLinkCode', () => {
	it('waits while claimed, then returns the confirmed result', async () => {
		const answers = [json(200, { status: 'claimed' }), json(200, { status: 'confirmed', credential: { kind: 'api_key', secret: 'k' } })];
		vi.stubGlobal('fetch', vi.fn(async () => answers.shift()));
		const out = await pollLinkCode({ origin, claim, sleep: noSleep });
		expect(out.status).toBe('confirmed');
	});
	it('treats 404 as a rejected request', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json(404, { error: 'unknown_claim' })));
		await expect(pollLinkCode({ origin, claim, sleep: noSleep })).rejects.toMatchObject({ code: 'rejected' });
	});
	it.each(['rejected', 'expired', 'consumed'])('stops on %s', async (status) => {
		vi.stubGlobal('fetch', vi.fn(async () => json(200, { status })));
		await expect(pollLinkCode({ origin, claim, sleep: noSleep })).rejects.toMatchObject({ code: status });
	});
});

describe('linkCodeLogin', () => {
	it('returns an apikey auth record', async () => {
		const answers = [json(200, claim), json(200, { status: 'confirmed', device_id: 'd1', credential: { kind: 'api_key', id: 'k1', secret: 'sk_live_abcdef123456' } })];
		vi.stubGlobal('fetch', vi.fn(async () => answers.shift()));
		const onClaimed = vi.fn();
		const out = await linkCodeLogin({ origin, code: 'BCDF-GHJK', onClaimed });
		expect(onClaimed).toHaveBeenCalled();
		expect(out.auth).toMatchObject({ type: 'apikey', key: 'sk_live_abcdef123456', key_id: 'k1', scope: 'read generate' });
		expect(out.device_id).toBe('d1');
	});
});
