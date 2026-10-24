// Forge cost preview: what one generation would cost, per lane and options,
// computed from the same tables the generation endpoint enforces. Nothing here
// is a second copy of a price: tier and export prices come from forge-tiers.js
// through the pricing catalog (pricing/catalog.js), the gate rule mirrors the
// High-tier gate in api/forge.js, and the lane choice is the real resolver.
// Pure and spend-free: no database, no network, no wallet. The one env read is
// the lane-configured flags the resolver already depends on.
//
// Pay-to-keep (api/forge-keep.js) is OFF unless FORGE_PAY_TO_KEEP is on. With it
// off the quote reports `keep.enabled: false` and behaviour is unchanged.

import {
	BACKENDS,
	OUTPUTS,
	PATHS,
	DEFAULT_PATH,
	TIER_IDS,
	DEFAULT_TIER,
	resolveTier,
	resolveBackendId,
	backendIsConfigured,
	estimateEtaSeconds,
	estimateCredits,
	outputIsConfigured,
} from './forge-tiers.js';
import { laneAllowedInTerritory } from './forge-territory.js';
import { priceForAction } from './pricing/catalog.js';
import { requiredTierFor } from './three-access.js';

const ON = new Set(['1', 'on', 'true', 'yes', 'enabled']);

/** True when the owner has switched pay-to-keep on (FORGE_PAY_TO_KEEP). */
export function payToKeepEnabled(env = process.env) {
	return ON.has(String(env?.FORGE_PAY_TO_KEEP ?? '').trim().toLowerCase());
}

/**
 * The catalog action a non-holder pays to keep a generation of this tier, or null
 * when the tier needs none: High is already paid for or held at generation time.
 */
export function keepActionForTier(tierId) {
	return tierId === 'draft' || tierId === 'standard' ? `forge.keep.${tierId}` : null;
}

function usdFor(action) {
	const n = Number(priceForAction(action).usd);
	return Number.isFinite(n) ? n : null;
}

function round2(n) {
	return Math.round(n * 100) / 100;
}

/**
 * @param {object} p
 * @param {string} [p.path]       image | geometry | sketch
 * @param {string} [p.tier]       draft | standard | high
 * @param {string} [p.backend]    explicit lane id (otherwise the default router)
 * @param {boolean} [p.userImages] the request carries reference photos
 * @param {boolean} [p.ownKey]    the caller supplies their own vendor key
 * @param {boolean} [p.gameready] include the Game-Ready export add-on
 * @param {string|null} [p.country] requester country (edge geo), for territory routing
 * @param {object} [p.env]
 */
export function buildForgeQuote({
	path,
	tier,
	backend,
	userImages = false,
	ownKey = false,
	gameready = false,
	country = null,
	env = process.env,
} = {}) {
	const p = PATHS.includes(path) ? path : DEFAULT_PATH;
	const t = resolveTier(TIER_IDS.includes(tier) ? tier : DEFAULT_TIER);
	const backendId = resolveBackendId({ path: p, tier: t, backend, userImages, country });
	const b = BACKENDS[backendId];
	const notes = [];

	const houseKey = Boolean(b?.houseKeyEnv && env?.[b.houseKeyEnv]);
	const usesCallerKey = Boolean(b?.byok) && (ownKey || !houseKey);
	const gated = t.id === 'high' && (b?.byok === false || (Boolean(b?.byok) && houseKey && !ownKey));

	let model = 'free';
	let generationUsd = 0;
	let gateFeature = null;
	if (usesCallerKey) {
		model = 'byok';
		notes.push('This engine bills your own vendor key. three.ws charges nothing for it.');
	} else if (gated) {
		model = 'hold_or_pay';
		generationUsd = usdFor('forge.high') ?? 0;
		const req = requiredTierFor('forge.high');
		gateFeature = { id: 'forge.high', holder_tier: req.id, holder_tier_label: req.label, holder_min_usd: req.minUsd };
		notes.push(`$THREE holders (${req.label} and above) generate High for free. Everyone else pays once per generation.`);
	} else {
		notes.push('Free on this engine. No payment is requested.');
	}

	if (b && country !== null && !laneAllowedInTerritory(backendId, country)) {
		notes.push('This engine is not available in your region; the router picks another lane.');
	}

	const keepEnabled = payToKeepEnabled(env);
	const keepAction = keepActionForTier(t.id);
	const keepApplies = keepEnabled && keepAction !== null && model !== 'byok';
	const keepUsd = keepApplies ? usdFor(keepAction) : null;
	if (keepApplies) {
		notes.push('Previewing is free. Keeping the original file is a one-time $THREE payment, free for holders.');
	}

	const gr = OUTPUTS.gameready;
	const grUsd = gameready ? usdFor('forge.gameready') : null;

	const parts = [generationUsd, keepUsd ?? 0, grUsd ?? 0];
	const totalUsd = round2(parts.reduce((a, n) => a + n, 0));

	return {
		path: p,
		tier: { id: t.id, label: t.label, polycount: t.polycount, pbr: t.pbr, hd: t.hd },
		backend: b
			? {
					id: b.id,
					label: b.label,
					vendor: b.vendor,
					free: Boolean(b.free),
					byok: b.byok || null,
					configured: backendIsConfigured(b.id),
					territory_ok: country === null ? null : laneAllowedInTerritory(b.id, country),
				}
			: null,
		eta_seconds: b ? estimateEtaSeconds({ backendId: b.id, tier: t }) : null,
		generation: {
			model,
			usd: generationUsd,
			action: model === 'hold_or_pay' ? 'forge.high' : null,
			gate: gateFeature,
			vendor_credits: usesCallerKey ? estimateCredits({ backendId, path: p, tier: t }) : null,
			x402_usdc: round2(t.priceUsdcAtomics / 1_000_000),
		},
		keep: {
			enabled: keepEnabled,
			applies: keepApplies,
			action: keepApplies ? keepAction : null,
			usd: keepUsd,
		},
		gameready: gameready
			? { usd: grUsd, action: 'forge.gameready', configured: outputIsConfigured('gameready'), eta_seconds: gr.baseEta }
			: null,
		total_usd: totalUsd,
		currency: 'USD',
		settles_in: '$THREE',
		holders_pay_usd: 0,
		notes,
	};
}

/** Every tier quoted for one lane choice: the table the Forge composer renders. */
export function buildForgeQuoteTable(opts = {}) {
	return TIER_IDS.map((id) => buildForgeQuote({ ...opts, tier: id }));
}
