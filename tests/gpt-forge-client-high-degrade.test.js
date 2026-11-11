// A high-detail submit with no high lane must degrade to standard, not dead-end.
//
// startForge already degrades a non-strict high submit to the standard router when
// the operator-funded gate refuses (402) or the submit times out. On 2026-11-11 the
// Power Platform connector's live contract test hit a third case in production:
// /api/gpt-forge answered 502 "no reconstruct lane configured" because no lane could
// serve high, and the free /api/3d/studio endpoint returned that 502 to the caller
// instead of a standard model. A paid surface (strictTier) must still refuse, since
// its buyer paid for high.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { startForge } from '../api/_mcp-studio/gpt-forge-client.js';

const BASE = 'https://three.ws';
const NO_LANE = { error: 'generation_failed', message: 'no reconstruct lane configured' };

function respond(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubForge(byTier) {
	const calls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url, init) => {
			const payload = JSON.parse(init.body);
			calls.push(payload.tier);
			const [status, body] = byTier[payload.tier];
			return respond(status, body);
		}),
	);
	return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('startForge high tier with no high lane', () => {
	it('degrades a non-strict high submit to standard when the high lane answers 502', async () => {
		const calls = stubForge({ high: [502, NO_LANE], standard: [202, { status: 'queued', job_id: 'job-std' }] });
		const job = await startForge(BASE, { prompt: 'a small ceramic robot figurine', path: 'image', tier: 'high', internal: true });
		expect(job.job_id).toBe('job-std');
		expect(calls).toEqual(['high', 'standard']);
	});

	it('refuses with tier_unavailable on a strict (paid) high submit instead of serving standard', async () => {
		const calls = stubForge({ high: [502, NO_LANE], standard: [202, { status: 'queued', job_id: 'job-std' }] });
		await expect(startForge(BASE, { prompt: 'a lamp', tier: 'high', internal: true, strictTier: true })).rejects.toMatchObject({ code: 'tier_unavailable' });
		expect(calls).toEqual(['high']);
	});

	it('still reports a provider error when standard has no lane either', async () => {
		stubForge({ high: [502, NO_LANE], standard: [502, NO_LANE] });
		await expect(startForge(BASE, { prompt: 'a lamp', tier: 'high', internal: true })).rejects.toMatchObject({ code: 'provider_error' });
	});

	it('does not retry a standard submit that answers 502', async () => {
		const calls = stubForge({ standard: [502, NO_LANE] });
		await expect(startForge(BASE, { prompt: 'a lamp', tier: 'standard' })).rejects.toMatchObject({ code: 'provider_error' });
		expect(calls).toEqual(['standard']);
	});
});

describe('startForge degrades at most once', () => {
	it('a high submit refused with 402 whose standard retry answers 502 is not submitted a third time', async () => {
		const calls = stubForge({ high: [402, { error: 'payment_required' }], standard: [502, NO_LANE] });
		await expect(startForge(BASE, { prompt: 'a lamp', tier: 'high', internal: true })).rejects.toMatchObject({ code: 'provider_error' });
		expect(calls).toEqual(['high', 'standard']);
	});
});
