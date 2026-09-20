// $THREE holder tiers — the hold-to-access lever.
//
// HOLD (don't spend) $THREE to unlock platform-wide perks: a fee discount on
// pay-per-use compute, higher free quotas (rate-limit multiplier), private/branded
// worlds, priority routing, and early access. Holding removes float and rewards
// bag size without depleting it — the deflation-free status lever.
//
// A tier is resolved from the USD VALUE a wallet currently holds of $THREE (priced
// live), generalizing the per-coin holder-pass (api/_lib/holder-pass.js) to the
// whole platform. This module is the single source of truth for the thresholds,
// the perk curve, and the (signed) tier pass the multiplayer server verifies.
//
// Reads degrade gracefully: a wallet that can't be priced resolves to the free
// Member tier rather than throwing — a balance hiccup must never block a charge.

import crypto from 'node:crypto';
import { getBalances } from './balances.js';
import { getTokenPriceUsd } from './token/price.js';
import { TOKEN_MINT } from './token/config.js';

// ── Tier ladder ─────────────────────────────────────────────────────────────────
// Ordered low→high. `minUsd` is the USD value of $THREE held to reach the tier.
// `discountBps` is the fee discount on fixed-price compute. `rateMultiplier`
// scales free quotas.
//
// `perks` lists ONLY what a holder gets today. Anything registered but not yet
// enforced belongs in `planned`, never in `perks`: a tier that lists an unbuilt
// feature as a flat benefit is a roadmap wearing a price tag, and every surface
// that renders the ladder (/three, GET /api/pricing, GET /api/three/tier) would
// repeat that promise unqualified. When a gate ships, flip its `enforced` in
// three-access.js and move its line from `planned` to `perks` in the same change.
//
// Thresholds/curve are tunable knobs (see plan): starting points chosen so the
// entry tier is reachable and the top tier is aspirational.
export const TIERS = Object.freeze([
	Object.freeze({
		level: 0,
		id: 'member',
		label: 'Member',
		minUsd: 0,
		discountBps: 0,
		rateMultiplier: 1,
		perks: Object.freeze(['Everything free-forever: create, discover, embed, social, basic worlds']),
		planned: Object.freeze([]),
	}),
	Object.freeze({
		level: 1,
		id: 'bronze',
		label: 'Bronze',
		minUsd: 25,
		discountBps: 500, // 5% off compute
		rateMultiplier: 2,
		perks: Object.freeze(['5% off all $THREE compute', '2× free generation quota', 'Bronze profile badge']),
		planned: Object.freeze([]),
	}),
	Object.freeze({
		level: 2,
		id: 'silver',
		label: 'Silver',
		minUsd: 100,
		discountBps: 1000, // 10%
		rateMultiplier: 3,
		perks: Object.freeze(['10% off all $THREE compute', '3× free generation quota']),
		planned: Object.freeze(['Private worlds', 'Priority MCP routing']),
	}),
	Object.freeze({
		level: 3,
		id: 'gold',
		label: 'Gold',
		minUsd: 500,
		discountBps: 2000, // 20%
		rateMultiplier: 5,
		perks: Object.freeze(['20% off all $THREE compute', '5× free generation quota']),
		planned: Object.freeze(['Branded worlds + custom environments', 'Early access to drops']),
	}),
	Object.freeze({
		level: 4,
		id: 'genesis',
		label: 'Genesis',
		minUsd: 2500,
		discountBps: 3000, // 30%
		rateMultiplier: 10,
		perks: Object.freeze(['30% off all $THREE compute', '10× free generation quota']),
		planned: Object.freeze(['First dibs on rare names + collectibles', 'Genesis-only cosmetics']),
	}),
]);

/** Resolve the tier for a given USD value held. Always returns a tier (Member floor). */
export function tierForUsd(usdHeld) {
	const usd = Number(usdHeld) || 0;
	let resolved = TIERS[0];
	for (const t of TIERS) if (usd >= t.minUsd) resolved = t;
	return resolved;
}

/** The next tier up from a given one, or null at the top. */
export function nextTier(tier) {
	return TIERS.find((t) => t.level === tier.level + 1) || null;
}

