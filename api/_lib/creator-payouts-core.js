// Pure logic for creator-fee payouts: the signed payout-wallet message, the
// reasons a distribution is held, the per-$100 flow explainer, a plain-language
// reading of a cron expression, and the CSV export. No I/O lives here so every
// rule is unit-testable (tests/creator-payouts.test.js); api/_lib/creator-payouts.js
// does the database and chain work around it.

import { CREATOR_FEE_CLAIM_POLICY } from './token/config.js';

export const LAMPORTS_PER_SOL = 1_000_000_000;
/** A creator share below this stays held until the unsent total reaches it. */
export const MIN_PAYOUT_LAMPORTS = 10_000_000;
/** A changed payout wallet receives nothing until this long after the signed change. */
export const WALLET_CHANGE_COOLDOWN_MS = 48 * 3_600_000;
/** A signed registration message is only honoured this long after it was issued. */
export const MESSAGE_MAX_AGE_MS = 5 * 60_000;
export const MESSAGE_MAX_FUTURE_MS = 60_000;
/** SOL kept in the agent wallet so it can still pay network fees and stay rent-exempt. */
export const WALLET_RESERVE_LAMPORTS = 2_000_000;

export const HOLD_REASONS = Object.freeze({
	wallet_not_registered: {
		label: 'No payout wallet registered',
		fix: 'Register a payout wallet by signing a message with it. Held shares are sent on the next distribution after you do.',
	},
	cooldown: {
		label: 'Payout wallet change in cooldown',
		fix: 'A new payout wallet receives funds only after the cooldown ends. Cancel the change if you did not make it.',
	},
	below_minimum: {
		label: 'Below the minimum payout',
		fix: 'Shares are batched until your unsent total reaches the minimum, so a transfer is never smaller than its worth.',
	},
	agent_wallet_low: {
		label: 'Agent wallet balance too low',
		fix: 'The agent wallet holds less SOL than this payout plus a fee reserve. Top it up or wait for more claims to land.',
	},
	payouts_paused: {
		label: 'Distribution not enabled yet',
		fix: 'The operator has not switched on automatic distribution. Shares stay recorded and are sent when it is enabled.',
	},
	signing_unavailable: {
		label: 'Agent wallet cannot sign payouts',
		fix: 'This agent uses self-custody or an unavailable signer, so the platform cannot send its payout. Claim and withdraw from the wallet directly.',
	},
});

/** Every status a distribution row can be in. */
export const DISTRIBUTION_STATUSES = Object.freeze(['pending', 'held', 'sending', 'sent']);

// ── Signed payout-wallet message ─────────────────────────────────────────────

const NONCE_RE = /^[0-9a-f]{32}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isNonce = (v) => typeof v === 'string' && NONCE_RE.test(v);
export const isSolanaAddress = (v) => typeof v === 'string' && BASE58_RE.test(v);

/** The exact text the payout wallet signs. Ed25519 over these UTF-8 bytes. */
export function buildRegistrationMessage({ agentId, wallet, nonce, issuedAt }) {
	return [
		'three.ws creator payout wallet',
		`Agent: ${agentId}`,
		`Wallet: ${wallet}`,
		`Nonce: ${nonce}`,
		`Issued: ${issuedAt}`,
		'Signing this message makes this wallet the destination for this agent\'s creator-fee payouts.',
	].join('\n');
}

/**
 * Parse and check a registration message against the request it arrived with.
 * Returns `{ ok: true, nonce, issuedAt }` or `{ ok: false, code, message }`.
 * Replay protection (the nonce being unused) is the caller's atomic insert.
 */
