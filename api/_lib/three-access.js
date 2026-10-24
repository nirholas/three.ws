// $THREE holder access registry — the hold-to-access lever's source of truth.
//
// A small, pure registry mapping a featureId → the minimum holder tier required
// to use it, plus holder-readable copy. It generalizes the per-skill $THREE gate
// (three-gate.js) and the per-coin world gate into one platform-wide table so the
// access endpoint, the gated endpoints, and the UI all agree on what each feature
// costs in *tier* terms.
//
// Two resolvers, by what the caller already knows:
//   • resolveAccess(user, featureId)      — reads the user's on-chain tier (async).
//   • accessFromTierLevel(level, feature)  — a pure level check for callers that
//     already hold a verified level (e.g. a signed tier pass), no I/O, no latency.
//
// Enforcement note: the authoritative entitlement carrier for *gating* a request
// is the signed tier pass (three-tier.js → verifyTierPass), which is pure-HMAC
// and never depends on a live RPC. resolveAccess() is for display/affordances and
// degrades a holder to Member on a price/RPC hiccup — so a transient outage can
// under-state a holder in the UI, but the pass path still lets them through.

import { TIERS, resolveUserTier } from './three-tier.js';

/** The TIERS entry for a level, clamped to a real tier (Member floor). */
function tierByLevel(level) {
	const n = Math.max(0, Number(level) || 0);
	let resolved = TIERS[0];
	for (const t of TIERS) if (t.level <= n) resolved = t;
	return resolved;
}

// featureId → { minLevel, enforced, label, why, payPerUse }.
//   minLevel   — the TIERS level a wallet must reach (1 = Bronze, …, 4 = Genesis).
//   enforced   — true when the gate is WIRED and live in the product right now
//                (a request for it is actually checked); false when the perk is
//                registered/planned but not yet enforced anywhere. The UI uses this
//                to mark a feature "Live" vs "Planned" so /three only ever promises
//                what it actually delivers — never an aspirational, unwired claim.
//   label      — holder-readable feature name.
//   why        — one line on why holding gates it (real cost / scarcity / status).
//   payPerUse  — catalog action id a non-holder may pay instead, or null when the
//                feature is hold-only. The price is attached by the caller from the
//                pricing catalog so this module stays dependency-free.
//
// Enforced today: `forge.high` (High-tier Forge gate in api/forge.js) and
// `forge.gameready` (engine-ready export gate in api/forge-gameready.js). The rest
// are planned. As each gate ships, flip its `enforced` to true (and add a test);
// nothing else changes — the access endpoint and /three pick it up automatically.
export const GATED_FEATURES = Object.freeze({
	'forge.high': Object.freeze({
		minLevel: 1,
		enforced: true, // gated in api/forge.js (High + platform backend) — see forge-high-gate.test.js
		label: 'High-quality generation (200k poly + PBR)',
		why: 'The High tier spends real GPU/vendor budget — holders fund it by holding, not draining.',
		payPerUse: 'forge.high',
	}),
	'forge.gameready': Object.freeze({
		minLevel: 1,
		enforced: true, // gated in api/forge-gameready.js — see tests/api/forge-gameready.test.js
		label: 'Game-Ready export (Unity/Unreal retopo + PBR)',
		why: 'Retopology + PBR re-bake runs the remesh GPU worker — holders fund it by holding, or pay per export.',
		payPerUse: 'forge.gameready',
	}),
	'forge.keep': Object.freeze({
		minLevel: 1,
		enforced: false, // live only when FORGE_PAY_TO_KEEP is on (api/forge-keep.js); off by default
		label: 'Keep a Forge generation (original file)',
		why: 'Generating on the free lanes costs nothing; keeping the original file is a holder perk, or a one-time $THREE payment.',
		payPerUse: null, // the price depends on the generation tier: forge.keep.<tier>
	}),
	'worlds.private': Object.freeze({
		minLevel: 2,
		enforced: false,
		label: 'Private, invite-only worlds',
		why: 'A persistent private space is a held perk, not a per-call cost.',
		payPerUse: null,
	}),
	'worlds.branded': Object.freeze({
		minLevel: 3,
		enforced: false,
		label: 'Branded worlds + custom environments',
		why: 'Custom-branded environments are a Gold-tier status perk.',
		payPerUse: null,
	}),
	'mcp.priority': Object.freeze({
		minLevel: 2,
		enforced: false,
		label: 'Priority MCP routing',
		why: 'Holders skip the shared queue on the MCP compute lanes.',
		payPerUse: null,
	}),
	'drops.early': Object.freeze({
		minLevel: 3,
		enforced: false,
		label: 'Early access to drops',
		why: 'Early windows on scarce drops reward the largest holders.',
		payPerUse: null,
	}),
	'names.first_dibs': Object.freeze({
		minLevel: 4,
		enforced: false,
		label: 'First dibs on rare *.threews.sol names',
		why: 'Genesis holders get the first window on the rarest names.',
		payPerUse: 'name.auction',
	}),
});

