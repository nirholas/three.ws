// Generation POSTs that end before a job exists.
//
// On 2026-11-26 the lane success rate read 93% while text prompts were failing
// at the reference image step: those requests never created a forge_creations
// row, so no counter saw them. These tests pin that every way a submit can end
// before a job is counted once, with the right stage and cause, and that
// counting can never change or slow the response.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifySubmitExit, observeForgeSubmit } from '../../api/_lib/forge-prejob.js';
import { json, rateLimited } from '../../api/_lib/http.js';

// A response double with the surface the real writers use.
function fakeRes() {
	const headers = {};
	return {
		statusCode: 200,
		headersSent: false,
		writableEnded: false,
		body: undefined,
		setHeader(k, v) {
			headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return headers[k.toLowerCase()];
		},
		end(chunk) {
			this.body = chunk;
			this.writableEnded = true;
			this.headersSent = true;
			return this;
		},
	};
}

const trace = (over = {}) => ({ stage: 'gate', jobCreated: false, error: null, ...over });

describe('classifySubmitExit: one stage per pre-job ending', () => {
	it('sign_in: the account check refusal is its own outcome, not an accepted request', () => {
		expect(classifySubmitExit({ status: 401, body: { error: 'sign_in_required' }, trace: trace() })).toMatchObject({
			outcome: 'sign_in',
			stage: 'sign_in',
			cause: 'sign_in_required',
		});
	});

	it.each([
		['invalid_prompt', 400],
		['invalid_options', 400],
		['invalid_world', 400],
		['invalid_image_url', 400],
		['invalid_image_urls', 400],
		['invalid_view_labels', 400],
		['invalid_fill_other_sides', 400],
		['missing_sketch', 400],
		['backend_text_only', 422],
		['region_restricted', 403],
		['invalid_idempotency_key', 400],
		['idempotency_key_reused', 422],
	])('input: %s', (code, status) => {
		expect(classifySubmitExit({ status, body: { error: code }, trace: trace() })).toMatchObject({
			outcome: 'failed',
			stage: 'input',
			cause: code,
			provider: null,
		});
	});

	it.each([
		['three_hold_required', 402],
		['payment_invalid', 402],
		['payment_already_used', 409],
		['insufficient_credits', 402],
		['needs_key', 501],
		['unauthorized', 401],
	])('access: %s', (code, status) => {
		expect(classifySubmitExit({ status, body: { error: code }, trace: trace() })).toMatchObject({
			outcome: 'failed',
			stage: 'access',
			cause: code,
		});
	});

	it('access: a payment error code the gate invents still lands on access by its 402', () => {
		expect(classifySubmitExit({ status: 402, body: { error: 'payment_expired' }, trace: trace() })).toMatchObject({
			stage: 'access',
			cause: 'payment_expired',
		});
	});

	it('rate_limit: the platform limiter before any work, with its stated wait', () => {
		expect(
			classifySubmitExit({ status: 429, body: { error: 'rate_limited', retry_after: 42 }, trace: trace() }),
		).toMatchObject({ outcome: 'failed', stage: 'rate_limit', cause: 'rate_limited', retryAfterS: 42, provider: null });
		expect(classifySubmitExit({ status: 429, body: { error: 'daily_limit_reached' }, trace: trace() })).toMatchObject({
			stage: 'rate_limit',
			cause: 'daily_limit_reached',
		});
	});

	it('image_check: an unusable uploaded photo', () => {
		expect(classifySubmitExit({ status: 422, body: { error: 'image_not_usable' }, trace: trace() })).toMatchObject({
			stage: 'image_check',
			cause: 'image_not_usable',
		});
	});

	it('reference: a throttled image provider is the reference step, not the platform limiter', () => {
		const exit = classifySubmitExit({
			status: 429,
			body: { error: 'rate_limited', retry_after: 45 },
			trace: trace({
				stage: 'reference',
				error: { code: 'rate_limited', providerStatus: 429, retryAfter: 45, message: 'pollinations rate limited' },
			}),
		});
		expect(exit).toMatchObject({
			outcome: 'failed',
			stage: 'reference',
			cause: 'rate_limited',
			provider: 'pollinations',
			retryAfterS: 45,
			upstreamStatus: 429,
		});
	});

	it('reference: a billing refusal names the provider from its own message', () => {
		const exit = classifySubmitExit({
			status: 502,
			body: { error: 'generation_failed' },
			trace: trace({ stage: 'reference', error: { code: null, providerStatus: 402, message: 'hf flux-schnell returned 402' } }),
		});
		expect(exit).toMatchObject({ stage: 'reference', cause: 'generation_failed', provider: 'huggingface', upstreamStatus: 402 });
	});

	it('reference: storage refusing the reference view', () => {
		expect(
			classifySubmitExit({
				status: 503,
				body: { error: 'storage_unavailable', backend: 'replicate' },
				retryAfterHeader: '60',
				trace: trace({ stage: 'reference' }),
			}),
		).toMatchObject({ stage: 'reference', cause: 'storage_unavailable', provider: 'replicate', retryAfterS: 60 });
	});

	it('direction: an unexpected throw while rewriting the prompt', () => {
		expect(classifySubmitExit({ status: 500, body: { error: 'internal_error' }, trace: trace({ stage: 'direction' }) })).toMatchObject({
			stage: 'direction',
			cause: 'internal_error',
		});
	});

	it('views: an unexpected throw while painting turnaround views', () => {
		expect(classifySubmitExit({ status: 500, body: {}, trace: trace({ stage: 'views' }) })).toMatchObject({
			stage: 'views',
			cause: 'http_500',
		});
	});

	it('submit: a lane that refuses the job names its backend', () => {
		expect(
			classifySubmitExit({
				status: 503,
				body: { error: 'provider_busy', retry_after: 30 },
				trace: trace({ stage: 'submit', error: { message: 'hf space queue full' } }),
			}),
		).toMatchObject({ stage: 'submit', cause: 'provider_busy', provider: 'huggingface', retryAfterS: 30 });
		expect(
			classifySubmitExit({
				status: 501,
				body: { error: 'backend_unconfigured', backend: 'triposg' },
				trace: trace({ stage: 'submit' }),
			}),
		).toMatchObject({ stage: 'submit', cause: 'backend_unconfigured', provider: 'triposg' });
	});

	it('gate: an unknown failure before provider work began', () => {
		expect(classifySubmitExit({ status: 503, body: { error: 'unconfigured' }, trace: trace() })).toMatchObject({
			stage: 'gate',
			cause: 'unconfigured',
		});
	});
});

