// classify() maps every answer /api/forge sends (see api/forge.js) to the
// outcome the sweep acts on. The shapes below are the ones the handler writes.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, normalizeBaseUrl, submitModel } from '../supabase/functions/three-ws-forge/forge.ts';

describe('classify', () => {
	it('treats a cached submit (done + glb_url, no job id) as done', () => {
		const out = classify(200, { status: 'done', glb_url: 'https://cdn.three.ws/forge/a.glb', backend: 'trellis_selfhost' });
		assert.deepEqual(out, { kind: 'done', glbUrl: 'https://cdn.three.ws/forge/a.glb', jobId: undefined, backend: 'trellis_selfhost', previewImageUrl: undefined });
	});

	it('treats a submit with a job id as pending', () => {
		assert.deepEqual(classify(202, { job_id: 'f1.abc', status: 'queued', backend: 'trellis_selfhost' }), {
			kind: 'pending',
			jobId: 'f1.abc',
			status: 'queued',
			backend: 'trellis_selfhost',
		});
	});

	it('treats a running poll as pending and a finished poll as done', () => {
		assert.equal(classify(200, { job_id: 'f1.abc', status: 'running' }).kind, 'pending');
		const done = classify(200, { status: 'done', glb_url: '/forge/a.glb', preview_image_url: 'https://x/p.png' });
		assert.equal(done.kind, 'done');
		assert.equal(done.previewImageUrl, 'https://x/p.png');
	});

	it('fails a poll that reports the job failed', () => {
		assert.deepEqual(classify(200, { status: 'failed', error: 'The lane could not read this prompt.' }), {
			kind: 'fatal',
			code: 'generation_failed',
			message: 'The lane could not read this prompt.',
		});
	});

	it('fails on a rejected key with a message that says where to get one', () => {
		const out = classify(401, { error: 'sign_in_required', message: 'Sign in to make a model.' });
		assert.equal(out.kind, 'fatal');
		assert.equal(out.code, 'sign_in_required');
		assert.match(out.message, /three\.ws\/dashboard\/api-keys/);
		assert.match(out.message, /THREE_WS_API_KEY/);
	});

	it('retries a rate limit after retry_after, and the daily limit at its reset time', () => {
		const burst = classify(429, { error: 'rate_limited', message: 'Slow down.', retry_after: 42 });
		assert.deepEqual(burst, { kind: 'retry', code: 'rate_limited', message: 'Slow down.', retryAfterS: 42, until: undefined, quota: false });

		const reset = new Date(Date.now() + 3 * 3600_000).toISOString();
		const daily = classify(429, { error: 'daily_limit_reached', limit: 'generation_daily', message: 'Daily limit.', retry_after: 10, reset_at: reset });
		assert.equal(daily.kind, 'retry');
		assert.equal(daily.until, reset);
		assert.equal(daily.code, 'daily_limit_reached');
		assert.equal(daily.quota, true, 'a daily limit is a quota wait, not a failed attempt');
		assert.ok(daily.retryAfterS > 3 * 3600 - 5 && daily.retryAfterS <= 3 * 3600, `waits until reset, got ${daily.retryAfterS}s`);
	});

	it('retries busy lanes, outages and a still-running idempotent submit', () => {
		for (const [status, body] of [
			[503, { error: 'provider_busy', retry_after: 30 }],
			[503, { error: 'generation_unavailable', retry_after: 60 }],
			[503, { error: 'lane_unavailable', retry_after: 30 }],
			[503, { error: 'storage_unavailable' }],
			[502, { error: 'generation_failed', message: 'lane error' }],
			[504, {}],
			[409, { error: 'idempotency_in_progress', retry_after: 2 }],
		]) {
			assert.equal(classify(status, body).kind, 'retry', `${status} ${body.error}`);
		}
		assert.equal(classify(409, { error: 'idempotency_in_progress', retry_after: 2 }).retryAfterS, 2);
		assert.equal(classify(503, {}, new Headers({ 'retry-after': '17' })).retryAfterS, 17);
	});

	it('fails requests that can never succeed as sent', () => {
		assert.equal(classify(400, { error: 'invalid_prompt', message: 'Describe one subject.' }).kind, 'fatal');
		assert.equal(classify(422, { error: 'idempotency_key_reused' }).kind, 'fatal');
		assert.equal(classify(501, { error: 'needs_key', provider: 'meshy' }).kind, 'fatal');
	});

	it('caps a retry wait at an hour', () => {
		assert.equal(classify(429, { error: 'rate_limited', retry_after: 99999 }).retryAfterS, 3600);
	});
});

describe('submitModel', () => {
	it('refuses a too-short prompt without calling three.ws', async () => {
		const out = await submitModel({ apiKey: 'k', fetch: () => assert.fail('no request expected') }, { id: 'r1', prompt: ' a ', tier: 'draft' });
		assert.deepEqual(out, { kind: 'fatal', code: 'invalid_prompt', message: 'Describe one subject in at least 3 characters.' });
	});

	it('normalizes the base URL', () => {
		assert.equal(normalizeBaseUrl(undefined), 'https://three.ws');
		assert.equal(normalizeBaseUrl(' https://staging.three.ws/// '), 'https://staging.three.ws');
	});
});