/** Look up a gated feature. Throws a typed 404 for an unknown id. */
export function gatedFeature(featureId) {
	const f = GATED_FEATURES[featureId];
	if (!f) {
		const err = new Error(`unknown gated feature: ${featureId}`);
		err.status = 404;
		err.code = 'unknown_feature';
		throw err;
	}
	return f;
}

/** The minimum TIERS entry required for a feature. */
export function requiredTierFor(featureId) {
	return tierByLevel(gatedFeature(featureId).minLevel);
}

/** Every registered gated-feature id. */
export function listGatedFeatures() {
	return Object.keys(GATED_FEATURES);
}

function publicTier(t) {
	// min_usd lets a client render a "held → required" progress bar and the 402
	// hold-or-pay path (require-three.js) compute usd_to_go without re-deriving the
	// ladder thresholds.
	return { level: t.level, id: t.id, label: t.label, min_usd: t.minUsd };
}

function reasonFor({ eligible, user, hasWallet }) {
	if (eligible) return 'eligible';
	if (!user) return 'sign_in';
	if (!hasWallet) return 'link_wallet';
	return 'insufficient_tier';
}

/**
 * Pure tier-level eligibility check — for callers that already hold a verified
 * level (e.g. a presented tier pass). No network, no DB.
 * @param {number} level    the holder's verified tier level (0 = Member)
 * @param {string} featureId
 */
export function accessFromTierLevel(level, featureId) {
	const f = gatedFeature(featureId);
	const required = tierByLevel(f.minLevel);
	const held = tierByLevel(level);
	const eligible = held.level >= f.minLevel;
	return {
		feature: featureId,
		label: f.label,
		why: f.why,
		enforced: f.enforced,
		eligible,
		required: publicTier(required),
		held: publicTier(held),
		pay_per_use: f.payPerUse,
		reason: eligible ? 'eligible' : 'insufficient_tier',
	};
}

/**
 * Resolve a session user's access to a gated feature from their on-chain $THREE
 * holdings. Never throws — degrades to the Member floor on any failure.
 * @param {object|null} user      session user ({ wallet_address, ... }) or null
 * @param {string} featureId
 * @returns {Promise<{ feature, label, why, enforced, eligible, required, held, pay_per_use, reason }>}
 */
export async function resolveAccess(user, featureId) {
	const f = gatedFeature(featureId);
	const required = tierByLevel(f.minLevel);
	const hasWallet = Boolean(user?.wallet_address);

	let held = TIERS[0];
	let usd = 0;
	if (hasWallet) {
		try {
			const r = await resolveUserTier(user);
			held = r.tier;
			usd = r.usd;
		} catch {
			held = TIERS[0];
			usd = 0;
		}
	}

	const eligible = held.level >= f.minLevel;
	return {
		feature: featureId,
		label: f.label,
		why: f.why,
		enforced: f.enforced,
		eligible,
		required: publicTier(required),
		held: { ...publicTier(held), usd: Math.round((Number(usd) || 0) * 100) / 100 },
		pay_per_use: f.payPerUse,
		reason: reasonFor({ eligible, user, hasWallet }),
	};
}
