// Whole-agent marketplace settlement (api/_lib/agent-market/*).
//
// The acceptance bar for custody rotation is "kill it mid-way and it resumes to
// completion". These tests drive the real runTransfer state machine against an
// in-memory store with the same compare-and-set semantics as the database
// store, kill it at every step in turn, and prove a resume finishes the
// transfer with each step's effect applied exactly once. They also pin the
// exactly-once leg reconciliation (a resumed payout can never pay twice), the
// amount math, the escrow derivation guard, and the MCP financial gate.

import { describe, it, expect, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn(), logAuditNow: vi.fn() }));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));
vi.mock('../api/_lib/rate-limit.js', () => {
	const allow = async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 });
	return { limits: new Proxy({}, { get: () => allow }), clientIp: () => '127.0.0.1' };
});

const { STEPS, nextStep, runTransfer, transferView } = await import('../api/_lib/agent-market/settlement.js');
const chain = await import('../api/_lib/agent-market/chain.js');

// ── In-memory store with the database store's semantics ──────────────────────

function memoryStore(initial) {
	const rows = new Map([[initial.id, { ...initial }]]);
	let now = 0;
	return {
		rows,
		tick(ms = 1) { now += ms; },
		async lease(id) {
			const r = rows.get(id);
			if (!r || r.status === 'completed') return null;
			if (r.locked_until != null && r.locked_until > now) return null;
			Object.assign(r, { locked_until: now + 600_000, attempts: r.attempts + 1, status: 'in_progress' });
			return { ...r };
		},
		async load(id) { return rows.has(id) ? { ...rows.get(id) } : null; },
		async advance(id, from, to) {
			const r = rows.get(id);
			if (r.step !== from) throw new Error(`transfer ${id} left step ${from} under another worker`);
			Object.assign(r, {
				step: to, last_error: null, locked_until: now + 600_000,
				status: to === 'done' ? 'completed' : r.status,
			});
			return { ...r };
		},
		async fail(id, step, message) {
			Object.assign(rows.get(id), { status: 'failed', last_error: `${step}: ${message}`, locked_until: null });
		},
		async release(id) { rows.get(id).locked_until = null; },
	};
}

function newTransfer() {
	return {
		id: 't1', listing_id: 'l1', bid_id: 'b1', agent_id: 'a1', buyer_user_id: 'buyer', seller_user_id: 'seller',
		currency: 'USDC', amount_atomics: '5000000', fee_atomics: '125000', seller_net_atomics: '4875000',
		step: 'pay_seller', status: 'in_progress', attempts: 0, locked_until: null, last_error: null,
		rotation: {}, legs: {}, updated_at: new Date().toISOString(),
	};
}

// Steps that record their EFFECT idempotently, the way the real steps check
// on-chain and database state before acting. `killAt` makes a step die after
// its effect landed but before the runner could advance (the worst case for a
// resume), or before the effect when `killBeforeEffect` is set.
function recordingSteps({ killAt = null, killBeforeEffect = false } = {}) {
	const effects = new Map();
	const calls = [];
	let killed = false;
	const steps = {};
	for (const step of STEPS) {
		steps[step] = async () => {
			calls.push(step);
			const die = !killed && step === killAt;
			if (die && killBeforeEffect) {
				killed = true;
				throw Object.assign(new Error(`process killed before ${step}`), { code: 'killed' });
			}
			if (!effects.has(step)) effects.set(step, 1);
			if (die) {
				killed = true;
				throw Object.assign(new Error(`process killed during ${step}`), { code: 'killed' });
			}
		};
	}
	return { steps, effects, calls };
}

const context = async (transfer) => ({ transfer, listing: { id: 'l1' }, agent: { id: 'a1' } });

