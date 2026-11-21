'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pollJob, stageLabel, nextInterval, clampProgress, STAGE_LABELS } = require('../src/core/poll');
const { ApiError, MESSAGES, fromResponse, normalise, messageFor } = require('../src/core/errors');
const { CancelToken, withRetry } = require('../src/core/retry');
const { createClient } = require('../src/core/client');
const { startC4Server, instantSleep, KEY } = require('./c4-server');

test('stage labels cover every worker stage and queued', () => {
	for (const s of ['download', 'stitch', 'frames', 'sfm', 'train', 'export', 'upload']) assert.ok(STAGE_LABELS[s], s);
	assert.equal(stageLabel({ status: 'queued' }), STAGE_LABELS.queued);
	assert.equal(stageLabel({ status: 'running', stage: 'sfm' }), STAGE_LABELS.sfm);
	assert.equal(stageLabel({ status: 'running', stage: 'weird' }), 'Processing');
});

test('poll interval backs off from 2 s to a 6 s ceiling; progress is clamped', () => {
	assert.equal(nextInterval(0), 2000);
	assert.equal(nextInterval(100), 6000);
	assert.equal(clampProgress(5), 1);
	assert.equal(clampProgress(-1), 0);
	assert.equal(clampProgress('nope'), 0);
});

test('polls a real C4 job through every stage to success', async () => {
	const server = await startC4Server();
	try {
		const client = createClient({ origin: server.origin, getKey: async () => KEY, sleep: instantSleep });
		const started = await client.startCapture({ source_url: 'https://x/y.mp4', source_kind: 'equirect_video', quality: 'standard' });
		const labels = [];
		const sleeps = [];
		const final = await pollJob({
			fetchStatus: () => client.getCapture(started.job_id),
			token: new CancelToken(),
			sleep: async (ms) => sleeps.push(ms),
			onUpdate: (u) => labels.push(u.label),
		});
		assert.equal(final.status, 'succeeded');
		assert.ok(final.result.preview_url);
		assert.ok(labels.includes(STAGE_LABELS.train));
		assert.deepEqual(sleeps.slice(0, 3), [2000, 2500, 3000]);
	} finally {
		await server.close();
	}
});

test('a failed job throws its own error code with the visitor message', async () => {
	const server = await startC4Server({ failJob: { code: 'unsupported_camera', message: 'raw', hint: 'operator only' } });
	try {
		const client = createClient({ origin: server.origin, getKey: async () => KEY, sleep: instantSleep });
		const { job_id } = await client.startCapture({ source_url: 'u', source_kind: 'insv' });
		await assert.rejects(
			pollJob({ fetchStatus: () => client.getCapture(job_id), token: new CancelToken(), sleep: instantSleep }),
			(e) => e.code === 'unsupported_camera' && e.message === MESSAGES.unsupported_camera,
		);
	} finally {
		await server.close();
	}
});

test('cancelling stops polling and DELETE cancels the job server-side', async () => {
	const server = await startC4Server();
	try {
		const client = createClient({ origin: server.origin, getKey: async () => KEY, sleep: instantSleep });
		const { job_id } = await client.startCapture({ source_url: 'u', source_kind: 'insv' });
		const token = new CancelToken();
		let polls = 0;
		await assert.rejects(
			pollJob({ fetchStatus: () => (++polls === 2 && token.cancel(), client.getCapture(job_id)), token, sleep: instantSleep }),
			(e) => e.code === 'cancelled',
		);
		await client.cancelCapture(job_id);
		assert.equal(server.jobs.get(job_id).cancelled, true);
	} finally {
		await server.close();
	}
});

test('transient network failures during polling are tolerated, then give up', async () => {
	let calls = 0;
	const ok = await pollJob({
		fetchStatus: async () => {
			if (++calls <= 2) throw Object.assign(new TypeError('Failed to fetch'));
			return { status: 'succeeded', progress: 1 };
		},
		token: new CancelToken(),
		sleep: instantSleep,
	});
	assert.equal(ok.status, 'succeeded');
	await assert.rejects(
		pollJob({ fetchStatus: async () => { throw new TypeError('Failed to fetch'); }, token: new CancelToken(), sleep: instantSleep, maxTransientFailures: 2 }),
		(e) => e.code === 'offline',
	);
});

