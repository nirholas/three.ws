// Burner tiers: the pure half of the capped-burner policy. No imports, so the
// server guard (api/_lib/agent-trade-guards.js) and the browser policy editor
// (src/agent-wallet-hub/tabs/burner.js) run the exact same classifier and the
// editor's live preview can never disagree with what the guard does.
//
// A burner policy says how much an agent may spend on its own:
//
//   autoMaxUsd       largest single spend the agent signs alone
//   dailyAutoMaxUsd  rolling-24h ceiling on what the agent signs alone (null = none)
//   confirmAboveUsd  above this a tap is not enough: the owner must sign the
//                    approval with their own linked wallet (null = a tap always
//                    suffices)
//   expiryMinutes    how long an approval request stays answerable
//
// The policy is off until autoMaxUsd is set. Once on, nothing above the cap
// fails: it becomes a pending approval in the owner's inbox.

export const BURNER_TIERS = Object.freeze(['auto', 'confirm', 'owner_sign']);

export const BURNER_EXPIRY_DEFAULT_MIN = 10;
export const BURNER_EXPIRY_MIN = 2;
export const BURNER_EXPIRY_MAX = 60;

const USD_MAX = 1_000_000;

function usdOrNull(v) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.min(USD_MAX, Math.round(n * 100) / 100);
}

/** Coerce arbitrary input into a clean, bounded burner policy. */
export function normalizeBurnerPolicy(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const expiry = Number(r.expiryMinutes);
	return {
		autoMaxUsd: usdOrNull(r.autoMaxUsd),
		dailyAutoMaxUsd: usdOrNull(r.dailyAutoMaxUsd),
		confirmAboveUsd: usdOrNull(r.confirmAboveUsd),
		expiryMinutes: Number.isFinite(expiry)
			? Math.max(BURNER_EXPIRY_MIN, Math.min(BURNER_EXPIRY_MAX, Math.round(expiry)))
			: BURNER_EXPIRY_DEFAULT_MIN,
		updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
	};
}

/**
 * Cross-field validation for a policy an owner is saving. Returns a plain
 * message or null. The classifier tolerates any normalized policy; this keeps
 * saved ones coherent.
 */
export function validateBurnerPolicy(p) {
	if (p.autoMaxUsd == null) {
		if (p.dailyAutoMaxUsd != null || p.confirmAboveUsd != null) {
			return 'Set the per-spend auto limit first. The daily limit and the wallet-signature threshold only apply once the burner is on.';
		}
		return null;
	}
	if (p.dailyAutoMaxUsd != null && p.dailyAutoMaxUsd < p.autoMaxUsd) {
		return 'The daily auto limit cannot be lower than the per-spend auto limit, or the agent could never use its own cap.';
	}
	if (p.confirmAboveUsd != null && p.confirmAboveUsd < p.autoMaxUsd) {
		return 'The wallet-signature threshold cannot be lower than the per-spend auto limit.';
	}
	return null;
}

export function burnerEnabled(policy) {
	return policy != null && policy.autoMaxUsd != null;
}

const money = (n) => `$${Number(n).toFixed(2)}`;

/**
 * Classify one spend.
 *
 * @param {object} o
 * @param {object} o.policy        normalized burner policy
 * @param {number|null} o.usd      USD value of the spend (null = unpriced)
 * @param {number} [o.autoSpentUsd] USD the agent already signed alone in the last 24h
 * @returns {{ tier: 'auto'|'confirm'|'owner_sign', enabled: boolean, reason: string,
 *             headroomUsd: number|null }}
 */
export function classifyBurnerSpend({ policy, usd, autoSpentUsd = 0 }) {
	if (!burnerEnabled(policy)) {
		return { tier: 'auto', enabled: false, reason: 'No burner cap is set, so your other spend limits are the only gate.', headroomUsd: null };
	}
	const spent = Number.isFinite(Number(autoSpentUsd)) ? Number(autoSpentUsd) : 0;
	const headroomUsd = policy.dailyAutoMaxUsd == null ? null : Math.max(0, policy.dailyAutoMaxUsd - spent);

	if (usd == null || !Number.isFinite(Number(usd)) || Number(usd) < 0) {
		return { tier: 'confirm', enabled: true, reason: 'The value of this spend could not be priced, so it needs your confirmation.', headroomUsd };
	}
	const amount = Number(usd);

	if (policy.confirmAboveUsd != null && amount > policy.confirmAboveUsd + 1e-9) {
		return {
			tier: 'owner_sign', enabled: true, headroomUsd,
			reason: `${money(amount)} is above ${money(policy.confirmAboveUsd)}, so you must sign the approval with your own wallet.`,
		};
	}
	if (amount > policy.autoMaxUsd + 1e-9) {
		return {
			tier: 'confirm', enabled: true, headroomUsd,
			reason: `${money(amount)} is above the ${money(policy.autoMaxUsd)} the agent may spend alone, so it needs your confirmation.`,
		};
	}
	if (policy.dailyAutoMaxUsd != null && spent + amount > policy.dailyAutoMaxUsd + 1e-9) {
		return {
			tier: 'confirm', enabled: true, headroomUsd,
			reason: `The agent has signed ${money(spent)} alone in the last 24 hours. ${money(amount)} more would pass its ${money(policy.dailyAutoMaxUsd)} daily limit, so it needs your confirmation.`,
		};
	}
	return {
		tier: 'auto', enabled: true, headroomUsd,
		reason: `${money(amount)} is within the ${money(policy.autoMaxUsd)} the agent may spend alone.`,
	};
}

/**
 * The exact text the owner's wallet signs to confirm one request. It binds the
 * request id, the payload hash and the confirmation table, so a signature for
 * one request can never approve another or an edited one.
 */
export function ownerSignMessage({ id, payloadHash, recipient, amount, asset, chain, network }) {
	return [
		'three.ws approval',
		`request: ${id}`,
		`recipient: ${recipient ?? 'n/a'}`,
		`amount: ${amount ?? 'n/a'} ${asset ?? ''}`.trimEnd(),
		`chain: ${chain ?? 'solana'}${network && network !== 'mainnet' ? ` ${network}` : ''}`,
		`hash: ${payloadHash}`,
	].join('\n');
}
