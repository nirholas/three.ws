// Pay-to-keep must gate every user-facing "Download GLB" for a creation, not only
// the Forge result button. Before this test the creation page (/m/:id) rendered a
// plain <a href=glb_url download>, so with FORGE_PAY_TO_KEEP on a user could skip
// the keep payment by opening the model page and downloading from there.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const payForConsumption = vi.fn();
vi.mock('../src/forge-pay.js', () => ({ payForConsumption: (...a) => payForConsumption(...a) }));
let tierPass = async () => null;
vi.mock('../src/three-access.js', () => ({
	attachTierPass: (h) => h,
	getTierPass: (...a) => tierPass(...a),
}));

const { releaseDownload } = await import('../src/forge-keep.js');

const CREATION = '11111111-1111-4111-8111-111111111111';
const URL_GLB = 'https://storage.googleapis.com/three-ws-forge/a.glb';

function reply(status, body) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('releaseDownload (pay-to-keep gate for a creation download)', () => {
	let calls;
	beforeEach(() => {
		calls = [];
		payForConsumption.mockReset();
		tierPass = async () => null;
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	function stubFetch(...replies) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url, init) => {
				calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
				return replies.shift();
			}),
		);
	}

	it('saves the file straight away when pay-to-keep is off', async () => {
		stubFetch(reply(200, { enabled: false, kept: true, reason: 'pay_to_keep_off' }));
		const save = vi.fn();
		const r = await releaseDownload({ creationId: CREATION, url: URL_GLB, filename: 'a.glb', save });
		expect(r).toEqual({ ok: true });
		expect(save).toHaveBeenCalledWith(URL_GLB, 'a.glb');
		expect(calls[0].url).toBe('/api/forge-keep');
		expect(calls[0].body).toEqual({ creation_id: CREATION });
	});

	it('withholds the file when the keep payment is cancelled', async () => {
		stubFetch(reply(402, { error: 'three_hold_required', pay_per_use: { action: 'forge.keep.standard', usd: 0.15 } }));
		payForConsumption.mockResolvedValue({ ok: false });
		const save = vi.fn();
		const r = await releaseDownload({ creationId: CREATION, url: URL_GLB, filename: 'a.glb', save });
		expect(r.ok).toBe(false);
		expect(r.message).toMatch(/No \$THREE was spent/);
		expect(save).not.toHaveBeenCalled();
		expect(payForConsumption).toHaveBeenCalledWith(expect.objectContaining({ usd: 0.15 }));
	});

	it('saves the file after a settled keep payment is redeemed', async () => {
		stubFetch(
			reply(402, { error: 'three_hold_required', pay_per_use: { action: 'forge.keep.draft', usd: 0.05 } }),
			reply(200, { enabled: true, kept: true, reason: 'paid' }),
		);
		payForConsumption.mockResolvedValue({ ok: true, paymentId: 'pay_1', refId: 'forge-keep-1' });
		const save = vi.fn();
		const r = await releaseDownload({ creationId: CREATION, url: URL_GLB, filename: 'a.glb', save });
		expect(r).toEqual({ ok: true });
		expect(calls[1].body).toEqual({ creation_id: CREATION, payment_id: 'pay_1', ref_id: 'forge-keep-1' });
		expect(save).toHaveBeenCalledOnce();
	});

	it('does not wait forever on a tier-pass mint that never answers', async () => {
		vi.useFakeTimers();
		tierPass = () => new Promise(() => {});
		stubFetch(reply(200, { enabled: false, kept: true, reason: 'pay_to_keep_off' }));
		const save = vi.fn();
		const pending = releaseDownload({ creationId: CREATION, url: URL_GLB, filename: 'a.glb', save });
		await vi.advanceTimersByTimeAsync(10_000);
		await expect(pending).resolves.toEqual({ ok: true });
		expect(save).toHaveBeenCalledOnce();
	});

	it('refuses a creation with no file instead of saving an empty link', async () => {
		stubFetch();
		const save = vi.fn();
		const r = await releaseDownload({ creationId: CREATION, url: '', save });
		expect(r.ok).toBe(false);
		expect(save).not.toHaveBeenCalled();
		expect(calls).toHaveLength(0);
	});
});

describe('creation page download is gated', () => {
	const src = readFileSync(join(process.cwd(), 'src/model-page.js'), 'utf8');

	it('does not render a raw download link to the original file', () => {
		expect(src).not.toMatch(/href="\$\{esc\(c\.glb_url\)\}"\s+download/);
	});

	it('routes the Download GLB action through releaseDownload', () => {
		expect(src).toMatch(/id="mp-download"/);
		expect(src).toMatch(/releaseDownload\(/);
	});
});