describe('classifySubmitExit: what is not a pre-job ending', () => {
	it('a created job is a job, whatever happens after', () => {
		expect(classifySubmitExit({ status: 200, body: { job_id: 'j1' }, trace: trace() })).toEqual({ outcome: 'job' });
		expect(classifySubmitExit({ status: 200, body: { job_id: 'j1', coalesced: true }, trace: trace() })).toEqual({ outcome: 'job' });
		// The row exists, so markFailed owns the failure count. Not counted twice.
		expect(
			classifySubmitExit({ status: 502, body: { error: 'generation_failed' }, trace: trace({ stage: 'submit', jobCreated: true }) }),
		).toEqual({ outcome: 'job' });
	});

	it('a cache hit is a model delivered in the response', () => {
		expect(
			classifySubmitExit({ status: 200, body: { job_id: null, creation_id: null, status: 'done', glb_url: 'https://x/a.glb', cached: true }, trace: trace() }),
		).toEqual({ outcome: 'delivered' });
	});

	it('an idempotent replay and an in-progress duplicate are not counted again', () => {
		expect(classifySubmitExit({ status: 200, body: { job_id: 'j1' }, replayed: true })).toEqual({ outcome: 'replay' });
		expect(classifySubmitExit({ status: 409, body: { error: 'idempotency_in_progress' } })).toEqual({ outcome: 'duplicate' });
	});
});