describe('settlement state machine', () => {
	it('walks every step in order to done', async () => {
		const store = memoryStore(newTransfer());
		const { steps, calls } = recordingSteps();
		const run = await runTransfer('t1', { store, steps, context, log: false });
		expect(run.error).toBeUndefined();
		expect(run.transfer.step).toBe('done');
		expect(run.transfer.status).toBe('completed');
		expect(calls).toEqual(STEPS);
	});

	it.each(STEPS)('killed during %s, resumes to completion with every effect applied once', async (killAt) => {
		const store = memoryStore(newTransfer());
		const { steps, effects } = recordingSteps({ killAt });

		const first = await runTransfer('t1', { store, steps, context, log: false });
		expect(first.error).toMatchObject({ step: killAt, code: 'killed' });
		expect(first.transfer.status).toBe('failed');
		expect(first.transfer.step).toBe(killAt);
		expect(first.transfer.locked_until).toBeNull();

		const resumed = await runTransfer('t1', { store, steps, context, log: false });
		expect(resumed.error).toBeUndefined();
		expect(resumed.transfer.status).toBe('completed');
		for (const step of STEPS) expect(effects.get(step)).toBe(1);
	});

	it.each(STEPS)('killed before %s ran, resumes and runs it', async (killAt) => {
		const store = memoryStore(newTransfer());
		const { steps, effects } = recordingSteps({ killAt, killBeforeEffect: true });
		await runTransfer('t1', { store, steps, context, log: false });
		const resumed = await runTransfer('t1', { store, steps, context, log: false });
		expect(resumed.transfer.status).toBe('completed');
		for (const step of STEPS) expect(effects.get(step)).toBe(1);
	});

	it('a live lease keeps a second worker out, an expired one lets it resume', async () => {
		const store = memoryStore(newTransfer());
		await store.lease('t1'); // a worker died holding the lease
		const { steps } = recordingSteps();
		const blocked = await runTransfer('t1', { store, steps, context, log: false });
		expect(blocked.busy).toBe(true);
		store.tick(600_001);
		const resumed = await runTransfer('t1', { store, steps, context, log: false });
		expect(resumed.transfer.status).toBe('completed');
	});

	it('pauses at the deadline and releases the lease for the cron', async () => {
		const store = memoryStore(newTransfer());
		const { steps } = recordingSteps();
		const paused = await runTransfer('t1', { store, steps, context, deadlineMs: -1, log: false });
		expect(paused.paused).toBe(true);
		expect(store.rows.get('t1').locked_until).toBeNull();
		expect(store.rows.get('t1').step).toBe('pay_seller');
	});

	it('a completed transfer is never re-run', async () => {
		const store = memoryStore({ ...newTransfer(), step: 'done', status: 'completed' });
		const { steps, calls } = recordingSteps();
		const run = await runTransfer('t1', { store, steps, context, log: false });
		expect(calls).toEqual([]);
		expect(run.busy).toBe(false);
	});

	it('nextStep ends at done and rejects unknown steps', () => {
		expect(nextStep('pay_seller')).toBe('pay_fee');
		expect(nextStep('finalize')).toBe('done');
		expect(() => nextStep('nope')).toThrow();
	});

	it('transferView marks steps done, running and failed, and hides errors from strangers', () => {
		const t = { ...newTransfer(), step: 'sweep_wallet', status: 'failed', last_error: 'sweep_wallet: rpc down' };
		const v = transferView(t, { viewerId: 'buyer' });
		expect(v.viewer_role).toBe('buyer');
		expect(v.can_resume).toBe(true);
		expect(v.steps.slice(0, 3).every((s) => s.state === 'done')).toBe(true);
		expect(v.steps[3]).toMatchObject({ id: 'sweep_wallet', state: 'failed' });
		expect(v.steps.at(-1).state).toBe('pending');
		expect(v.seller_net.amount).toBe('4.875');
		expect(transferView(t, { viewerId: 'stranger' }).last_error).toBeUndefined();
	});
});

// ── Exactly-once legs ─────────────────────────────────────────────────────────

