// Withdrawal payout idempotency (api/cron/[name].js handleProcessWithdrawals).
//
// The payout cron claims a row, broadcasts a USDC transfer, and used to mark the
// row `failed` on ANY exception. A failure after the signed transaction reached
// the network (confirmation timeout, RPC error after send) therefore recorded
// `failed` while funds may already have moved, and because the balance checks
// only counted pending|processing|completed, the balance was freed and the user
// could withdraw the same money again.
//
// Proven here, end to end through the real cron handler:
//   (a) a send that throws after the signature is known leaves the row in a state
//       that still reserves the balance (`broadcast_unconfirmed`), never `failed`
//   (b) the same row processed twice issues exactly one transfer
//   (c) a row with a persisted signature that is confirmed on chain is reconciled
//       to `completed` without a second transfer
//   (d) a row whose signature provably cannot land becomes `failed` and only
//       then releases the balance
//
// The database is an in-memory table that honours the claim predicates (WHERE
// status = ...), and the only things stubbed are the web3 boundaries: the
// on-chain transfer and the chain-status lookup.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SIG1 = '5'.repeat(88);

// ── in-memory agent_withdrawals ─────────────────────────────────────────────
const db = { rows: [], statements: [] };

vi.mock('../api/_lib/db.js', () => ({
	isDbUnavailableError: vi.fn(() => false),
	sql: vi.fn(async (strings, ...values) => {
		const text = strings.join('?').replace(/\s+/g, ' ').toLowerCase();
		db.statements.push(text);
		const byId = (id) => db.rows.find((r) => r.id === id);

		if (text.includes("w.status = 'pending'")) {
			return db.rows
				.filter((r) => r.status === 'pending')
				.map((r) => ({ ...r, available: 1_000_000_000_000 }));
		}
		if (text.includes("set status = 'processing'")) {
			const row = byId(values[0]);
			if (!row || row.status !== 'pending') return [];
			row.status = 'processing';
			return [{ id: row.id }];
		}
		if (text.includes('set send_signature')) {
			const [signature, attempt, lastValid, nonce, id] = values;
			const row = byId(id);
			if (!row || row.status !== 'processing') return [];
			row.send_signature = signature;
			row.send_attempts = [...(row.send_attempts || []), JSON.parse(attempt)];
			row.last_valid_block_height = Math.max(row.last_valid_block_height || 0, lastValid || 0);
			row.send_nonce = nonce ?? row.send_nonce ?? null;
			return [{ id: row.id }];
		}
		if (text.includes("set status = 'completed'")) {
			const [sig, id] = values;
			const row = byId(id);
			if (!row || !['processing', 'broadcast_unconfirmed'].includes(row.status)) return [];
			row.status = 'completed';
			row.tx_signature = sig;
			return [{ id: row.id }];
		}
		if (text.includes("set status = 'broadcast_unconfirmed'")) {
			const [msg, id] = values;
			const row = byId(id);
			if (!row || row.status !== 'processing') return [];
			row.status = 'broadcast_unconfirmed';
			row.error_message = msg;
			return [{ id: row.id }];
		}
		if (text.includes("set status = 'failed'")) {
			const id = values[values.length - 1];
			const row = byId(id);
			if (!row || !['pending', 'processing', 'broadcast_unconfirmed'].includes(row.status)) return [];
			row.status = 'failed';
			row.error_message = values.length > 1 ? values[0] : row.error_message;
			return [{ id: row.id }];
		}
		if (text.includes('select') && text.includes('send_attempts') && text.includes('from agent_withdrawals')) {
			return db.rows
				.filter((r) => r.status === 'broadcast_unconfirmed' || (r.status === 'processing' && r.send_signature))
				.map((r) => ({ ...r }));
		}
		return [];
	}),
}));

vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: vi.fn(() => true) }));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn(async () => undefined) }));
vi.mock('../api/_lib/alerts.js', () => ({
	sendOpsAlert: vi.fn(async () => undefined),
	alertsConfigured: vi.fn(() => false),
	severityOf: vi.fn(() => 'warn'),
}));