export function checkRegistrationMessage(message, { agentId, wallet, now = Date.now() }) {
	const m = /^three\.ws creator payout wallet\nAgent: (\S+)\nWallet: (\S+)\nNonce: (\S+)\nIssued: (\S+)\nSigning this message makes this wallet the destination for this agent's creator-fee payouts\.$/.exec(
		String(message || ''),
	);
	if (!m) return { ok: false, code: 'invalid_message', message: 'The signed message is not the payout registration message.' };
	const [, msgAgent, msgWallet, nonce, issuedAt] = m;
	if (!UUID_RE.test(msgAgent) || msgAgent.toLowerCase() !== String(agentId).toLowerCase()) {
		return { ok: false, code: 'wrong_agent', message: 'The signed message is for a different agent.' };
	}
	if (msgWallet !== wallet) return { ok: false, code: 'wrong_wallet', message: 'The signed message names a different wallet.' };
	if (!isNonce(nonce)) return { ok: false, code: 'invalid_nonce', message: 'The nonce in the signed message is malformed.' };
	const issued = Date.parse(issuedAt);
	if (!Number.isFinite(issued)) return { ok: false, code: 'invalid_timestamp', message: 'The timestamp in the signed message is not valid.' };
	if (now - issued > MESSAGE_MAX_AGE_MS) return { ok: false, code: 'message_expired', message: 'That signed message has expired. Request a new one and sign again.' };
	if (issued - now > MESSAGE_MAX_FUTURE_MS) return { ok: false, code: 'invalid_timestamp', message: 'The timestamp in the signed message is in the future.' };
	return { ok: true, nonce, issuedAt };
}

// ── Held reasons ─────────────────────────────────────────────────────────────

/**
 * Why an agent's unsent creator share cannot go out right now, or null when it
 * can. Order matters and is the order an owner can act on: register first, wait
 * out a cooldown, then volume, then the platform-side conditions.
 *
 * @param {{
 *   activeWallet: string | null,
 *   pendingWallet: string | null,
 *   pendingEffectiveAt: Date | string | null,
 *   unsentLamports: bigint,
 *   minimumLamports?: bigint,
 *   live: boolean,
 *   now?: number,
 * }} s
 */
export function holdReason(s) {
	const now = s.now ?? Date.now();
	const min = s.minimumLamports ?? BigInt(MIN_PAYOUT_LAMPORTS);
	if (s.pendingWallet) {
		const eff = s.pendingEffectiveAt ? new Date(s.pendingEffectiveAt).getTime() : Infinity;
		if (eff > now) return 'cooldown';
	}
	if (!s.activeWallet && !s.pendingWallet) return 'wallet_not_registered';
	if (s.unsentLamports < min) return 'below_minimum';
	if (!s.live) return 'payouts_paused';
	return null;
}

// ── Per-$100 flow explainer ──────────────────────────────────────────────────

/**
 * Where $100 of claimed creator fees goes, generated from a split policy. The
 * policy is data (api/_lib/token/config.js CREATOR_FEE_CLAIM_POLICY), so
 * the explainer can never drift from what the claimer earmarks.
 */
export function flowPer100(policy = CREATOR_FEE_CLAIM_POLICY, amountUsd = 100) {
	if (!Array.isArray(policy) || !policy.length) return { amount_usd: amountUsd, legs: [] };
	const total = policy.reduce((s, l) => s + l.bps, 0);
	const meta = {
		seller: { label: 'You (your payout wallet)', detail: 'Sent to the payout wallet you registered, in batches of at least the minimum payout.' },
		treasury: { label: 'Platform buyback', detail: 'Earmarked for the platform $THREE buyback, not paid out.' },
		rewards: { label: 'Holder rewards', detail: 'Reflected to holders.' },
	};
	return {
		amount_usd: amountUsd,
		total_bps: total,
		legs: policy.map((l) => ({
			role: l.role,
			bps: l.bps,
			usd: Math.round((amountUsd * l.bps) / 100) / 100,
			label: meta[l.role]?.label || l.role,
			detail: meta[l.role]?.detail || '',
		})),
	};
}

/** The creator's share of a claim in lamports, given the buyback share recorded with it. */
export function creatorShareLamports(claimedLamports, buybackSol) {
	const claimed = BigInt(claimedLamports || 0);
	const buyback = BigInt(Math.round(Number(buybackSol || 0) * LAMPORTS_PER_SOL));
	const share = claimed - buyback;
	return share > 0n ? share : 0n;
}

// ── Cron expressions in plain language ───────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * A short reading of a five-field cron expression, for the schedules this
 * platform actually uses (minute steps, hourly, every N hours, daily). Anything
 * else is returned as `cron <expr> (UTC)` so the page never claims more than
 * the expression says.
 */