test('polling times out on a job that never finishes', async () => {
	let t = 0;
	await assert.rejects(
		pollJob({ fetchStatus: async () => ({ status: 'running' }), token: new CancelToken(), sleep: instantSleep, maxMs: 1000, now: () => (t += 600) }),
		(e) => e.code === 'timeout',
	);
});

test('every C4 error code maps to a visitor message and never leaks the operator hint', () => {
	const codes = [
		'sign_in_required', 'missing_key', 'invalid_size', 'invalid_content_type', 'too_many_open_uploads', 'daily_quota_exceeded',
		'too_many_active', 'invalid_trim', 'invalid_source_url', 'invalid_image_url', 'stitch_failed', 'depth_failed', 'worker_failed', 'pano_scene_failed',
		'upload_not_found', 'size_mismatch', 'storage_error', 'unconfigured', 'rate_limited', 'not_found',
		'unsupported_camera', 'unsupported_input', 'corrupt_input', 'reconstruction_failed', 'reconstruction_quality', 'cancelled', 'offline', 'timeout', 'job_failed',
	];
	for (const code of codes) {
		assert.ok(Object.hasOwn(MESSAGES, code), `${code} has a local message`);
		const err = fromResponse(400, { error: code, message: 'SERVER TEXT', hint: 'set GCP_PANO2SPLAT_URL' });
		assert.equal(err.message, MESSAGES[code]);
		assert.ok(!/GCP_|hint|REDIS|S3_/i.test(err.message), `${code} message is clean`);
	}
	assert.ok(!/ — |–/.test(Object.values(MESSAGES).join(' ')), 'no em or en dashes in copy');
});

test('unknown codes keep a short server message and long ones go generic', () => {
	assert.equal(messageFor('brand_new', 'Try a shorter clip.'), 'Try a shorter clip.');
	assert.match(messageFor('brand_new', 'x'.repeat(400)), /Something went wrong/);
	assert.match(messageFor('brand_new', ''), /Something went wrong/);
});

test('HTTP status drives retry: 5xx and 429 retry, quota and sign-in do not', () => {
	assert.equal(fromResponse(503, { error: 'unconfigured' }).retryable, true);
	assert.equal(fromResponse(429, { error: 'rate_limited' }).retryable, true);
	assert.equal(fromResponse(429, { error: 'daily_quota_exceeded' }).retryable, false);
	assert.equal(fromResponse(401, {}).code, 'sign_in_required');
	assert.equal(fromResponse(401, {}).retryable, false);
	assert.equal(normalise(new TypeError('Failed to fetch')).code, 'offline');
	assert.equal(normalise(Object.assign(new Error('x'), { name: 'AbortError' })).code, 'cancelled');
});

test('withRetry stops at non-retryable errors and honours the attempt budget', async () => {
	let n = 0;
	await assert.rejects(withRetry(async () => { n++; throw new ApiError('x', 'm', { retryable: true }); }, { attempts: 3, sleep: instantSleep }));
	assert.equal(n, 3);
	n = 0;
	await assert.rejects(withRetry(async () => { n++; throw new ApiError('x', 'm', { retryable: false }); }, { attempts: 3, sleep: instantSleep }));
	assert.equal(n, 1);
});

test('a missing key is reported before any request is made', async () => {
	const server = await startC4Server();
	try {
		const client = createClient({ origin: server.origin, getKey: async () => '', sleep: instantSleep });
		await assert.rejects(client.listCaptures(), (e) => e.code === 'missing_key');
		assert.equal(server.log.length, 0);
		const wrong = createClient({ origin: server.origin, getKey: async () => 'nope', sleep: instantSleep });
		await assert.rejects(wrong.listCaptures(), (e) => e.code === 'sign_in_required');
	} finally {
		await server.close();
	}
});
