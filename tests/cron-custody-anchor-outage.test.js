// A failed custody anchor must page ops once per outage (api/cron/custody-attest.js),
// mirroring cron-ledger-anchor-outage.test.js for the reasoning-ledger lane.
import { test, expect, vi, beforeEach } from 'vitest';

const sendOpsAlert = vi.fn(async () => {});
let epochResult;
let reconcileImpl = async () => ({ checked: 0, promoted: [], errors: [] });
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: (...a) => sendOpsAlert(...a) }));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));
vi.mock('../api/_lib/custody-proof.js', () => ({
	runAttestationEpoch: async () => epochResult,
	describeAnchorOutage: async () => ({ network: 'mainnet', attester: 'AttesterPubkey1111', lamports: 1234 }),
	reconcileLandedAnchors: (...a) => reconcileImpl(...a),
}));

const handler = (await import('../api/cron/custody-attest.js')).default;

function makeRes() {
	return {
		statusCode: 0, body: null, headersSent: false, writableEnded: false,
		setHeader() {}, getHeader() {},
		status(c) { this.statusCode = c; return this; },
		end(p) { this.writableEnded = true; if (p && this.body === null) { try { this.body = JSON.parse(p); } catch { this.body = p; } } return this; },
		json(p) { this.body = p; return this; },
	};
}

beforeEach(() => {
	sendOpsAlert.mockClear();
	reconcileImpl = async () => ({ checked: 0, promoted: [], errors: [] });
});

test('an anchor_failed epoch pages ops with a per-network signature and the fix', async () => {
	epochResult = { epoch: 9, anchor_status: 'anchor_failed', anchor_error: 'attester_unfunded:mainnet' };
	const res = makeRes();
	await handler({ method: 'GET', url: '/api/cron/custody-attest', headers: {} }, res);
	expect(sendOpsAlert).toHaveBeenCalledTimes(1);
	const [title, detail, opts] = sendOpsAlert.mock.calls[0];
	expect(title).toContain('Custody proof');
	expect(detail).toContain('AttesterPubkey1111');
	expect(detail).toContain('attester_unfunded:mainnet');
	expect(detail).toContain('0.000001 SOL');
	expect(opts).toMatchObject({ signature: 'custody-anchor-failed:mainnet' });
});

test('an anchored epoch pages nobody', async () => {
	epochResult = { epoch: 10, anchor_status: 'anchored', anchor_signature: 'sig' };
	const res = makeRes();
	await handler({ method: 'GET', url: '/api/cron/custody-attest', headers: {} }, res);
	expect(sendOpsAlert).not.toHaveBeenCalled();
});

test('an epoch whose memo landed after the wait gave up is repaired and pages nobody', async () => {
	epochResult = { epoch: 11, anchor_status: 'anchor_failed', anchor_error: 'Transaction S expired: block height exceeded' };
	reconcileImpl = async () => ({ checked: 1, promoted: [{ epoch: '11', signature: 'S', anchored_at: '2026-11-04T12:18:28.000Z' }], errors: [] });
	const res = makeRes();
	await handler({ method: 'GET', url: '/api/cron/custody-attest', headers: {} }, res);
	expect(sendOpsAlert).not.toHaveBeenCalled();
	expect(res.body).toMatchObject({ ok: true, anchor_status: 'anchored', anchor_signature: 'S', reconciled: { promoted: [{ epoch: '11' }] } });
});

test('earlier repaired epochs are reported while a still-failed current epoch pages', async () => {
	epochResult = { epoch: 12, anchor_status: 'anchor_failed', anchor_error: 'attester_unfunded:mainnet' };
	reconcileImpl = async () => ({ checked: 1, promoted: [{ epoch: '5', signature: 'old', anchored_at: 'x' }], errors: [] });
	const res = makeRes();
	await handler({ method: 'GET', url: '/api/cron/custody-attest', headers: {} }, res);
	expect(sendOpsAlert).toHaveBeenCalledTimes(1);
	expect(res.body.reconciled.promoted).toHaveLength(1);
});

test('a reconcile failure never fails the cron', async () => {
	epochResult = { epoch: 13, anchor_status: 'anchored', anchor_signature: 'sig' };
	reconcileImpl = async () => {
		throw new Error('ATTEST_AGENT_SECRET_KEY not configured');
	};
	const res = makeRes();
	await handler({ method: 'GET', url: '/api/cron/custody-attest', headers: {} }, res);
	expect(res.statusCode).toBe(200);
	expect(res.body).toMatchObject({ ok: true, reconciled: { error: 'ATTEST_AGENT_SECRET_KEY not configured' } });
});
