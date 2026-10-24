// Creator-fee payouts: the held reasons, the signed payout-wallet message and its
// replay guard, the cron reading, the per-$100 flow and the CSV export.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';

const state = { nonces: new Set(), wallet: null, grants: 0, agentOwner: 'user-1' };

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...vals) => {
		const q = strings.join('?');
		if (q.includes('FROM agent_identities')) return [{ id: vals[0], user_id: state.agentOwner, name: 'Test agent' }];
		if (q.includes('INSERT INTO creator_payout_nonces')) {
			if (state.nonces.has(vals[0])) return [];
			state.nonces.add(vals[0]);
			return [{ nonce: vals[0] }];
		}
		if (q.includes('UPDATE creator_payout_wallets') && q.includes('RETURNING agent_id, user_id, wallet')) return [];
		if (q.includes('SELECT * FROM creator_payout_wallets')) {
			return state.wallet ? [{ agent_id: vals[0], wallet: state.wallet, registered_at: new Date().toISOString(), pending_wallet: null }] : [];
		}
		if (q.includes('INSERT INTO creator_payout_wallets')) {
			state.wallet = vals[2];
			return [];
		}
		return [];
	}),
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn() }));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn(async () => ({ id: 'n' })) }));
vi.mock('../api/_lib/destination-whitelist.js', async (orig) => {
	const real = await orig();
	return { ...real, consumeGrant: vi.fn(async () => { state.grants += 1; return 'wallet'; }) };
});

const core = await import('../api/_lib/creator-payouts-core.js');
const lib = await import('../api/_lib/creator-payouts.js');

const AGENT = '11111111-2222-4333-8444-555555555555';
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

function newWallet() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
	return { address: bs58.encode(raw), signMessage: (m) => bs58.encode(sign(null, Buffer.from(m), privateKey)) };
}

const H = (over) => ({
	activeWallet: 'W', pendingWallet: null, pendingEffectiveAt: null, unsentLamports: 50_000_000n, live: true, now: NOW, ...over,
});

describe('holdReason', () => {
	it('is null when a registered wallet, enough volume and live distribution line up', () => {
		expect(core.holdReason(H())).toBeNull();
	});
	it('holds an unregistered agent until a wallet is signed', () => {
		expect(core.holdReason(H({ activeWallet: null }))).toBe('wallet_not_registered');
	});
	it('holds during the cooldown of a changed wallet, even though the old one is active', () => {
		const later = new Date(NOW + 3_600_000).toISOString();
		expect(core.holdReason(H({ pendingWallet: 'N', pendingEffectiveAt: later }))).toBe('cooldown');
	});
	it('releases once the cooldown has ended', () => {
		const past = new Date(NOW - 1000).toISOString();
		expect(core.holdReason(H({ pendingWallet: 'N', pendingEffectiveAt: past }))).toBeNull();
	});
	it('holds shares under the minimum until they add up', () => {
		expect(core.holdReason(H({ unsentLamports: BigInt(core.MIN_PAYOUT_LAMPORTS - 1) }))).toBe('below_minimum');
		expect(core.holdReason(H({ unsentLamports: BigInt(core.MIN_PAYOUT_LAMPORTS) }))).toBeNull();
	});
	it('says so when distribution is switched off', () => {
		expect(core.holdReason(H({ live: false }))).toBe('payouts_paused');
	});
	it('puts the owner-actionable reason first', () => {
		expect(core.holdReason(H({ activeWallet: null, unsentLamports: 1n, live: false }))).toBe('wallet_not_registered');
	});
	it('gives every reason a label and a fix', () => {
		for (const r of Object.values(core.HOLD_REASONS)) {
			expect(r.label.length).toBeGreaterThan(5);
			expect(r.fix.length).toBeGreaterThan(20);
		}
	});
});

describe('registration message', () => {
	const base = { agentId: AGENT, wallet: 'W'.repeat(44), nonce: 'a'.repeat(32), issuedAt: new Date(NOW).toISOString() };
	it('round-trips', () => {
		const msg = core.buildRegistrationMessage(base);
		expect(core.checkRegistrationMessage(msg, { agentId: AGENT, wallet: base.wallet, now: NOW })).toMatchObject({ ok: true, nonce: base.nonce });
	});
	it('refuses a message for another agent or wallet', () => {
		const msg = core.buildRegistrationMessage(base);
		expect(core.checkRegistrationMessage(msg, { agentId: '99999999-2222-4333-8444-555555555555', wallet: base.wallet, now: NOW }).code).toBe('wrong_agent');
		expect(core.checkRegistrationMessage(msg, { agentId: AGENT, wallet: 'X'.repeat(44), now: NOW }).code).toBe('wrong_wallet');
	});
	it('refuses a stale or future timestamp', () => {
		const msg = core.buildRegistrationMessage(base);
		expect(core.checkRegistrationMessage(msg, { agentId: AGENT, wallet: base.wallet, now: NOW + core.MESSAGE_MAX_AGE_MS + 1 }).code).toBe('message_expired');
		expect(core.checkRegistrationMessage(msg, { agentId: AGENT, wallet: base.wallet, now: NOW - core.MESSAGE_MAX_FUTURE_MS - 1 }).code).toBe('invalid_timestamp');
	});
	it('refuses free text', () => {
		expect(core.checkRegistrationMessage('hello', { agentId: AGENT, wallet: 'W', now: NOW }).code).toBe('invalid_message');
	});
});

