// $THREE on-chain token layer — shared config + split policy.
//
// Centralizes the mint, decimals, treasury wallet, and rewards (reflections)
// wallet so no literal addresses are scattered across the paid-action endpoints.
// Mirrors the HOLDER_PASS_SECRET boot guard: a value that, if wrong/unset, would
// route real funds to the wrong place fails loudly in production rather than
// silently mis-paying.
//
// ECONOMY POLICY — NO PLATFORM BURNS. Every $THREE the platform charges routes to
// the treasury, a holder-rewards (reflections) pool, and — on a sale — the
// seller/creator. Supply is never destroyed; the treasury funds buybacks instead,
// which creates buy pressure without deflation. The `burn` role and burn address
// remain ONLY for the user-invoked burn primitive (three_burn in three-token-mcp,
// where a holder may choose to burn their own bag). No platform split policy below
// includes a burn leg.

import { env } from '../env.js';

export const TOKEN_MINT = env.THREE_TOKEN_MINT;
export const TOKEN_DECIMALS = env.THREE_TOKEN_DECIMALS;
export const TOKEN_SYMBOL = '$THREE';

// Smallest-unit multiplier (10 ** decimals) as a BigInt for atomics math.
export const ATOMICS_PER_TOKEN = 10n ** BigInt(TOKEN_DECIMALS);

function badRequest(message) {
	const e = new Error(message);
	e.status = 400;
	e.code = 'bad_request';
	return e;
}

// ── Required addresses (fail-closed in production) ──────────────────────────

let _treasuryWarned = false;
/**
 * Treasury wallet that receives the treasury share of every split.
 * Production MUST set THREE_TREASURY_WALLET; otherwise we'd route the platform's
 * cut to a placeholder. In dev we fall back to the burn address so the split
 * still has two valid destinations and no real wallet is silently credited.
 */
export function treasuryWallet() {
	const w = env.THREE_TREASURY_WALLET;
	if (w) return w;
	if (process.env.NODE_ENV === 'production') {
		// Fail closed, but as a typed 503 so the caller renders a clean
		// "temporarily unavailable" state instead of an opaque 500. The condition
		// is a deploy-time misconfiguration (env unset), not a client error.
		const e = new Error(
			'[token] THREE_TREASURY_WALLET is required in production — refusing to route treasury funds to an unset address.',
		);
		e.status = 503;
		e.code = 'treasury_unavailable';
		throw e;
	}
	if (!_treasuryWarned) {
		_treasuryWarned = true;
		console.warn(
			'[token] THREE_TREASURY_WALLET is not set — falling back to the burn address for dev. ' +
				'Set THREE_TREASURY_WALLET in production or the treasury share is burned.',
		);
	}
	return burnAddress();
}

/**
 * Non-throwing treasury lookup for READ paths (public config, status). Returns
 * the configured address or `null` when unset — never throws. A missing
 * treasury is a misconfiguration of the *fund-routing* path; it must not 500 a
 * read-only endpoint. Fund-moving callers use `treasuryWallet()` (strict) so
 * they still fail closed and never route to an unset address.
 */
export function treasuryWalletOrNull() {
	return env.THREE_TREASURY_WALLET || null;
}

let _rewardsWarned = false;
/**
 * Rewards (reflections) wallet that receives the `rewards` share of every split.
 * This is the pool distributed back to $THREE holders pro-rata (Lever: treasury
 * loop). Same fail-closed contract as the treasury: production MUST set
 * THREE_REWARDS_WALLET or fund-routing refuses; dev falls back to the burn sink so
 * the split still has a valid destination and no real wallet is silently credited.
 */
export function rewardsWallet() {
	const w = env.THREE_REWARDS_WALLET;
	if (w) return w;
	if (process.env.NODE_ENV === 'production') {
		const e = new Error(
			'[token] THREE_REWARDS_WALLET is required in production — refusing to route holder-rewards funds to an unset address.',
		);
		e.status = 503;
		e.code = 'rewards_unavailable';
		throw e;
	}
	if (!_rewardsWarned) {
		_rewardsWarned = true;
		console.warn(
			'[token] THREE_REWARDS_WALLET is not set — falling back to the burn sink for dev. ' +
				'Set THREE_REWARDS_WALLET in production or the holder-rewards share is burned.',
		);
	}
	return burnAddress();
}

/** Non-throwing rewards lookup for READ paths (public config, status). */
export function rewardsWalletOrNull() {
	return env.THREE_REWARDS_WALLET || null;
}

/**
 * The burn sink (Solana incinerator, unspendable ATA). Retained ONLY for the
 * user-invoked burn primitive (three_burn) and as the dev fallback for unset
 * fund-routing wallets. NO platform split policy routes here — see the economy
 * policy note at the top of this file.
 */
export function burnAddress() {
	return env.THREE_BURN_ADDRESS;
}

