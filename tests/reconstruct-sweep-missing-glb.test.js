// Production logged `[reconstruct-sweep] job error { error: 'fetch glb: 404' }`
// for the same ~17 'rigging' jobs on every 5-minute tick for days. Their bare
// mesh was parked while R2 rejected writes (so it lives in the GCS fallback
// bucket, not at the r2.dev URL stored in params.rig.unriggedUrl), and the
// rig-failure path re-fetched that r2.dev URL forever. A mesh that is 404 and
// has stayed 404 for over an hour can never be collected: the job must close as
// failed with caller-facing copy instead of erroring on every tick.

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
const poll = vi.fn();
vi.mock('../api/_lib/reconstruct-finalize.js', () => ({
	finalizeReconstructStage: vi.fn(),
	pollRiggingStage: (...a) => poll(...a),
}));
vi.mock('../api/_lib/provider-result-url.js', () => ({ isAllowedProviderResultUrl: () => true }));

const { default: handler } = await import('../api/cron/reconstruct-sweep.js');
const { MESH_GONE_JOB_ERROR } = await import('../api/cron/reconstruct-sweep.js');

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const rigging = (createdAt) => ({
	job_id: 'gcp-1', user_id: 'user-1', mode: 'reconstruct', status: 'rigging', provider: 'gcp',
	ext_job_id: 'ext-1', result_glb_url: null, error: null, params: {}, created_at: createdAt,
});

const run = async () => {
	const res = {};
	await handler({ method: 'GET', url: '/api/cron/reconstruct-sweep', headers: {} }, res);
	return res._json.body;
};

beforeEach(() => {
	sqlCalls.length = 0;
	poll.mockReset();
});

describe('reconstruct sweep on a permanently missing GLB', () => {
	it('fails an old job whose mesh is 404 instead of erroring every tick', async () => {
		openRows = [rigging(hoursAgo(5))];
		poll.mockRejectedValue(new Error('fetch glb: 404'));
		const body = await run();
		const close = sqlCalls.find((c) => /set status = 'failed', error = \?, error_kind = \?/.test(c.query));
		expect(close).toBeTruthy();
		expect(close.values).toEqual([MESH_GONE_JOB_ERROR, 'input', 'gcp-1', 'user-1']);
		expect(body.failed).toBe(1);
		expect(body.errored).toBe(0);
	});

	it('keeps retrying a fresh job, since the worker may still be writing the file', async () => {
		openRows = [rigging(hoursAgo(0.2))];
		poll.mockRejectedValue(new Error('fetch glb: 404'));
		const body = await run();
		expect(sqlCalls.some((c) => /set status = 'failed', error = \?, error_kind/.test(c.query))).toBe(false);
		expect(body.errored).toBe(1);
	});

	it('does not close a job on a transient 503', async () => {
		openRows = [rigging(hoursAgo(5))];
		poll.mockRejectedValue(new Error('fetch glb: 503'));
		const body = await run();
		expect(sqlCalls.some((c) => /set status = 'failed', error = \?, error_kind/.test(c.query))).toBe(false);
		expect(body.errored).toBe(1);
	});
});