function fakeConnection({ status = null, height = 100, landedByReference = null } = {}) {
	return {
		sent: 0,
		async getSignatureStatuses() { return { value: [status] }; },
		async getBlockHeight() { return height; },
		async getSignaturesForAddress() { return landedByReference ? [{ signature: landedByReference, err: null }] : []; },
		async sendRawTransaction() { this.sent++; return 'sig'; },
	};
}

describe('exactly-once legs', () => {
	it('a landed prior attempt is replayed, not resent', async () => {
		const conn = fakeConnection({ status: { err: null, confirmationStatus: 'confirmed' } });
		const r = await chain.sendLeg({
			connection: conn, legId: 'payout:t1', prior: { signature: 'prior', lastValidBlockHeight: 200 },
			signers: [], build: () => [], onPrepared: async () => { throw new Error('must not prepare'); },
		});
		expect(r).toEqual({ signature: 'prior', replayed: true });
		expect(conn.sent).toBe(0);
	});

	it('an unknown prior attempt whose blockhash is still valid refuses to resend', async () => {
		const conn = fakeConnection({ status: null, height: 150 });
		await expect(chain.sendLeg({
			connection: conn, legId: 'payout:t1', prior: { signature: 'prior', lastValidBlockHeight: 200 },
			signers: [], build: () => [], onPrepared: async () => {},
		})).rejects.toMatchObject({ code: 'leg_in_flight' });
		expect(conn.sent).toBe(0);
	});

	it('reconcileLeg classifies landed, failed, in flight and expired', async () => {
		const prior = { signature: 's', lastValidBlockHeight: 200 };
		expect(await chain.reconcileLeg(fakeConnection({ status: { err: null, confirmationStatus: 'finalized' } }), prior)).toBe('landed');
		expect(await chain.reconcileLeg(fakeConnection({ status: { err: { InstructionError: [0, 'x'] } } }), prior)).toBe('failed');
		expect(await chain.reconcileLeg(fakeConnection({ status: { err: null, confirmationStatus: 'processed' } }), prior)).toBe('in_flight');
		expect(await chain.reconcileLeg(fakeConnection({ status: null, height: 150 }), prior)).toBe('in_flight');
		expect(await chain.reconcileLeg(fakeConnection({ status: null, height: 201 }), prior)).toBe('expired');
		expect(await chain.reconcileLeg(fakeConnection(), null)).toBe('expired');
	});

	it('a leg whose record was lost is still found by its reference key', async () => {
		const conn = fakeConnection({ landedByReference: 'found-by-ref' });
		const r = await chain.sendLeg({
			connection: conn, legId: 'refund:b1', prior: null, signers: [], build: () => [],
			onPrepared: async () => { throw new Error('must not prepare'); },
		});
		expect(r).toEqual({ signature: 'found-by-ref', replayed: true });
	});

	it('leg references are deterministic per leg and distinct across legs', () => {
		expect(chain.legReference('payout:t1').toBase58()).toBe(chain.legReference('payout:t1').toBase58());
		expect(chain.legReference('payout:t1').toBase58()).not.toBe(chain.legReference('fee:t1').toBase58());
	});
});

// ── Amounts and escrow derivation ─────────────────────────────────────────────

