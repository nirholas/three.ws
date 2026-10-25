// Unit tests for the Wallet Intents engine's safety-critical pure logic:
// api/_lib/wallet-intents.js → normalizeIntent + resolveAssetToken + describeIntent.
//
// normalizeIntent is the boundary between a fuzzy LLM/form input and a real,
// enforceable standing money rule. The invariants it must never break:
//   - only the supported triggers/actions are accepted; anything else is rejected,
//     never coerced into a fake capability;
//   - a rule missing a required field (amount, destination, threshold, mint…) is
//     rejected with a precise reason — money never arms on a guess;
//   - amounts/percentages/slippage are clamped to sane bounds;
//   - $THREE is the only coin resolved by name; a base58 mint is passed through.
// The LLM HTTP path, the cron, signing, and DB are NOT exercised here — only the
// deterministic validation. The heavy server-only deps are stubbed so the import
// is cheap and side-effect-free.

import { describe, it, expect, vi } from 'vitest';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const ADDR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../api/_lib/avatar-wallet.js', () => ({
	solUsdPrice: vi.fn(async () => 150), sendSol: vi.fn(async () => 'sig'), explorerTxUrl: vi.fn(() => 'https://x'),
}));
vi.mock('../api/_lib/agent-pumpfun.js', () => ({ solanaConnection: vi.fn(() => ({})) }));
vi.mock('../api/_lib/agent-wallet.js', () => ({
	getSolanaAddressBalances: vi.fn(async () => ({ sol: 1 })), recoverSolanaAgentKeypair: vi.fn(),
}));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({
	getSpendLimits: vi.fn(() => ({})), getTradeLimits: vi.fn(() => ({})), setSpendLimits: vi.fn(),
	enforceSpendLimit: vi.fn(), SpendLimitError: class extends Error {}, recordCustodyEvent: vi.fn(),
	updateCustodyEvent: vi.fn(), validateSolanaAddress: vi.fn((a) => ({ valid: true, base58: a })),
	lamportsToUsd: vi.fn(async () => 1), SOL_FEE_HEADROOM_LAMPORTS: 3000000n,
}));
vi.mock('../api/_lib/networth-model.js', () => ({ THREE_MINT: THREE }));
vi.mock('../src/solana/sns.js', () => ({ resolveSolanaRecipient: vi.fn(async () => ({ address: null })) }));
vi.mock('../api/_lib/pump-launch-feed.js', () => ({ recentPumpLaunches: vi.fn(async () => []), enrichCreatorStats: vi.fn(async (l) => l) }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));

const { normalizeIntent, resolveAssetToken, describeIntent, INTENT_TRIGGERS, INTENT_ACTIONS } =
	await import('../api/_lib/wallet-intents.js');

describe('resolveAssetToken', () => {
	it('resolves $THREE / three by name to the canonical mint, never another coin', () => {
		expect(resolveAssetToken('$THREE')).toMatchObject({ kind: 'three', mint: THREE });
		expect(resolveAssetToken('three')).toMatchObject({ kind: 'three', mint: THREE });
	});
	it('recognises SOL and USDC', () => {
		expect(resolveAssetToken('SOL').kind).toBe('sol');
		expect(resolveAssetToken('usdc').kind).toBe('usdc');
	});
	it('passes a base58 mint through as runtime input', () => {
		expect(resolveAssetToken(ADDR)).toMatchObject({ kind: 'mint', mint: ADDR });
	});
});

describe('normalizeIntent — trigger/action allowlist', () => {
	it('rejects an unsupported trigger', () => {
		const r = normalizeIntent({ trigger_type: 'on_moon', action_type: 'notify' });
		expect(r.ok).toBe(false);
		expect(r.error).toBe('bad_trigger');
	});
	it('rejects an unsupported action (no fake capabilities)', () => {
		const r = normalizeIntent({ trigger_type: 'on_schedule', action_type: 'launch_coin' });
		expect(r.ok).toBe(false);
		expect(r.error).toBe('bad_action');
	});
	it('every advertised trigger + action constant is non-empty', () => {
		expect(INTENT_TRIGGERS.length).toBeGreaterThan(0);
		expect(INTENT_ACTIONS).toContain('freeze');
	});
});

