// Tripo generation webhook: authenticity first, then idempotency, then
// ordering. Mirrors tests/print-webhook-idempotency.test.js's three
// properties for the print fulfillment webhook, applied to forge_creations.
//
//   1. An unsigned or forged delivery is refused with 401 before JSON.parse.
//   2. The claim on forge_webhook_deliveries happens before the payload's
//      meaning is used, so a retried delivery is a no-op.
//   3. materializeCreation's own idempotency (a 'done' row short-circuits)
//      means a duplicate or out-of-order task.completed can't regress a row
//      a prior poll already finished.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const SECRET = 'whsec_test_not_a_real_credential';

const ledger = new Set();
const claimForgeWebhookDelivery = vi.fn(async ({ provider, deliveryId }) => {
	const key = `${provider}:${deliveryId}`;
	if (ledger.has(key)) return { fresh: false };
	ledger.add(key);
	return { fresh: true };
});
const markForgeWebhookApplied = vi.fn(async () => {});
const releaseForgeWebhookDelivery = vi.fn(async ({ provider, deliveryId }) => {
	ledger.delete(`${provider}:${deliveryId}`);
});
const materializeCreation = vi.fn(async ({ replicateJobId }) => ({
	id: 'creation-1',
	glbUrl: `https://cdn.example.com/forge/creation-1.glb`,
}));
const markFailed = vi.fn(async () => {});
const findByJobAnyClient = vi.fn(async () => ROW);

vi.mock('../../api/_lib/forge-store.js', () => ({
	claimForgeWebhookDelivery: (...a) => claimForgeWebhookDelivery(...a),
	markForgeWebhookApplied: (...a) => markForgeWebhookApplied(...a),
	releaseForgeWebhookDelivery: (...a) => releaseForgeWebhookDelivery(...a),
	materializeCreation: (...a) => materializeCreation(...a),
	markFailed: (...a) => markFailed(...a),
	findByJobAnyClient: (...a) => findByJobAnyClient(...a),
	forgeStoreEnabled: () => true,
}));

const assertSafePublicUrl = vi.fn(async () => {});
vi.mock('../../api/_lib/ssrf-guard.js', () => ({
	assertSafePublicUrl: (...a) => assertSafePublicUrl(...a),
}));

const ROW = { id: 'creation-1', status: 'pending', client_key: 'client-1', backend: 'tripo' };

const handler = (await import('../../api/forge/webhook/tripo.js')).default;

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function sign(raw, timestamp = Math.floor(Date.now() / 1000), secret = SECRET) {
	const sig = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
	return `t=${timestamp},v1=${sig}`;
}

async function deliver(body, { headers = {}, signed = true, deliveryId = 'dlv-1' } = {}) {
	const raw = typeof body === 'string' ? body : JSON.stringify(body);
	const res = mockRes();
	await handler(
		{
			method: 'POST',
			url: '/api/forge/webhook/tripo',
			headers: {
				host: 'three.ws',
				'content-type': 'application/json',
				...(signed ? { 'tripo-webhook-signature': sign(raw) } : {}),
				'tripo-webhook-delivery': deliveryId,
				...headers,
			},
			rawBody: Buffer.from(raw),
		},
		res,
	);
	return res;
}

const COMPLETED = {
	id: 'evt_1',
	type: 'task.completed',
	created_at: new Date().toISOString(),
	data: { task_id: 'task-42', status: 'success', output: { model_url: 'https://tripo.example/task-42.glb' } },
};

const FAILED = {
	id: 'evt_2',
	type: 'task.failed',
	created_at: new Date().toISOString(),
	data: { task_id: 'task-42', status: 'failed', error: { code: 'GENERATION_ERROR', message: 'mesh collapsed' } },
};

beforeEach(() => {
	vi.clearAllMocks();
	ledger.clear();
	findByJobAnyClient.mockResolvedValue(ROW);
	process.env.TRIPO_WEBHOOK_SECRET = SECRET;
});

