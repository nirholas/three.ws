/**
 * A rig job that fails on the worker does not count against the caller's
 * allowance. POST /api/forge?action=rig takes one hourly tool slot and one
 * daily paid slot; when the job's poll comes back failed, both are given back,
 * once, to the account that started it. A generation job (not 'auto-rig') and
 * a rig that finished are never refunded.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		REPLICATE_API_TOKEN: 'test-token',
		REPLICATE_RERIG_MODEL: 'example/rigger',
	});
	delete process.env.GCP_RECONSTRUCTION_KEY;
});

const upstream = vi.hoisted(() => ({ answer: { status: 'failed', error: 'CUDA error: device-side assert triggered' } }));
vi.mock('../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({
		supportsMode: () => true,
		submit: vi.fn(),
		status: vi.fn(async () => upstream.answer),
	}),
}));

const row = vi.hoisted(() => ({ value: null }));
vi.mock('../api/_lib/forge-store.js', () => ({
	forgeStoreEnabled: () => true,
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => row.value),
	runWithCreationContext: (_facts, fn) => fn(),
}));

const hourlyRefund = vi.fn(async () => {});
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: { ...actual.limits, mcp3dGenerateRefund: (...a) => hourlyRefund(...a) },
		clientIp: () => '203.0.113.9',
	};
});

const dailyRefund = vi.fn(async () => {});
vi.mock('../api/_lib/forge-scale.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, dailyPaidRefund: (...a) => dailyRefund(...a) };
});

const { default: handler } = await import('../api/forge.js');

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
		getHeader(name) { return this.headers[String(name).toLowerCase()]; },
		end(body) { this.body = body ?? null; },
	};
}

async function poll(jobId) {
	const res = makeRes();
	const req = { method: 'GET', url: `/api/forge?job=${jobId}`, headers: { 'x-forge-client': 'tester' } };
	await handler(req, res);
	return { status: res.statusCode, body: JSON.parse(res.body) };
}

const rigRow = (over = {}) => ({
	id: 'creation-1',
	status: 'generating',
	prompt: 'auto-rig',
	user_id: 'acct-7',
	created_at: new Date().toISOString(),
	...over,
});

beforeEach(() => {
	hourlyRefund.mockClear();
	dailyRefund.mockClear();
	upstream.answer = { status: 'failed', error: 'CUDA error: device-side assert triggered' };
});

describe('a failed rig job gives the allowance back', () => {
	it('refunds the hourly and daily slot of the account that started it', async () => {
		row.value = rigRow();
		const { body } = await poll('rigjob00000000000001');
		expect(body.status).toBe('failed');
		expect(hourlyRefund).toHaveBeenCalledWith('user:acct-7');
		expect(dailyRefund).toHaveBeenCalledWith('user:acct-7');
	});

	it('does not refund again once the row is already failed', async () => {
		row.value = rigRow({ status: 'failed' });
		await poll('rigjob00000000000002');
		expect(hourlyRefund).not.toHaveBeenCalled();
		expect(dailyRefund).not.toHaveBeenCalled();
	});

	it('does not refund a generation job through the rig path', async () => {
		row.value = rigRow({ prompt: 'a knight in plate armour' });
		await poll('genjob00000000000003');
		expect(hourlyRefund).not.toHaveBeenCalled();
	});

	it('does not refund a rig job that is still running', async () => {
		upstream.answer = { status: 'running' };
		row.value = rigRow();
		await poll('rigjob00000000000004');
		expect(hourlyRefund).not.toHaveBeenCalled();
	});
});
