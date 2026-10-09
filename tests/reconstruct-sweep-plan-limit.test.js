// The reconstruct sweep rescues jobs whose finalize was interrupted. When the
// owner's avatar library is full, materialization is refused with a plan-limit
// error. That is the owner's to fix, not a fault to retry: before this fix the
// sweep logged it and left the job open, so the same refused materialization
// re-ran on every 5-minute tick for the whole 30-day rescue window (production,
// 2026-10-09). The job must close as failed with the copy the status poll relays.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlCalls = [];
let openRows = [];

vi.mock('../api/_lib/db.js', () => {
	const sql = vi.fn(async (strings, ...values) => {
		const query = Array.isArray(strings) ? strings.join('?') : String(strings);
		sqlCalls.push({ query, values });
		if (/from avatar_regen_jobs\s+where mode = 'reconstruct'\s+and result_avatar_id is null/.test(query) && /select job_id/.test(query)) return openRows;
		return [];
	});
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
vi.mock('../api/_lib/http.js', () => ({
	wrapCron: (fn) => fn,
	method: () => true,
	json: (res, status, body) => {
		res._json = { status, body };
		return res;
	},
}));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));
vi.mock('../api/_lib/regen-provider.js', () => ({
	getRegenProviderForMode: vi.fn(async () => ({ name: 'gcp', instance: { status: vi.fn() } })),
}));
const finalize = vi.fn();
vi.mock('../api/_lib/reconstruct-finalize.js', () => ({
	finalizeReconstructStage: (...a) => finalize(...a),
	pollRiggingStage: vi.fn(),
}));
vi.mock('../api/_lib/provider-result-url.js', () => ({ isAllowedProviderResultUrl: () => true }));

const { default: handler } = await import('../api/cron/reconstruct-sweep.js');
const { PLAN_LIMIT_JOB_ERROR } = await import('../api/_lib/avatars.js');

const doneJob = {
	job_id: 'job-1',
	user_id: 'user-1',
	mode: 'reconstruct',
	status: 'done',
	provider: 'gcp',
	ext_job_id: 'ext-1',
	result_glb_url: 'https://storage.googleapis.com/bucket/job-1.glb',
	error: null,
	params: {},
};

beforeEach(() => {
	sqlCalls.length = 0;
	openRows = [doneJob];
	finalize.mockReset();
});

describe('reconstruct sweep on a full avatar library', () => {
	it('closes the job as failed with the caller-facing plan-limit copy', async () => {
		finalize.mockRejectedValue(Object.assign(new Error('avatar count limit reached on plan free'), { status: 402, code: 'plan_limit_count' }));
		const res = {};
		await handler({ method: 'GET', url: '/api/cron/reconstruct-sweep', headers: {} }, res);

		const close = sqlCalls.find((c) => /set status = 'failed', error = \?, error_kind = \?/.test(c.query));
		expect(close).toBeTruthy();
		expect(close.values).toEqual([PLAN_LIMIT_JOB_ERROR, 'input', 'job-1', 'user-1']);
		expect(res._json.body.failed).toBe(1);
		expect(res._json.body.errored).toBe(0);
	});

	it('still leaves a genuine engine fault open for the next tick', async () => {
		finalize.mockRejectedValue(new Error('fetch failed'));
		const res = {};
		await handler({ method: 'GET', url: '/api/cron/reconstruct-sweep', headers: {} }, res);

		expect(sqlCalls.some((c) => /set status = 'failed', error = \?, error_kind/.test(c.query))).toBe(false);
		expect(res._json.body.errored).toBe(1);
	});
});