describe('normalizeIntent — tip-back (the flagship rule)', () => {
	it('accepts "tip back half of what they sent" as a percentage of the tip', () => {
		const r = normalizeIntent({
			trigger_type: 'on_tip_received', trigger_config: { min_sol: 0.1 },
			action_type: 'tip', action_config: { pct: 50, of: 'tip', destination: ADDR },
			readback: 'Tip back half.',
		});
		expect(r.ok).toBe(true);
		expect(r.intent.trigger).toMatchObject({ type: 'on_tip_received', min_sol: 0.1 });
		expect(r.intent.action).toMatchObject({ type: 'tip', pct: 50, of: 'tip' });
	});
	it('accepts a tip-back with no destination as "to the tipper" (filled at fire time)', () => {
		const r = normalizeIntent({ trigger_type: 'on_tip_received', action_type: 'tip', action_config: { pct: 50, of: 'tip' }, readback: 'Tip back half.' });
		expect(r.ok).toBe(true);
		expect(r.intent.action.to_tipper).toBe(true);
	});
	it('clamps a percentage over 100', () => {
		const r = normalizeIntent({ trigger_type: 'on_income', action_type: 'split_income', action_config: { pct: 250, destination: ADDR } });
		expect(r.ok).toBe(true);
		expect(r.intent.action.pct).toBe(100);
	});
});

describe('normalizeIntent — required-field enforcement (no guessing)', () => {
	it('rejects a balance rule with no threshold', () => {
		const r = normalizeIntent({ trigger_type: 'on_balance_below', action_type: 'freeze' });
		expect(r.ok).toBe(false);
		expect(r.error).toBe('needs_threshold');
	});
	it('accepts a balance-floor freeze with a threshold', () => {
		const r = normalizeIntent({ trigger_type: 'on_balance_below', trigger_config: { threshold_sol: 0.05 }, action_type: 'freeze' });
		expect(r.ok).toBe(true);
		expect(r.intent.trigger.threshold_sol).toBe(0.05);
	});
	it('rejects a transfer with no destination', () => {
		const r = normalizeIntent({ trigger_type: 'on_schedule', action_type: 'transfer', action_config: { amount_sol: 1 } });
		expect(r.ok).toBe(false);
		expect(r.error).toBe('needs_destination');
	});
	it('rejects a split with no percentage', () => {
		const r = normalizeIntent({ trigger_type: 'on_income', action_type: 'split_income', action_config: { destination: ADDR } });
		expect(r.ok).toBe(false);
		expect(r.error).toBe('needs_pct');
	});
	it('rejects a launch rule with neither creator nor max market cap', () => {
		const r = normalizeIntent({ trigger_type: 'on_launch_matching', action_type: 'snipe', action_config: { amount_sol: 1 } });
		expect(r.ok).toBe(false);
		expect(r.error).toBe('needs_filter');
	});
});

describe('normalizeIntent — schedule + launch', () => {
	it('defaults a weekly schedule to Friday 13:00 UTC and accepts an explicit weekday', () => {
		const def = normalizeIntent({ trigger_type: 'on_schedule', trigger_config: { cadence: 'weekly' }, action_type: 'withdraw', action_config: { above_sol: 2, destination: ADDR } });
		expect(def.ok).toBe(true);
		expect(def.intent.trigger).toMatchObject({ cadence: 'weekly', weekday: 5, hour: 13 });
		const mon = normalizeIntent({ trigger_type: 'on_schedule', trigger_config: { cadence: 'weekly', weekday: 1, hour: 9 }, action_type: 'withdraw', action_config: { above_sol: 2, destination: ADDR } });
		expect(mon.intent.trigger).toMatchObject({ weekday: 1, hour: 9 });
	});
	it('accepts a snipe rule with a creator + max mcap and clamps slippage', () => {
		const r = normalizeIntent({ trigger_type: 'on_launch_matching', trigger_config: { creator: ADDR, max_mcap_usd: 40000 }, action_type: 'snipe', action_config: { amount_sol: 1, slippage_pct: 99 } });
		expect(r.ok).toBe(true);
		expect(r.intent.trigger).toMatchObject({ creator: ADDR, max_mcap_usd: 40000 });
		expect(r.intent.action.slippage_pct).toBe(50);
	});
});