// web3 boundary 1: the on-chain transfer.
const transfer = { impl: null };
vi.mock('../api/_lib/solana-transfer.js', () => ({
	transferSolanaUSDC: vi.fn((opts) => transfer.impl(opts)),
}));
vi.mock('../api/_lib/evm-transfer.js', () => ({
	sendEvmUsdc: vi.fn(async () => {
		throw new Error('EVM not used in this suite');
	}),
	resolveEvmChainId: vi.fn(() => null),
}));

// web3 boundary 2: the chain-status lookup the reconciler uses.
const chain = { result: { state: 'pending' } };
vi.mock('../api/_lib/withdrawal-chain-status.js', () => ({
	checkSendStatus: vi.fn(async () => chain.result),
}));

process.env.TREASURY_KEYPAIR = 'synthetic-treasury-key';
process.env.CRON_SECRET = 'test-cron';

const { default: handler } = await import('../api/cron/[name].js');
const { transferSolanaUSDC } = await import('../api/_lib/solana-transfer.js');
const { sendOpsAlert } = await import('../api/_lib/alerts.js');

function runCron() {
	const req = {
		method: 'POST',
		url: '/api/cron/process-withdrawals?name=process-withdrawals',
		query: { name: 'process-withdrawals' },
		headers: {},
	};
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
	return handler(req, res).then(() => ({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }));
}

function pendingRow(overrides = {}) {
	return {
		id: 'w-1',
		user_id: 'user-1',
		agent_id: 'agent-1',
		amount: 5_000_000,
		currency_mint: SOL_USDC,
		chain: 'solana',
		to_address: 'THREEsynthetic1111111111111111111111111111111',
		status: 'pending',
		tx_signature: null,
		error_message: null,
		send_signature: null,
		send_attempts: [],
		last_valid_block_height: null,
		send_nonce: null,
		updated_at: new Date().toISOString(),
		created_at: new Date().toISOString(),
		...overrides,
	};
}

// Mirrors the reserved-balance predicate both withdrawal endpoints use.
async function reservedStatuses() {
	const { RESERVED_WITHDRAWAL_STATUSES } = await import('../api/_lib/withdrawal-status.js');
	return RESERVED_WITHDRAWAL_STATUSES;
}

beforeEach(() => {
	db.rows = [];
	db.statements = [];
	chain.result = { state: 'pending' };
	transfer.impl = async () => SIG1;
	transferSolanaUSDC.mockClear();
	sendOpsAlert.mockClear();
});