describe('registerPayoutWallet', () => {
	const actor = { kind: 'owner', userId: 'user-1', sessionId: 'sess-1' };
	beforeEach(() => {
		state.nonces.clear();
		state.wallet = null;
		state.grants = 0;
	});

	async function signedFor(w, over = {}) {
		const nonce = over.nonce || 'b'.repeat(32);
		const message = core.buildRegistrationMessage({ agentId: AGENT, wallet: w.address, nonce, issuedAt: new Date(NOW).toISOString() });
		return { message, signature: w.signMessage(message) };
	}

	it('registers the first wallet at once and spends one grant', async () => {
		const w = newWallet();
		const { message, signature } = await signedFor(w);
		const out = await lib.registerPayoutWallet({ actor, agentId: AGENT, wallet: w.address, message, signature, grantId: 'g', now: NOW });
		expect(out.outcome).toBe('registered');
		expect(state.grants).toBe(1);
	});

	it('refuses a replay of the same signed message and does not spend a second grant', async () => {
		const w = newWallet();
		const { message, signature } = await signedFor(w);
		await lib.registerPayoutWallet({ actor, agentId: AGENT, wallet: w.address, message, signature, grantId: 'g', now: NOW });
		await expect(lib.registerPayoutWallet({ actor, agentId: AGENT, wallet: w.address, message, signature, grantId: 'g2', now: NOW + 1000 }))
			.rejects.toMatchObject({ code: 'nonce_used', status: 409 });
		expect(state.grants).toBe(1);
	});

	it('refuses a signature from a different key', async () => {
		const w = newWallet();
		const other = newWallet();
		const { message } = await signedFor(w);
		await expect(lib.registerPayoutWallet({ actor, agentId: AGENT, wallet: w.address, message, signature: other.signMessage(message), grantId: 'g', now: NOW }))
			.rejects.toMatchObject({ code: 'bad_signature' });
		expect(state.nonces.size).toBe(0);
	});

	it('refuses a bearer or API key, which has no browser session', async () => {
		const w = newWallet();
		const { message, signature } = await signedFor(w);
		await expect(lib.registerPayoutWallet({ actor: { kind: 'api_key', userId: 'user-1', sessionId: null }, agentId: AGENT, wallet: w.address, message, signature, grantId: 'g', now: NOW }))
			.rejects.toMatchObject({ code: 'session_required' });
	});

	it('refuses someone who does not own the agent', async () => {
		const w = newWallet();
		const { message, signature } = await signedFor(w);
		await expect(lib.registerPayoutWallet({ actor: { ...actor, userId: 'intruder' }, agentId: AGENT, wallet: w.address, message, signature, grantId: 'g', now: NOW }))
			.rejects.toMatchObject({ code: 'forbidden' });
	});
});

describe('flow, schedule and csv', () => {
	it('builds the per-$100 flow from the split policy and it sums to the amount', () => {
		const f = core.flowPer100();
		expect(f.legs.reduce((s, l) => s + l.usd, 0)).toBeCloseTo(100, 6);
		expect(f.total_bps).toBe(10_000);
		expect(f.legs.map((l) => l.role)).toEqual(['seller', 'treasury']);
	});

	it('reads the cadence of every stage from the real vercel.json crons', () => {
		const crons = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons;
		const sched = core.payoutSchedule(crons);
		expect(sched.map((s) => s.key)).toEqual(['snapshot', 'claim', 'distribute', 'reconcile']);
		for (const s of sched) expect(s.schedule, s.path).toBeTruthy();
		expect(sched.find((s) => s.key === 'claim').cadence).toBe('every 5 minutes');
	});

	it('does not claim more than an unfamiliar cron says', () => {
		expect(core.describeCron('0 6 * * 1')).toBe('cron 0 6 * * 1 (UTC)');
		expect(core.describeCron('20 * * * *')).toBe('every hour at :20');
		expect(core.describeCron('0 * * * *')).toBe('every hour, on the hour');
		expect(core.describeCron('50 */3 * * *')).toBe('every 3 hours at :50');
		expect(core.describeCron('11,41 * * * *')).toBe('twice an hour, at :11 and :41');
	});

	it('shares are claim minus the buyback earmark', () => {
		expect(core.creatorShareLamports(100_000_000, 0.05)).toBe(50_000_000n);
		expect(core.creatorShareLamports(100_000_000, 0.2)).toBe(0n);
	});

	it('summarises sent, pending and held with per-reason held amounts', () => {
		const t = core.summarizeDistributions([
			{ status: 'sent', creator_lamports: '5' },
			{ status: 'pending', creator_lamports: '2' },
			{ status: 'sending', creator_lamports: '1' },
			{ status: 'held', creator_lamports: '7', hold_reason: 'cooldown' },
			{ status: 'held', creator_lamports: '3', hold_reason: 'cooldown' },
		]);
		expect(t.sent).toBe(5n);
		expect(t.pending).toBe(3n);
		expect(t.held).toBe(10n);
		expect(t.held_by_reason.cooldown).toBe(10n);
	});

	it('exports csv and neutralises spreadsheet formulas', () => {
		const csv = core.distributionsToCsv([
			{ created_at: '2026-10-23T00:00:00Z', agent_id: AGENT, mint: 'M', status: 'held', hold_reason: 'cooldown', creator_lamports: '1500000000', payout_wallet: '=HYPERLINK("x")', claim_sig: 'c', tx_signature: null },
		]);
		const [head, row] = csv.trim().split('\n');
		expect(head).toBe(core.DISTRIBUTION_CSV_COLUMNS.join(','));
		expect(row).toContain(',1.5,');
		expect(row).toContain(`"'=HYPERLINK(""x"")"`);
	});
});