function isSolanaAddress(s) {
	return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

/**
 * Read the USD value of $THREE a wallet holds. Never throws — returns 0 on any
 * failure so callers degrade to the free Member tier rather than erroring.
 * @returns {Promise<{ usd: number, amount: number, priceUsd: number }>}
 */
export async function holderUsd(walletAddress) {
	if (!isSolanaAddress(walletAddress)) return { usd: 0, amount: 0, priceUsd: 0 };
	try {
		const balances = await getBalances({ chain: 'solana', address: walletAddress });
		const entry = (balances?.tokens ?? []).find((t) => t.mint === TOKEN_MINT);
		const amount = entry?.amount || 0;
		if (amount <= 0) return { usd: 0, amount: 0, priceUsd: 0 };
		// Prefer the price the balance read already resolved; fall back to the
		// dedicated $THREE price feed so the tier is correct even if the portfolio
		// pricer skipped this mint.
		let priceUsd = entry?.price > 0 ? entry.price : 0;
		if (!(priceUsd > 0)) {
			const p = await getTokenPriceUsd();
			priceUsd = p?.priceUsd || 0;
		}
		const usd = entry?.usd > 0 ? entry.usd : amount * priceUsd;
		return { usd, amount, priceUsd };
	} catch {
		return { usd: 0, amount: 0, priceUsd: 0 };
	}
}

/**
 * Resolve a session user's $THREE tier from their linked wallet. Never throws.
 * @returns {Promise<{ tier: object, usd: number, amount: number, priceUsd: number, next: object|null }>}
 */
export async function resolveUserTier(user) {
	const wallet = user?.wallet_address || null;
	const { usd, amount, priceUsd } = await holderUsd(wallet);
	const tier = tierForUsd(usd);
	return { tier, usd, amount, priceUsd, next: nextTier(tier) };
}

/** Fee discount (bps) for a user's current tier. Never throws → 0 on failure. */
export async function holderDiscountBps(user) {
	try {
		const { tier } = await resolveUserTier(user);
		return tier.discountBps;
	} catch {
		return 0;
	}
}

// ── Signed tier pass ─────────────────────────────────────────────────────────────
// Generalizes the holder-pass HMAC (byte-compatible construction) so the
// multiplayer/Colyseus server can gate private/branded worlds on a tier without a
// Solana RPC or price feed of its own. Format: b64url(JSON(payload)).b64url(HMAC).

const PASS_TTL_S = 10 * 60;
const DEV_SECRET = 'three-ws-holder-pass-dev-secret';

let _warned = false;
function secret() {
	const s = process.env.HOLDER_PASS_SECRET;
	if (s) return s;
	if (process.env.NODE_ENV === 'production') {
		throw new Error(
			'[three-tier] HOLDER_PASS_SECRET is required in production — refusing to mint tier passes with the dev secret.',
		);
	}
	if (!_warned) {
		_warned = true;
		console.warn('[three-tier] HOLDER_PASS_SECRET not set — using insecure dev secret.');
	}
	return DEV_SECRET;
}

function b64url(buf) {
	return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function hmac(body) {
	return b64url(crypto.createHmac('sha256', secret()).update(body).digest());
}

/**
 * Seal a resolved tier into a signed pass. The level + USD are signed so a game
 * server can gate (e.g. "Silver+ worlds") and display the real tier without
 * trusting a client value.
 * @param {{ wallet: string, level: number, tierId: string, usd: number }} claims
 */
export function signTierPass({ wallet, level, tierId, usd }) {
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		kind: 'three-tier',
		wallet,
		level: Math.max(0, Number(level) || 0),
		tierId,
		usd: Math.round((Number(usd) || 0) * 100) / 100,
		iat: now,
		exp: now + PASS_TTL_S,
	};
	const body = b64url(JSON.stringify(payload));
	return `${body}.${hmac(body)}`;
}

/**
 * Verify a tier pass (signature + expiry). Returns the payload or null. Mirrors
 * the multiplayer verifier; safe to use server-side to re-check a presented pass.
 */
export function verifyTierPass(token) {
	if (typeof token !== 'string' || !token.includes('.')) return null;
	const [body, sig] = token.split('.');
	if (!body || !sig) return null;
	const expected = hmac(body);
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
	let payload;
	try {
		payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
	} catch {
		return null;
	}
	if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
	if (payload.kind !== 'three-tier') return null;
	return payload;
}