describe('withdrawal payout idempotency', () => {
	it('(a) a send that throws after the signature is known keeps the balance reserved', async () => {
		db.rows = [pendingRow()];
		transfer.impl = async (opts) => {
			// The signature exists and was handed to the persistence hook BEFORE broadcast.
			await opts.onSigned?.({ signature: SIG1, lastValidBlockHeight: 500 });
			throw new Error('confirm timeout');
		};

		await runCron();

		const row = db.rows[0];
		expect(row.status).not.toBe('failed');
		expect(row.status).toBe('broadcast_unconfirmed');
		expect(row.send_signature).toBe(SIG1);
		expect(await reservedStatuses()).toContain(row.status);
	});

	it('(a) a failure before anything was signed is safe to fail and releases the balance', async () => {
		db.rows = [pendingRow()];
		transfer.impl = async () => {
			throw new Error('treasury has no USDC account');
		};

		await runCron();

		expect(db.rows[0].status).toBe('failed');
		expect(db.rows[0].send_signature).toBeNull();
		expect(await reservedStatuses()).not.toContain('failed');
	});

	it('(a) a signature that cannot be persisted aborts the send instead of broadcasting blind', async () => {
		db.rows = [pendingRow()];
		let broadcast = false;
		transfer.impl = async (opts) => {
			// The row leaves 'processing' underneath the sender (e.g. an operator action).
			db.rows[0].status = 'failed';
			await opts.onSigned?.({ signature: SIG1, lastValidBlockHeight: 500 });
			broadcast = true;
			return SIG1;
		};

		await runCron();

		expect(broadcast).toBe(false);
	});

	it('(b) the same row processed twice issues exactly one transfer', async () => {
		db.rows = [pendingRow()];
		transfer.impl = async (opts) => {
			await opts.onSigned?.({ signature: SIG1, lastValidBlockHeight: 500 });
			return SIG1;
		};

		await Promise.all([runCron(), runCron()]);
		await runCron();

		expect(transferSolanaUSDC).toHaveBeenCalledTimes(1);
		expect(db.rows[0].status).toBe('completed');
		expect(db.rows[0].tx_signature).toBe(SIG1);
	});

	it('(c) a broadcast_unconfirmed row confirmed on chain is reconciled to completed with no second transfer', async () => {
		db.rows = [
			pendingRow({
				status: 'broadcast_unconfirmed',
				send_signature: SIG1,
				send_attempts: [{ signature: SIG1, lastValidBlockHeight: 500 }],
				last_valid_block_height: 500,
			}),
		];
		chain.result = { state: 'confirmed', signature: SIG1 };

		await runCron();

		expect(db.rows[0].status).toBe('completed');
		expect(db.rows[0].tx_signature).toBe(SIG1);
		expect(transferSolanaUSDC).not.toHaveBeenCalled();
	});

	it('(d) a signature proven absent after blockhash expiry becomes failed and releases the balance', async () => {
		db.rows = [
			pendingRow({
				status: 'broadcast_unconfirmed',
				send_signature: SIG1,
				send_attempts: [{ signature: SIG1, lastValidBlockHeight: 500 }],
				last_valid_block_height: 500,
			}),
		];
		chain.result = { state: 'expired' };

		await runCron();

		expect(db.rows[0].status).toBe('failed');
		expect(db.rows[0].error_message).toMatch(/expired|never landed/i);
		expect(await reservedStatuses()).not.toContain(db.rows[0].status);
		expect(transferSolanaUSDC).not.toHaveBeenCalled();
	});

	it('(d) a row the chain cannot yet decide stays reserved for the next tick', async () => {
		db.rows = [
			pendingRow({
				status: 'broadcast_unconfirmed',
				send_signature: SIG1,
				send_attempts: [{ signature: SIG1, lastValidBlockHeight: 500 }],
				last_valid_block_height: 500,
			}),
		];
		chain.result = { state: 'pending' };

		await runCron();

		expect(db.rows[0].status).toBe('broadcast_unconfirmed');
	});

	it('pages an operator when a row stays broadcast_unconfirmed longer than 30 minutes', async () => {
		db.rows = [
			pendingRow({
				status: 'broadcast_unconfirmed',
				send_signature: SIG1,
				send_attempts: [{ signature: SIG1, lastValidBlockHeight: 500 }],
				updated_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
			}),
		];
		chain.result = { state: 'pending' };

		await runCron();

		expect(sendOpsAlert).toHaveBeenCalledWith(
			expect.stringMatching(/broadcast_unconfirmed/),
			expect.stringContaining('w-1'),
			expect.objectContaining({ signature: 'withdrawals-broadcast-unconfirmed' }),
		);
	});
});

describe('shared reserved-status helper', () => {
	it('pins the statuses that hold a balance', async () => {
		const { RESERVED_WITHDRAWAL_STATUSES } = await import('../api/_lib/withdrawal-status.js');
		expect([...RESERVED_WITHDRAWAL_STATUSES].sort()).toEqual(
			['broadcast_unconfirmed', 'completed', 'pending', 'processing'].sort(),
		);
	});

	it.each([
		'api/monetization/withdrawals.js',
		'api/billing/withdrawals/index.js',
		'api/_lib/monetization.js',
	])('%s counts broadcast_unconfirmed through the shared helper', (file) => {
		const src = readFileSync(resolve(__dirname, '..', file), 'utf8');
		expect(src).toMatch(/withdrawal-status\.js/);
		expect(src).not.toMatch(/in \('pending', 'processing', 'completed'\)/i);
	});
});