describe('normalizeIntent — on_stream_started (event-driven, no required config)', () => {
	it('accepts a notify-on-stream-start rule', () => {
		const r = normalizeIntent({ trigger_type: 'on_stream_started', action_type: 'notify', action_config: { message: 'someone is streaming to you' } });
		expect(r.ok).toBe(true);
		expect(r.intent.trigger.type).toBe('on_stream_started');
		expect(r.intent.action.type).toBe('notify');
	});
	it('accepts "split 10% of stream income" to a destination', () => {
		const r = normalizeIntent({ trigger_type: 'on_stream_started', action_type: 'split_income', action_config: { pct: 10, destination: ADDR } });
		expect(r.ok).toBe(true);
		expect(r.intent.action).toMatchObject({ type: 'split_income', pct: 10, of: 'income' });
	});
	it('reads back a stream-start rule in plain language', () => {
		const r = normalizeIntent({ trigger_type: 'on_stream_started', action_type: 'notify', action_config: { message: 'hi' } });
		expect(describeIntent(r.intent).toLowerCase()).toMatch(/stream/);
	});
});

describe('describeIntent', () => {
	it('produces a human read-back when none was supplied', () => {
		const r = normalizeIntent({ trigger_type: 'on_balance_below', trigger_config: { threshold_sol: 0.05 }, action_type: 'freeze' });
		const text = describeIntent(r.intent);
		expect(text).toMatch(/0.05 SOL/);
		expect(text.toLowerCase()).toMatch(/freeze/);
	});
});

describe('on_mail_received sender matching', () => {
	it('matches the sender by exact address or domain, never by substring', async () => {
		const { mailSenderMatches } = await import('../api/_lib/wallet-intents.js');
		expect(mailSenderMatches('billing@acme.example', 'billing@acme.example')).toBe(true);
		expect(mailSenderMatches('acme.example', 'billing@acme.example')).toBe(true);
		expect(mailSenderMatches('@acme.example', 'billing@acme.example')).toBe(true);
		expect(mailSenderMatches('acme.example', 'ops@mail.acme.example')).toBe(true);
		expect(mailSenderMatches('acme.example', 'x@evilacme.example')).toBe(false);
		expect(mailSenderMatches('acme.example', 'acme.example@evil.example')).toBe(false);
		expect(mailSenderMatches('billing@acme.example', 'xbilling@acme.example.evil.example')).toBe(false);
	});
});

describe('on_mail_received authentication gate', () => {
	it('fires only for a DMARC-aligned sender and fails closed without auth results', async () => {
		const { isAuthenticatedSender } = await import('../api/_lib/mail/spam.js');
		expect(isAuthenticatedSender({ spf: 'pass', dkim: 'pass', dmarc: 'pass' })).toBe(true);
		expect(isAuthenticatedSender({ spf: 'pass', dkim: 'none', dmarc: 'fail' })).toBe(false);
		expect(isAuthenticatedSender({ spf: 'none', dkim: 'none', dmarc: 'none' })).toBe(false);
		expect(isAuthenticatedSender(undefined)).toBe(false);
	});

	it('onMailReceived refuses to fire for an unauthenticated message', async () => {
		const { onMailReceived } = await import('../api/_lib/wallet-intents.js');
		const { sql } = await import('../api/_lib/db.js');
		sql.mockClear();
		const out = await onMailReceived('agent-1', { message_id: 'm1', from: 'a@acme.example', subject: 's', authenticated: false });
		expect(out).toMatchObject({ fired: 0 });
		expect(sql).not.toHaveBeenCalled();
	});
});
