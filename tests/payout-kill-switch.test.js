// Payout kill switch and anomaly detection.
//
// The kill switch is the `payouts_paused` app_flags row (env fallback
// PAYOUTS_PAUSED). Proven through the real cron handlers: paused claims and
// sends nothing and answers paused:true; unpaused behaves as before. The anomaly
// thresholds are exercised through the pure evaluator.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = { flag: null, statements: [], audit: [] };

vi.mock('../api/_lib/db.js', () => ({
	isDbUnavailableError: vi.fn(() => false),
	isDbCapacityError: vi.fn(() => false),
	sql: vi.fn(async (strings, ...values) => {
		const text = strings.join('?').replace(/\s+/g, ' ').toLowerCase();
		state.statements.push(text);
		if (text.includes('from app_flags')) return state.flag ? [state.flag] : [];
		if (text.includes('insert into app_flags')) {
			const [key, enabled, value, updatedBy] = values;
			state.flag = { key, enabled, value: value ? JSON.parse(value) : null, updated_by: updatedBy, updated_at: 'now' };
			return [state.flag];
		}
		return [];
	}),
}));
vi.mock('../api/_lib/audit.js', () => ({
	logAudit: vi.fn(),
	logAuditNow: vi.fn(async (entry) => {
		state.audit.push(entry);
		return true;
	}),
}));
const adminState = { user: { id: 'admin-1' } };
vi.mock('../api/_lib/admin.js', () => ({
	requireAdmin: vi.fn(async (_req, res) => {
		if (adminState.user) return adminState.user;
		res.statusCode = 403;
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify({ error: 'forbidden' }));
		return null;
	}),
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: vi.fn(() => true) }));
vi.mock('../api/_lib/alerts.js', () => ({
	sendOpsAlert: vi.fn(async () => undefined),
	alertsConfigured: vi.fn(() => false),
	severityOf: vi.fn(() => 'warn'),
}));
vi.mock('../api/_lib/solana-transfer.js', () => ({ transferSolanaUSDC: vi.fn(async () => 'sig') }));
vi.mock('../api/_lib/evm-transfer.js', () => ({ sendEvmUsdc: vi.fn(), resolveEvmChainId: vi.fn(() => null) }));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn(async () => undefined) }));
vi.mock('../api/_lib/withdrawal-chain-status.js', () => ({ checkSendStatus: vi.fn(async () => ({ state: 'pending' })) }));

process.env.TREASURY_KEYPAIR = 'synthetic-treasury-key';
process.env.CRON_SECRET = 'test-cron';
process.env.COIN_DEMO_ENABLED = 'false';

const { default: cron } = await import('../api/cron/[name].js');
const { default: adminPause } = await import('../api/admin-payouts-pause.js');
const { __clearFlagCache } = await import('../api/_lib/flags.js');
const { payoutsPaused, setPayoutsPaused } = await import('../api/_lib/payout-kill-switch.js');
const { evaluatePayouts, median } = await import('../api/_lib/payout-anomaly.js');

function run(name) {
	const req = { method: 'POST', url: `/api/cron/${name}?name=${name}`, query: { name }, headers: {} };
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; this.writableEnded = true; this.headersSent = true; },
	};
	return cron(req, res).then(() => ({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }));
}

const paymentStatements = () => state.statements.filter((t) => t.includes('agent_withdrawals'));

beforeEach(() => {
	state.flag = null;
	state.statements = [];
	state.audit = [];
	delete process.env.PAYOUTS_PAUSED;
	__clearFlagCache();
});

describe('payout kill switch', () => {
	it.each(['process-withdrawals', 'monetization-payouts', 'run-coin-payouts', 'club-payouts'])(
		'%s claims nothing and returns paused:true while the flag is on',
		async (name) => {
			state.flag = { key: 'payouts_paused', enabled: true, value: { reason: 'runaway' } };
			const out = await run(name);
			expect(out.status).toBe(200);
			expect(out.body.paused).toBe(true);
			expect(paymentStatements()).toEqual([]);
		},
	);

	it('process-withdrawals runs normally with the flag off', async () => {
		state.flag = { key: 'payouts_paused', enabled: false, value: null };
		const out = await run('process-withdrawals');
		expect(out.body.paused).toBeUndefined();
		expect(paymentStatements().length).toBeGreaterThan(0);
	});

	it('process-withdrawals runs normally when no flag row exists', async () => {
		const out = await run('process-withdrawals');
		expect(out.body.paused).toBeUndefined();
	});

	it('PAYOUTS_PAUSED=true pauses when no row exists, and an explicit row wins over it', async () => {
		process.env.PAYOUTS_PAUSED = 'true';
		expect(await payoutsPaused()).toBe(true);
		__clearFlagCache();
		state.flag = { key: 'payouts_paused', enabled: false, value: null };
		expect(await payoutsPaused()).toBe(false);
	});

	it('toggling through setPayoutsPaused is reflected by the next cron response and writes an audit row', async () => {
		const paused = await setPayoutsPaused({ paused: true, reason: 'drain suspected', userId: 'admin-1' });
		expect(paused).toMatchObject({ paused: true, reason: 'drain suspected', audited: true });
		expect((await run('process-withdrawals')).body.paused).toBe(true);
		expect(state.audit).toEqual([
			expect.objectContaining({ userId: 'admin-1', action: 'payouts.pause', resourceId: 'payouts_paused' }),
		]);

		await setPayoutsPaused({ paused: false, userId: 'admin-1' });
		expect((await run('process-withdrawals')).body.paused).toBeUndefined();
		expect(state.audit[1]).toEqual(expect.objectContaining({ action: 'payouts.resume' }));
	});
});

