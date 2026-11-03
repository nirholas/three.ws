// A failed custody anchor must page ops once per outage (api/cron/custody-attest.js),
// mirroring cron-ledger-anchor-outage.test.js for the reasoning-ledger lane.
import { test, expect, vi, beforeEach } from 'vitest';

const sendOpsAlert = vi.fn(async () => {});
let epochResult;
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: (...a) => sendOpsAlert(...a) }));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));
vi.mock('../api/_lib/custody-proof.js', () => ({
	runAttestationEpoch: async () => epochResult,
	describeAnchorOutage: async () => ({ network: 'mainnet', attester: 'AttesterPubkey1111', lamports: 1234 }),
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

beforeEach(() => sendOpsAlert.mockClear());

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
