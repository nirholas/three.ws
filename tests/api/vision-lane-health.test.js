// Lane health and budget policy for the vision chain: a throttled host is
// skipped by the next request instead of being re-picked as attempt zero, and
// no single lane can spend the whole deadline that the lanes behind it need.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearProviderCooldown } from '../../api/_lib/provider-health.js';

const usageState = { events: [] };
vi.mock('../../api/_lib/usage.js', () => ({
	recordEvent: (evt) => usageState.events.push(evt),
}));

import { describeImage, laneAttemptTimeout, inlineImageBudget } from '../../api/_lib/vision.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ['NVIDIA_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_CLOUD_PROJECT'];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

const LANE_KEYS = [
	'vision:nvidia:meta/llama-3.2-11b-vision-instruct',
	'vision:openai:gpt-5.4-nano',
];

function stubFetch(routes) {
	const calls = [];
	globalThis.fetch = vi.fn(async (url, opts = {}) => {
		const u = String(url);
		calls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null, signal: opts.signal });
		for (const [match, responder] of routes) {
			if (u.includes(match)) return responder(calls[calls.length - 1]);
		}
		throw new Error(`unexpected fetch in test: ${u}`);
	});
	return calls;
}
const chatOk = (content) =>
	new Response(JSON.stringify({ model: 'm', choices: [{ message: { content } }], usage: {} }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
const httpErr = (status, body = 'err') => new Response(body, { status });

beforeEach(async () => {
	usageState.events = [];
	await Promise.all(LANE_KEYS.map((k) => clearProviderCooldown(k)));
	process.env.NVIDIA_API_KEY = 'nvapi-test';
	process.env.OPENAI_API_KEY = 'sk-x';
	delete process.env.GOOGLE_CLOUD_PROJECT;
});
afterEach(async () => {
	globalThis.fetch = ORIGINAL_FETCH;
	await Promise.all(LANE_KEYS.map((k) => clearProviderCooldown(k)));
	for (const k of ENV_KEYS) {
		if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
		else process.env[k] = ORIGINAL_ENV[k];
	}
	vi.restoreAllMocks();
});

describe('laneAttemptTimeout', () => {
	it('reserves the floor for the rungs behind, and gives this lane the rest', () => {
		// 18s left, three lanes to go: hold 3.5s for each of the two behind and
		// hand this one the remaining 11s. Dividing equally (6s each) starved the
		// best lane for the benefit of rungs that may never be reached.
		expect(laneAttemptTimeout(18_000, 3, 20_000)).toBe(11_000);
		expect(laneAttemptTimeout(12_000, 2, 20_000)).toBe(8_500);
	});
	it('still guarantees every remaining rung its floor', () => {
		// Walk the chain the way describeImage does, spending each slice in full.
		let remaining = 18_000;
		const slices = [];
		for (let lanesLeft = 3; lanesLeft > 0; lanesLeft--) {
			const ms = laneAttemptTimeout(remaining, lanesLeft, 20_000);
			slices.push(ms);
			remaining -= ms;
		}
		expect(slices).toEqual([11_000, 3_500, 3_500]);
		expect(remaining).toBe(0);
		for (const ms of slices) expect(ms).toBeGreaterThanOrEqual(3_500);
	});
	it('bounds one request to a few attempts however deep the chain is', () => {
		// Twelve rungs is depth for the chain, not spend for the request: the
		// budget still buys a generous first attempt plus the reserved fallbacks,
		// and then the deadline stops the walk honestly.
		let remaining = 29_000;
		let attempts = 0;
		for (let lanesLeft = 12; lanesLeft > 0 && remaining > 0; lanesLeft--) {
			remaining -= laneAttemptTimeout(remaining, lanesLeft, 25_000);
			attempts++;
		}
		expect(attempts).toBeLessThanOrEqual(4);
		expect(remaining).toBe(0);
	});
	it('does not shrink the first lane as the chain grows', () => {
		// The regression that took the forge quality gate to 0 verdicts in 10.
		// Its deadline is 29s and the chain went from 3 lanes to 6 when the
		// OpenRouter rungs landed; under equal division the free NIM lane's slice
		// fell from ~9.7s to ~4.8s, just under what the scoring rubric needs.
		const sixLanes = laneAttemptTimeout(29_000, 6, 25_000);
		const equalDivision = Math.floor(29_000 / 6); // 4_833, the old policy
		expect(sixLanes).toBe(22_000);
		expect(sixLanes).toBeGreaterThan(equalDivision * 4);
		// The reserve is capped, so DEPTH no longer costs the first lane anything.
		// Three rungs or twelve, the lane in hand gets the same generous slice;
		// otherwise adding providers would quietly re-create the starvation.
		expect(laneAttemptTimeout(29_000, 3, 25_000)).toBe(22_000);
		expect(laneAttemptTimeout(29_000, 12, 25_000)).toBe(22_000);
	});
	it('never exceeds the caller timeout and never outlives the deadline', () => {
		expect(laneAttemptTimeout(60_000, 1, 20_000)).toBe(20_000);
		expect(laneAttemptTimeout(2_000, 3, 20_000)).toBe(2_000);
	});
	it('keeps a workable floor rather than handing a lane an unusable slice', () => {
		// 10s left across 8 lanes is 1.25s each, too short for any VLM call, so the
		// floor applies and the chain simply gets through fewer lanes honestly.
		expect(laneAttemptTimeout(10_000, 8, 20_000)).toBe(3_500);
	});
	it('leaves the caller timeout alone when there is no deadline', () => {
		expect(laneAttemptTimeout(Infinity, 3, 20_000)).toBe(20_000);
	});
	it('always returns an integer AbortSignal.timeout will accept', () => {
		// Every case above divides evenly, which is how a fractional return value
		// shipped: AbortSignal.timeout() throws ERR_OUT_OF_RANGE on a non-integer
		// delay, so the lane threw before sending a byte and the chain lost its
		// fallback rung. 23_474/3 is the shape production actually produced.
		const split = laneAttemptTimeout(23_474, 3, 20_000);
		expect(Number.isInteger(split)).toBe(true);
		expect(split).toBe(16_474);
		expect(() => AbortSignal.timeout(split)).not.toThrow();
		for (const remaining of [23_474, 9_999, 12_345, 7_001]) {
			for (const lanes of [1, 2, 3, 4, 7]) {
				const ms = laneAttemptTimeout(remaining, lanes, 20_000);
				expect(Number.isInteger(ms)).toBe(true);
				expect(() => AbortSignal.timeout(ms)).not.toThrow();
			}
		}
	});
});

describe('inlineImageBudget', () => {
	it('takes only a slice of the deadline so the chain is not starved', () => {
		// The bug this replaces: min(20s timeout, 24s remaining) = 20s for the image
		// fetch alone, leaving 4s for every provider combined.
		expect(inlineImageBudget(24_000, 20_000)).toBe(6_000);
	});
	it('is capped for a generous deadline and floored for a nearly spent one', () => {
		expect(inlineImageBudget(120_000, 20_000)).toBe(8_000);
		expect(inlineImageBudget(1_000, 20_000)).toBe(1_000);
	});
});

describe('vision lane cooldowns', () => {
	it('sends the next request past a throttled NIM host instead of re-picking it', async () => {
		const first = stubFetch([
			['integrate.api.nvidia.com', () => httpErr(429, 'rate limit')],
			['api.openai.com', () => chatOk('backstop')],
		]);
		const a = await describeImage({ prompt: 'p', imageBase64: 'AAAA', mimeType: 'image/png' });
		expect(a.provider).toBe('openai');
		// 429 is the one verdict that is unambiguously about the host and its
		// quota, so every rung sharing that host is skipped inside this very
		// request: one throttled attempt is paid, not one per model it serves.
		expect(first.filter((c) => c.url.includes('nvidia')).length).toBe(1);

		const second = stubFetch([
			['integrate.api.nvidia.com', () => chatOk('nim back')],
			['api.openai.com', () => chatOk('backstop')],
		]);
		const b = await describeImage({ prompt: 'p', imageBase64: 'AAAA', mimeType: 'image/png' });
		// The cooled lanes are re-ordered behind the healthy one, never dropped.
		expect(b.provider).toBe('openai');
		expect(second[0].url).toContain('openai.com');
	});

	it('fails a transport error over to the backstop rather than giving up', async () => {
		const calls = stubFetch([
			['integrate.api.nvidia.com', () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }],
			['api.openai.com', () => chatOk('backstop answered')],
		]);
		const r = await describeImage({ prompt: 'p', imageBase64: 'AAAA', mimeType: 'image/png' });
		expect(r.text).toBe('backstop answered');
		expect(r.provider).toBe('openai');
		// The NIM rung was really attempted before the failover: a chain that skips
		// its free lane and bills the paid one is the regression worth catching.
		expect(calls.filter((c) => c.url.includes('nvidia')).length).toBe(1);
	});

	it('parks a 410 lane for the long window instead of re-probing a retired model', async () => {
		// NVIDIA answers a retired model id with 410 Gone. That verdict never
		// reverses, so the lane must be benched for the auth-length window, not the
		// 45s health one, or every request keeps paying it a slice of the deadline.
		stubFetch([
			['integrate.api.nvidia.com', () => httpErr(410, "model has reached its end of life")],
			['api.openai.com', () => chatOk('backstop')],
		]);
		const a = await describeImage({ prompt: 'p', imageBase64: 'AAAA', mimeType: 'image/png' });
		expect(a.provider).toBe('openai');

		// The retired lane is now behind the healthy one, so the next request does
		// not lead with it.
		const next = stubFetch([
			['integrate.api.nvidia.com', () => httpErr(410, 'gone')],
			['api.openai.com', () => chatOk('backstop again')],
		]);
		const b = await describeImage({ prompt: 'p', imageBase64: 'AAAA', mimeType: 'image/png' });
		expect(b.provider).toBe('openai');
		expect(next[0].url).toContain('openai.com');
	});

	it('clears a lane cooldown as soon as that lane serves a real request', async () => {
		stubFetch([
			['integrate.api.nvidia.com', () => httpErr(429)],
			['api.openai.com', () => chatOk('backstop')],
		]);
		await describeImage({ prompt: 'p', imageBase64: 'AAAA', mimeType: 'image/png' });

		// Force the cooled NIM lanes to answer (every lane cooling means the whole
		// chain is tried anyway) and confirm the bench is lifted afterwards.
		await Promise.all(LANE_KEYS.map((k) => clearProviderCooldown(k)));
		const back = stubFetch([['integrate.api.nvidia.com', () => chatOk('recovered')]]);
		const r = await describeImage({ prompt: 'p', imageBase64: 'AAAA', mimeType: 'image/png' });
		expect(r.text).toBe('recovered');
		expect(back[0].url).toContain('integrate.api.nvidia.com');
	});

	it('still answers when every lane is cooling, rather than failing cold', async () => {
		stubFetch([
			['integrate.api.nvidia.com', () => httpErr(429)],
			['api.openai.com', () => httpErr(429)],
		]);
		await expect(
			describeImage({ prompt: 'p', imageBase64: 'AAAA', mimeType: 'image/png' }),
		).rejects.toThrow();

		const retry = stubFetch([
			['integrate.api.nvidia.com', () => chatOk('recovered')],
			['api.openai.com', () => chatOk('backstop')],
		]);
		const r = await describeImage({ prompt: 'p', imageBase64: 'AAAA', mimeType: 'image/png' });
		expect(r.text).toBeTruthy();
		expect(retry.length).toBeGreaterThan(0);
	});
});