describe('observeForgeSubmit', () => {
	it('records exactly one event per response, from the real writers', async () => {
		const record = vi.fn(async () => {});
		const res = fakeRes();
		const obs = observeForgeSubmit(res, { record });
		await obs.run(async () => {
			rateLimited(res, { limit: 5, remaining: 0, reset: Date.now() + 30_000 }, 'Generation limit reached.');
		});
		// A second write (a double-send guard) is not a second event.
		json(res, 500, { error: 'late' });
		expect(record).toHaveBeenCalledTimes(1);
		expect(record.mock.calls[0][0]).toMatchObject({
			outcome: 'failed',
			stage: 'rate_limit',
			cause: 'rate_limited',
			httpStatus: 429,
			internal: false,
		});
		expect(record.mock.calls[0][0].retryAfterS).toBeGreaterThan(0);
	});

	it('reads the stage the handler marked inside run()', async () => {
		const { markSubmitStage, noteSubmitError } = await import('../../api/_lib/forge-events.js');
		const record = vi.fn(async () => {});
		const res = fakeRes();
		const obs = observeForgeSubmit(res, { record });
		await obs.run(async () => {
			markSubmitStage('reference');
			noteSubmitError(Object.assign(new Error('pollinations timed out'), { code: 'provider_unreachable' }));
			json(res, 502, { error: 'generation_failed', message: 'x' });
		});
		expect(record.mock.calls[0][0]).toMatchObject({ stage: 'reference', provider: 'pollinations', cause: 'generation_failed' });
	});

	it('marks a showcase seed job internal so it never moves a user-facing rate', async () => {
		const record = vi.fn(async () => {});
		const res = fakeRes();
		observeForgeSubmit(res, { internal: true, record });
		json(res, 400, { error: 'invalid_prompt' });
		expect(record.mock.calls[0][0]).toMatchObject({ internal: true, stage: 'input' });
	});

	it('a store that throws, rejects or never answers changes nothing about the response', async () => {
		for (const record of [
			() => {
				throw new Error('store exploded');
			},
			() => Promise.reject(new Error('store down')),
			() => new Promise(() => {}),
		]) {
			const res = fakeRes();
			observeForgeSubmit(res, { record });
			const t0 = performance.now();
			json(res, 429, { error: 'rate_limited', retry_after: 9 });
			const elapsed = performance.now() - t0;
			expect(res.statusCode).toBe(429);
			expect(JSON.parse(res.body)).toEqual({ error: 'rate_limited', retry_after: 9 });
			// The response is written synchronously; recording is never awaited.
			expect(elapsed).toBeLessThan(50);
		}
	});
});

// The real store path: a Redis that stalls or errors must leave
// recordSubmitOutcome bounded and silent.
describe('recordSubmitOutcome against a failing store', () => {
	let logSpy;
	beforeEach(() => {
		vi.resetModules();
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});
	afterEach(() => {
		logSpy.mockRestore();
		vi.doUnmock('../../api/_lib/redis.js');
		vi.useRealTimers();
	});

	async function withStore(exec) {
		vi.doMock('../../api/_lib/redis.js', () => ({
			getRedis: () => ({
				pipeline: () => ({ hincrby() {}, expire() {}, exec }),
				hgetall: async () => null,
			}),
		}));
		return import('../../api/_lib/forge-events.js');
	}

	it('resolves within its bound when the store never answers', async () => {
		vi.useFakeTimers();
		const ev = await withStore(() => new Promise(() => {}));
		let settled = false;
		const p = ev
			.recordSubmitOutcome({ outcome: 'failed', stage: 'reference', cause: 'rate_limited', httpStatus: 429 })
			.then(() => {
				settled = true;
			});
		await vi.advanceTimersByTimeAsync(ev.PRE_JOB_RECORD_TIMEOUT_MS - 1);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(2);
		await p;
		expect(settled).toBe(true);
	});

	it('never throws when the store rejects', async () => {
		const ev = await withStore(() => Promise.reject(new Error('WRONGPASS')));
		await expect(
			ev.recordSubmitOutcome({ outcome: 'failed', stage: 'submit', cause: 'provider_busy', httpStatus: 503 }),
		).resolves.toBeUndefined();
	});

	it('logs one forge_submit line with no prompt or personal data', async () => {
		const ev = await withStore(async () => []);
		await ev.recordSubmitOutcome({
			outcome: 'failed',
			stage: 'reference',
			cause: 'rate_limited',
			provider: 'pollinations',
			httpStatus: 429,
			retryAfterS: 45,
			upstreamStatus: 429,
		});
		expect(logSpy).toHaveBeenCalledTimes(1);
		const line = JSON.parse(logSpy.mock.calls[0][0]);
		expect(line).toEqual({
			evt: 'forge_submit',
			outcome: 'failed',
			stage: 'reference',
			cause: 'rate_limited',
			provider: 'pollinations',
			http_status: 429,
			retry_after_s: 45,
			upstream_status: 429,
			internal: false,
		});
	});
});