describe('payout anomaly evaluator', () => {
	const steady = Array.from({ length: 14 }, () => 100);

	it('computes a median', () => {
		expect(median([])).toBe(0);
		expect(median([5, 1, 3])).toBe(3);
		expect(median([4, 1, 3, 2])).toBe(2.5);
	});

	it('flags volume above 3x the trailing median and stays quiet at or below it', () => {
		const hot = evaluatePayouts({ perMint: { USDC: { last24h: 301, last24hCount: 4, trailingDaily: steady } }, failed24h: 0, total24h: 4 });
		expect(hot).toHaveLength(1);
		expect(hot[0].kind).toBe('volume');
		const calm = evaluatePayouts({ perMint: { USDC: { last24h: 300, last24hCount: 4, trailingDaily: steady } }, failed24h: 0, total24h: 4 });
		expect(calm).toEqual([]);
	});

	it('treats missing history days as zero when taking the median', () => {
		const sparse = evaluatePayouts({ perMint: { USDC: { last24h: 900, last24hCount: 3, trailingDaily: [100, 100] } }, failed24h: 0, total24h: 3 });
		expect(sparse).toEqual([]);
	});

	it('uses a payout-count floor when the trailing median is zero', () => {
		const few = evaluatePayouts({ perMint: { USDC: { last24h: 5000, last24hCount: 10, trailingDaily: [] } }, failed24h: 0, total24h: 10 });
		expect(few).toEqual([]);
		const many = evaluatePayouts({ perMint: { USDC: { last24h: 5000, last24hCount: 30, trailingDaily: [] } }, failed24h: 0, total24h: 30 });
		expect(many[0].kind).toBe('volume');
	});

	it('flags a failure rate above 20 percent only with enough samples', () => {
		expect(evaluatePayouts({ perMint: {}, failed24h: 3, total24h: 10 })[0].kind).toBe('failure');
		expect(evaluatePayouts({ perMint: {}, failed24h: 2, total24h: 10 })).toEqual([]);
		expect(evaluatePayouts({ perMint: {}, failed24h: 3, total24h: 4 })).toEqual([]);
	});
});

describe('POST /api/admin-payouts-pause', () => {
	function call(method, body) {
		const buf = Buffer.from(JSON.stringify(body || {}));
		const req = {
			method,
			url: '/api/admin-payouts-pause',
			headers: { 'content-type': 'application/json' },
			on(event, cb) {
				if (event === 'data') queueMicrotask(() => { cb(buf); this._end?.(); });
				else if (event === 'end') this._end = cb;
			},
			destroy() {},
		};
		const res = {
			statusCode: 200,
			headers: {},
			body: '',
			writableEnded: false,
			setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
			end(b) { this.body = b ?? ''; this.writableEnded = true; },
		};
		return adminPause(req, res).then(() => ({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }));
	}

	beforeEach(() => {
		adminState.user = { id: 'admin-1' };
	});

	it('rejects a non-admin', async () => {
		adminState.user = null;
		expect((await call('POST', { paused: true, reason: 'x' })).status).toBe(403);
		expect(state.flag).toBeNull();
	});

	it('requires a boolean and a reason to pause', async () => {
		expect((await call('POST', { paused: 'yes' })).status).toBe(400);
		expect((await call('POST', { paused: true })).status).toBe(400);
		expect(state.flag).toBeNull();
	});

	it('pauses with a reason, reports it on GET, and the next cron answers paused', async () => {
		const set = await call('POST', { paused: true, reason: 'fee wallet drain' });
		expect(set.status).toBe(200);
		expect(set.body).toMatchObject({ paused: true, reason: 'fee wallet drain', audited: true });
		const got = await call('GET');
		expect(got.body).toMatchObject({ paused: true, reason: 'fee wallet drain', source: 'flag' });
		expect((await run('process-withdrawals')).body.paused).toBe(true);
		const resumed = await call('POST', { paused: false });
		expect(resumed.body.paused).toBe(false);
	});
});