describe('amounts and escrow', () => {
	it('parses decimal amounts without float error and rejects junk', () => {
		expect(chain.parseAmount('25', 6)).toBe(25_000_000n);
		expect(chain.parseAmount('0.1', 6)).toBe(100_000n);
		expect(chain.parseAmount(12.5, 6)).toBe(12_500_000n);
		expect(() => chain.parseAmount('0', 6)).toThrow();
		expect(() => chain.parseAmount('-1', 6)).toThrow();
		expect(() => chain.parseAmount('1.0000001', 6)).toThrow();
		expect(() => chain.parseAmount('1e3', 6)).toThrow();
	});

	it('formats atomics exactly', () => {
		expect(chain.formatAtomics('4875000', 6)).toBe('4.875');
		expect(chain.formatAtomics(1_000_000n, 6)).toBe('1');
		expect(chain.formatAtomics('1', 6)).toBe('0.000001');
	});

	it('derives a stable escrow per listing and refuses to sign on a mismatch', async () => {
		const prev = process.env.AGENT_MARKET_ESCROW_SECRET;
		process.env.AGENT_MARKET_ESCROW_SECRET = 'test-escrow-secret-for-derivation';
		try {
			const a = chain.escrowAddressFor('listing-a');
			expect(chain.escrowAddressFor('listing-a')).toBe(a);
			expect(chain.escrowAddressFor('listing-b')).not.toBe(a);
			const signed = await chain.withEscrowKeypair({ id: 'listing-a', escrow_address: a }, (kp) => kp.publicKey.toBase58());
			expect(signed).toBe(a);
			const other = Keypair.generate().publicKey.toBase58();
			await expect(chain.withEscrowKeypair({ id: 'listing-a', escrow_address: other }, () => 'signed'))
				.rejects.toMatchObject({ code: 'escrow_key_mismatch' });
		} finally {
			if (prev === undefined) delete process.env.AGENT_MARKET_ESCROW_SECRET;
			else process.env.AGENT_MARKET_ESCROW_SECRET = prev;
		}
	});
});

// ── MCP financial gate ────────────────────────────────────────────────────────

describe('marketplace MCP tools', () => {
	const load = () => import('../api/_mcpagent/marketplace-tools.js');

	it('every financial tool names its confirm flag and the preview tool', async () => {
		const { marketplaceToolDefs } = await load();
		const financial = marketplaceToolDefs.filter((t) => t.tier === 'financial');
		expect(financial.map((t) => t.name).sort()).toEqual([
			'accept_marketplace_bid', 'buy_now', 'create_marketplace_listing',
			'delist_marketplace_listing', 'place_bid', 'withdraw_marketplace_bid',
		]);
		for (const t of financial) {
			expect(t.confirmFlag).toMatch(/^confirm_/);
			expect(t.previewTool).toBe('preview_marketplace_action');
			expect(t.inputSchema.properties[t.confirmFlag]).toBeTruthy();
			expect(t.inputSchema.properties.preview_id).toBeTruthy();
		}
		for (const t of marketplaceToolDefs) {
			expect(t.group).toBe('marketplace');
			expect(['read', 'write', 'financial']).toContain(t.tier);
		}
	});

	it('refuses a financial call without its confirm flag, naming the preview tool', async () => {
		const { marketplaceToolDefs } = await load();
		const accept = marketplaceToolDefs.find((t) => t.name === 'accept_marketplace_bid');
		const auth = { userId: '00000000-0000-4000-8000-000000000001', scope: 'agents:write wallet:write', rateKey: 'test' };
		const res = await accept.handler({ bid_id: '00000000-0000-4000-8000-000000000002' }, auth);
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({
			reason: 'confirmation_required', preview_tool: 'preview_marketplace_action', confirm_flag: 'confirm_accept',
		});
	});

	it('refuses a confirmed call with no preview id', async () => {
		const { marketplaceToolDefs } = await load();
		const bid = marketplaceToolDefs.find((t) => t.name === 'place_bid');
		const auth = { userId: '00000000-0000-4000-8000-000000000001', scope: 'wallet:write', rateKey: 'test' };
		const res = await bid.handler({
			listing_id: '00000000-0000-4000-8000-000000000003', amount_usdc: '5', funding_source: 'agent_wallet', confirm_bid: true,
		}, auth);
		expect(res.isError).toBe(true);
		expect(res.structuredContent.reason).toBe('preview_required');
		expect(res.content[0].text).toContain('preview_marketplace_action');
	});

	it('refuses a signed-out caller before anything else', async () => {
		const { marketplaceToolDefs } = await load();
		const bid = marketplaceToolDefs.find((t) => t.name === 'place_bid');
		const res = await bid.handler({ listing_id: '00000000-0000-4000-8000-000000000003', amount_usdc: '5', funding_source: 'agent_wallet' }, { rateKey: 'anon' });
		expect(res.structuredContent.reason).toBe('auth_required');
	});
});