// ── Split policy ────────────────────────────────────────────────────────────
//
// Each policy is an ordered list of legs { role, bps }. bps across legs must
// sum to 10_000. Roles resolve to addresses:
//   'treasury' → THREE_TREASURY_WALLET (the platform cut, funds buybacks)
//   'rewards'  → THREE_REWARDS_WALLET  (the holder reflections pool)
//   'seller'   → a per-call address (a marketplace listing's / creator's payout)
// No platform policy routes to 'burn' — supply is never destroyed (see top note).
// Every paid surface reuses the same verified-payment path by naming a policy
// here; the split ratio is a parameter, not a fork of logic.
export const SPLIT_POLICIES = Object.freeze({
	// Pay-per-use compute (Forge paid tiers, voice clone, MCP-3D, Granite,
	// selfie→avatar). 70% funds the platform/buybacks, 30% reflects to holders.
	consumption: [
		{ role: 'treasury', bps: 7000 },
		{ role: 'rewards', bps: 3000 },
	],
	// Paid game spins (in-app wheel / actions). Former burn half now reflects to
	// holders instead of being destroyed.
	spin: [
		{ role: 'treasury', bps: 5000 },
		{ role: 'rewards', bps: 5000 },
	],
	// Token-priced marketplace sales (skills, animations, avatars, assets,
	// collectible resales). Seller/creator keeps 90%, 5% treasury, 5% rewards.
	marketplace_sale: [
		{ role: 'seller', bps: 9000 },
		{ role: 'treasury', bps: 500 },
		{ role: 'rewards', bps: 500 },
	],
	// Scarcity drops + rare-name auctions + pay-to-mint. No seller leg (the
	// platform mints the scarce good); 80% treasury, 20% reflects to holders.
	scarcity_mint: [
		{ role: 'treasury', bps: 8000 },
		{ role: 'rewards', bps: 2000 },
	],
	// Copy-trading performance fee — charged on a copier's realized profit only.
	// The leader (seller leg) keeps 80%; the platform takes 15% (funds buybacks +
	// the referrer's share via the existing referral ledger); 5% reflects to
	// holders. Same on-chain split machinery as every other paid surface.
	copy_performance_fee: [
		{ role: 'seller', bps: 8000 },
		{ role: 'treasury', bps: 1500 },
		{ role: 'rewards', bps: 500 },
	],
});

function resolveRole(role, { sellerWallet } = {}) {
	if (role === 'treasury') return treasuryWallet();
	if (role === 'rewards') return rewardsWallet();
	if (role === 'seller') {
		if (!sellerWallet) throw badRequest('sellerWallet is required for this split policy');
		return sellerWallet;
	}
	// 'burn' intentionally has no platform route — the user-invoked burn primitive
	// resolves its own destination from burnAddress() directly, not via a policy.
	throw new Error(`[token] unknown split role: ${role}`);
}

/**
 * Resolve a named policy into concrete legs with destination addresses.
 * @returns {{ role: string, bps: number, address: string }[]}
 */
export function resolveSplitLegs(policyName, opts = {}) {
	const policy = SPLIT_POLICIES[policyName];
	if (!policy) throw badRequest(`unknown split policy: ${policyName}`);
	const sum = policy.reduce((s, l) => s + l.bps, 0);
	// Defensive: a mis-edited policy must never silently under/over-allocate.
	if (sum !== 10_000)
		throw new Error(`[token] split policy ${policyName} bps sum ${sum} != 10000`);
	return policy.map((leg) => ({
		role: leg.role,
		bps: leg.bps,
		address: resolveRole(leg.role, opts),
	}));
}

/**
 * Distribute a total (atomics) across legs by bps. Any rounding remainder is
 * assigned to the highest-bps leg so the per-leg atomics always sum to exactly
 * the total — no dust is created or lost.
 * @param {bigint|string|number} totalAtomics
 * @param {{ role: string, bps: number, address: string }[]} legs
 * @returns {{ role: string, bps: number, address: string, atomics: bigint }[]}
 */
export function applySplit(totalAtomics, legs) {
	const total = BigInt(totalAtomics);
	let allocated = 0n;
	const out = legs.map((leg) => {
		const atomics = (total * BigInt(leg.bps)) / 10_000n;
		allocated += atomics;
		return { ...leg, atomics };
	});
	const remainder = total - allocated;
	if (remainder !== 0n && out.length > 0) {
		let idx = 0;
		for (let i = 1; i < out.length; i++) if (out[i].bps > out[idx].bps) idx = i;
		out[idx].atomics += remainder;
	}
	return out;
}

/**
 * Bonus credits granted on a $THREE credit deposit, in basis points of the
 * deposit's USD value. Read live from env on every call so the owner can tune
 * the policy without a deploy; 0 means no bonus row is written.
 */
export function creditBonusBps() {
	return env.THREE_CREDIT_BONUS_BPS;
}

/** Public, non-secret config for clients to display and build transactions. */
export function publicConfig() {
	// Read path: surface treasury/rewards as null when unset rather than throwing.
	// The strict treasuryWallet()/rewardsWallet() guards stay on fund-routing only.
	const treasury = treasuryWalletOrNull();
	const rewards = rewardsWalletOrNull();
	return {
		mint: TOKEN_MINT,
		symbol: TOKEN_SYMBOL,
		decimals: TOKEN_DECIMALS,
		treasury,
		treasury_configured: treasury != null,
		// Holder reflections pool — receives the `rewards` leg of every split and is
		// distributed back to holders pro-rata by the rewards cron.
		rewards_wallet: rewards,
		rewards_configured: rewards != null,
		// Retained for the user-invoked burn primitive only; no platform split burns.
		burn_address: burnAddress(),
		quote_ttl_seconds: env.THREE_QUOTE_TTL_S,
		// Extra credits for paying in $THREE (bps of USD value); 0 = no bonus.
		credit_bonus_bps: creditBonusBps(),
		split_policies: Object.fromEntries(
			Object.entries(SPLIT_POLICIES).map(([k, legs]) => [
				k,
				legs.map((l) => ({ role: l.role, bps: l.bps })),
			]),
		),
	};
}