describe('authenticity is settled before anything else happens', () => {
	it('refuses a delivery with no TRIPO_WEBHOOK_SECRET configured', async () => {
		delete process.env.TRIPO_WEBHOOK_SECRET;
		const res = await deliver(COMPLETED);
		expect(res.statusCode).toBe(401);
		expect(claimForgeWebhookDelivery).not.toHaveBeenCalled();
	});

	it('refuses an unsigned delivery with 401', async () => {
		const res = await deliver(COMPLETED, { signed: false });
		expect(res.statusCode).toBe(401);
		expect(claimForgeWebhookDelivery).not.toHaveBeenCalled();
	});

	it('refuses a forged signature and never claims a ledger row', async () => {
		const res = await deliver(COMPLETED, { headers: { 'tripo-webhook-signature': 't=9999999999,v1=deadbeef' } });
		expect(res.statusCode).toBe(401);
		expect(claimForgeWebhookDelivery).not.toHaveBeenCalled();
	});

	it('refuses a signature outside the 5 minute replay window', async () => {
		const raw = JSON.stringify(COMPLETED);
		const stale = Math.floor(Date.now() / 1000) - 600;
		const res = await deliver(COMPLETED, { headers: { 'tripo-webhook-signature': sign(raw, stale) } });
		expect(res.statusCode).toBe(401);
	});

	it('refuses a body altered in flight', async () => {
		const raw = JSON.stringify(COMPLETED);
		const res = mockRes();
		await handler(
			{
				method: 'POST',
				url: '/api/forge/webhook/tripo',
				headers: {
					host: 'three.ws',
					'content-type': 'application/json',
					'tripo-webhook-signature': sign(raw),
					'tripo-webhook-delivery': 'dlv-tamper',
				},
				rawBody: Buffer.from(raw.replace('success', 'failed')),
			},
			res,
		);
		expect(res.statusCode).toBe(401);
	});

	it('rejects a non-POST', async () => {
		const res = mockRes();
		await handler({ method: 'GET', url: '/api/forge/webhook/tripo', headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});

describe('a verified delivery completes the job the way polling does', () => {
	it('materializes the creation on task.completed', async () => {
		const res = await deliver(COMPLETED);
		expect(res.statusCode).toBe(200);
		expect(res.json).toMatchObject({ ok: true, applied: true, status: 'done' });
		expect(materializeCreation).toHaveBeenCalledWith({
			replicateJobId: 'task-42',
			clientKey: 'client-1',
			glbUrl: 'https://tripo.example/task-42.glb',
		});
		expect(markForgeWebhookApplied).toHaveBeenCalledWith({ provider: 'tripo', deliveryId: 'dlv-1' });
	});

	it('marks the job failed on task.failed, carrying the error message', async () => {
		const res = await deliver(FAILED);
		expect(res.statusCode).toBe(200);
		expect(res.json).toMatchObject({ ok: true, applied: true, status: 'failed' });
		expect(markFailed).toHaveBeenCalledWith({
			replicateJobId: 'task-42',
			clientKey: 'client-1',
			error: 'mesh collapsed',
		});
	});

	it('answers 200 for an unknown job so Tripo stops retrying', async () => {
		findByJobAnyClient.mockResolvedValue(null);
		const res = await deliver(COMPLETED);
		expect(res.statusCode).toBe(200);
		expect(res.json).toMatchObject({ ok: true, applied: false, reason: 'no matching job' });
		expect(materializeCreation).not.toHaveBeenCalled();
	});

	it('acknowledges an informational event without touching a job', async () => {
		const res = await deliver({ type: 'balance.low', data: { task_id: 'task-42' } });
		expect(res.statusCode).toBe(200);
		expect(res.json).toMatchObject({ ok: true, applied: false });
		expect(materializeCreation).not.toHaveBeenCalled();
		expect(markFailed).not.toHaveBeenCalled();
	});
});

describe('a signed delivery can only act on a Tripo job, and only fetch a public https file', () => {
	const withModelUrl = (model_url) => ({
		...COMPLETED,
		data: { ...COMPLETED.data, output: { model_url } },
	});

	it('does not complete or fail a job that another provider owns, even when the task id matches', async () => {
		findByJobAnyClient.mockResolvedValue({ ...ROW, backend: 'meshy' });
		const done = await deliver(COMPLETED, { deliveryId: 'dlv-foreign-1' });
		const failed = await deliver(FAILED, { deliveryId: 'dlv-foreign-2' });
		for (const res of [done, failed]) {
			expect(res.statusCode).toBe(200);
			expect(res.json).toMatchObject({ ok: true, applied: false });
		}
		expect(materializeCreation).not.toHaveBeenCalled();
		expect(markFailed).not.toHaveBeenCalled();
	});

	it('refuses to fetch a model_url that points at an internal host, a plain-http host or a userinfo trick', async () => {
		const hostile = [
			'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
			'https://metadata.google.internal/computeMetadata/v1/',
			'https://127.0.0.1/admin.glb',
			'https://localhost:8080/x.glb',
			'https://10.0.0.5/x.glb',
			'http://tripo.example/task-42.glb',
			'https://tripo.example@evil.example/task-42.glb',
			'https://user:pass@tripo.example/task-42.glb',
			'file:///etc/passwd',
			'ftp://tripo.example/x.glb',
			'not a url',
		];
		for (const [i, url] of hostile.entries()) {
			const res = await deliver(withModelUrl(url), { deliveryId: `dlv-ssrf-${i}` });
			expect(res.statusCode).toBe(200);
			expect(res.json).toMatchObject({ ok: true, applied: false });
		}
		expect(materializeCreation).not.toHaveBeenCalled();
	});

	it('refuses a model_url that is not a string', async () => {
		for (const [i, url] of [{ href: 'https://tripo.example/a.glb' }, ['https://tripo.example/a.glb'], 42].entries()) {
			const res = await deliver(withModelUrl(url), { deliveryId: `dlv-type-${i}` });
			expect(res.json).toMatchObject({ applied: false });
		}
		expect(materializeCreation).not.toHaveBeenCalled();
	});

	it('refuses a public-looking host whose DNS answer is an internal address', async () => {
		assertSafePublicUrl.mockRejectedValueOnce(new Error('resolves to a private address'));
		const res = await deliver(withModelUrl('https://rebind.example/task-42.glb'), { deliveryId: 'dlv-rebind' });
		expect(res.json).toMatchObject({ ok: true, applied: false });
		expect(materializeCreation).not.toHaveBeenCalled();
	});

	it('still fetches the provider\'s real https CDN file', async () => {
		const url = 'https://tripo-data.rg1.data.tripo3d.com/tcli_abc/20260101/task-42/model.glb?Policy=x&Signature=y';
		const res = await deliver(withModelUrl(url), { deliveryId: 'dlv-real-cdn' });
		expect(res.json).toMatchObject({ applied: true });
		expect(materializeCreation).toHaveBeenCalledWith({ replicateJobId: 'task-42', clientKey: 'client-1', glbUrl: url });
	});
});

describe('a replayed delivery is applied exactly once', () => {
	it('answers 200 duplicate on the replay and never calls materializeCreation twice', async () => {
		await deliver(COMPLETED);
		const replay = await deliver(COMPLETED);
		expect(replay.statusCode).toBe(200);
		expect(replay.json).toMatchObject({ ok: true, duplicate: true, applied: false });
		expect(materializeCreation).toHaveBeenCalledTimes(1);
	});

	it('stays at one even after five retries of the same delivery id', async () => {
		for (let i = 0; i < 5; i += 1) await deliver(COMPLETED);
		expect(materializeCreation).toHaveBeenCalledTimes(1);
	});

	it('claims the delivery before parsing, so malformed JSON cannot be replayed', async () => {
		const res = await deliver('{not json');
		expect(res.statusCode).toBe(400);
		expect(claimForgeWebhookDelivery).toHaveBeenCalledTimes(1);
	});
});

describe('a failed side effect releases the claim so the retry re-runs it', () => {
	it('lets the Tripo retry apply the completion after the first apply threw', async () => {
		materializeCreation.mockRejectedValueOnce(new Error('r2 write failed'));
		const first = await deliver(COMPLETED, { deliveryId: 'dlv-retry' });
		expect(first.statusCode).toBeGreaterThanOrEqual(500);
		expect(releaseForgeWebhookDelivery).toHaveBeenCalledWith({ provider: 'tripo', deliveryId: 'dlv-retry' });
		const retry = await deliver(COMPLETED, { deliveryId: 'dlv-retry' });
		expect(retry.statusCode).toBe(200);
		expect(retry.json.duplicate).toBeUndefined();
		expect(retry.json.applied).toBe(true);
		expect(materializeCreation).toHaveBeenCalledTimes(2);
	});
});

describe('the database being unavailable makes Tripo retry', () => {
	it('returns 503 when forgeStoreEnabled() is false', async () => {
		vi.resetModules();
		vi.doMock('../../api/_lib/forge-store.js', () => ({
			claimForgeWebhookDelivery,
			markForgeWebhookApplied,
			releaseForgeWebhookDelivery,
			materializeCreation,
			markFailed,
			findByJobAnyClient,
			forgeStoreEnabled: () => false,
		}));
		const fresh = (await import('../../api/forge/webhook/tripo.js')).default;
		const res = await (async () => {
			const raw = JSON.stringify(COMPLETED);
			const r = mockRes();
			await fresh(
				{
					method: 'POST',
					url: '/api/forge/webhook/tripo',
					headers: {
						host: 'three.ws',
						'content-type': 'application/json',
						'tripo-webhook-signature': sign(raw),
						'tripo-webhook-delivery': 'dlv-db-down',
					},
					rawBody: Buffer.from(raw),
				},
				r,
			);
			return r;
		})();
		expect(res.statusCode).toBe(503);
	});
});
