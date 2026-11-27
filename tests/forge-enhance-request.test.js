// src/forge-enhance-request.js: what every Enhance button (the Forge page, Forge
// Studio, the homepage chamber, Forge Spark) does with POST /api/forge-enhance.
//
// Before 2026-11-26 each page carried its own copy of this logic and none of
// them could end a request: the fetch had no timeout, so a stalled chain left
// the button on "Enhancing..." forever. A 200 that carried the user's own
// prompt back (the server discarding a refusal or off-topic rewrite) was shown
// as "already in good shape", and the 503 copy promised nothing about Generate.
// These pin the outcome for each answer the endpoint gives.

import { describe, it, expect, vi } from 'vitest';
import { requestEnhance, ENHANCE_TIMEOUT_MS } from '../src/forge-enhance-request.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('requestEnhance', () => {
	it('a stalled request is ended at the timeout and reported unavailable, prompt untouched', async () => {
		const fetchImpl = vi.fn(
			(_url, opts) =>
				new Promise((_, reject) => {
					opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
				}),
		);
		const t0 = Date.now();
		const out = await requestEnhance('a rocking chair', { fetchImpl, timeoutMs: 60 });
		expect(Date.now() - t0).toBeLessThan(1000);
		expect(out.kind).toBe('unavailable');
		expect(out.prompt).toBe('a rocking chair');
		expect(out.message).toMatch(/unavailable/i);
	});

	it('defaults to a bounded timeout', () => {
		expect(ENHANCE_TIMEOUT_MS).toBeGreaterThan(10_000);
		expect(ENHANCE_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
	});

	it('503 llm_unavailable says so in one sentence and keeps the prompt', async () => {
		const fetchImpl = async () =>
			json(503, { error: 'llm_unavailable', prompt: 'a rocking chair', enhanced: false, retry_after: 1800 });
		const out = await requestEnhance('a rocking chair', { fetchImpl });
		expect(out).toMatchObject({ kind: 'unavailable', prompt: 'a rocking chair' });
		expect(out.message.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length).toBe(1);
		expect(out.message).toMatch(/unchanged/i);
		expect(out.message).toMatch(/generate/i);
		expect(out.message).not.toMatch(/[\u2013\u2014]/);
	});

	it('a discarded rewrite (enhanced:false with a reason) keeps the prompt and does not claim it was fine', async () => {
		const fetchImpl = async () => json(200, { prompt: 'a rocking chair', enhanced: false, reason: 'refusal' });
		const out = await requestEnhance('a rocking chair', { fetchImpl });
		expect(out.kind).toBe('unchanged');
		expect(out.prompt).toBe('a rocking chair');
		expect(out.message).not.toMatch(/good shape/i);
		expect(out.message).toMatch(/unchanged/i);
	});

	it('a real rewrite comes back as rewritten with the new text', async () => {
		const next = 'A worn oak rocking chair with curved runners, soft even light';
		const fetchImpl = async () => json(200, { prompt: next, enhanced: true, provider: 'groq' });
		const out = await requestEnhance('a rocking chair', { fetchImpl });
		expect(out).toMatchObject({ kind: 'rewritten', prompt: next, provider: 'groq' });
	});

	it('the same text back with enhanced:true is reported as already in good shape', async () => {
		const fetchImpl = async () => json(200, { prompt: 'A rocking chair', enhanced: true });
		const out = await requestEnhance('a rocking chair', { fetchImpl });
		expect(out.kind).toBe('unchanged');
		expect(out.message).toMatch(/good shape/i);
	});

	it('429 states the wait', async () => {
		const fetchImpl = async () => json(429, { error: 'rate_limited', retry_after: 12 });
		const out = await requestEnhance('a rocking chair', { fetchImpl });
		expect(out).toMatchObject({ kind: 'throttled', prompt: 'a rocking chair', retryAfter: 12 });
		expect(out.message).toMatch(/12s/);
	});

	it('a dropped connection keeps the prompt and says the helper was not reached', async () => {
		const fetchImpl = async () => {
			throw new TypeError('Failed to fetch');
		};
		const out = await requestEnhance('a rocking chair', { fetchImpl });
		expect(out).toMatchObject({ kind: 'failed', prompt: 'a rocking chair' });
		expect(out.message).toMatch(/unchanged/i);
	});

	it('sends the prompt, extra body fields and headers', async () => {
		const fetchImpl = vi.fn(async () => json(200, { prompt: 'x y z', enhanced: true }));
		await requestEnhance('a rocking chair', { fetchImpl, headers: { 'x-forge-client': 'c1' }, body: { engine: 'nemotron' } });
		const [url, opts] = fetchImpl.mock.calls[0];
		expect(url).toBe('/api/forge-enhance');
		expect(JSON.parse(opts.body)).toEqual({ prompt: 'a rocking chair', engine: 'nemotron' });
		expect(opts.headers['x-forge-client']).toBe('c1');
	});
});