export function describeCron(expr) {
	const f = String(expr || '').trim().split(/\s+/);
	if (f.length !== 5) return `cron ${expr} (UTC)`;
	const [min, hour, dom, mon, dow] = f;
	if (dom !== '*' || mon !== '*' || dow !== '*') return `cron ${expr} (UTC)`;
	const step = /^(?:\*|\d+(?:-\d+)?)\/(\d+)$/.exec(min);
	if (step && hour === '*') return `every ${step[1]} minutes`;
	if (/^\d+$/.test(min) && hour === '*') return Number(min) === 0 ? 'every hour, on the hour' : `every hour at :${pad2(min)}`;
	const hstep = /^\*\/(\d+)$/.exec(hour);
	if (/^\d+$/.test(min) && hstep) return `every ${hstep[1]} hours at :${pad2(min)}`;
	if (/^\d+$/.test(min) && /^\d+$/.test(hour)) return `daily at ${pad2(hour)}:${pad2(min)} UTC`;
	if (/^\d+(?:,\d+)+$/.test(min) && hour === '*') return `twice an hour, at ${min.split(',').map((m) => `:${pad2(m)}`).join(' and ')}`;
	return `cron ${expr} (UTC)`;
}

/**
 * Pick the crons that drive creator-fee money out of a parsed vercel.json and
 * describe them. `crons` is the file's `crons` array.
 */
export function payoutSchedule(crons) {
	const stages = [
		{ key: 'snapshot', path: '/api/cron/creator-earnings-snapshot', label: 'Earnings refresh', does: 'Reads what each coin has earned from pump.fun and the on-chain vault.' },
		{ key: 'claim', path: '/api/cron/launcher-claimer', label: 'Fee collection', does: 'Claims accrued creator fees from the vault into the agent wallet once they pass the claim threshold.' },
		{ key: 'distribute', path: '/api/cron/creator-payout-distribute', label: 'Distribution', does: 'Sends your share of each claim to your payout wallet, or records why it is held.' },
		{ key: 'reconcile', path: '/api/cron/creator-payout-reconcile', label: 'Reconciliation', does: 'Checks on-chain vault balances and sent transfers against our records and alerts on drift.' },
	];
	const list = Array.isArray(crons) ? crons : [];
	return stages.map((s) => {
		const c = list.find((x) => x.path === s.path);
		return { ...s, schedule: c?.schedule || null, cadence: c ? describeCron(c.schedule) : 'not scheduled' };
	});
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export const DISTRIBUTION_CSV_COLUMNS = Object.freeze([
	'date', 'agent_id', 'mint', 'status', 'hold_reason', 'creator_share_sol', 'payout_wallet', 'claim_signature', 'payout_signature',
]);

const csvCell = (v) => {
	let s = v == null ? '' : String(v);
	// A cell that starts with a formula character would execute in a spreadsheet.
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function solFromLamports(lamports) {
	const v = BigInt(lamports || 0);
	const whole = v / BigInt(LAMPORTS_PER_SOL);
	const frac = (v % BigInt(LAMPORTS_PER_SOL)).toString().padStart(9, '0').replace(/0+$/, '');
	return `${whole}${frac ? `.${frac}` : ''}`;
}

export function distributionsToCsv(rows) {
	const lines = [DISTRIBUTION_CSV_COLUMNS.join(',')];
	for (const r of rows) {
		lines.push(
			[
				new Date(r.created_at).toISOString(),
				r.agent_id,
				r.mint,
				r.status,
				r.hold_reason || '',
				solFromLamports(r.creator_lamports),
				r.payout_wallet || '',
				r.claim_sig || '',
				r.tx_signature || '',
			]
				.map(csvCell)
				.join(','),
		);
	}
	return `${lines.join('\n')}\n`;
}

/** Summarise distribution rows into the five totals plus per-reason held amounts. */
export function summarizeDistributions(rows) {
	const out = { sent: 0n, pending: 0n, held: 0n, held_by_reason: {} };
	for (const r of rows) {
		const v = BigInt(r.creator_lamports || 0);
		if (r.status === 'sent') out.sent += v;
		else if (r.status === 'held') {
			out.held += v;
			const k = r.hold_reason || 'unknown';
			out.held_by_reason[k] = (out.held_by_reason[k] || 0n) + v;
		} else out.pending += v;
	}
	return out;
}
