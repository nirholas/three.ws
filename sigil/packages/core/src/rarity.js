/**
 * Rarity tiers and a cross-chain rarity score.
 *
 * Part of Sigil (https://github.com/nirholas/sigil). Apache-2.0.
 *
 * Difficulty is the honest number, but "1 in 656 356 768" means nothing to a
 * buyer looking at two addresses side by side. The score below maps expected
 * attempts onto a 0-100 scale that is *comparable across address spaces*: a
 * Solana address and an EVM address with the same score cost the same expected
 * work, even though one is Base58 and the other hex.
 *
 * The scale is logarithmic because the underlying quantity is: every extra
 * character multiplies the work by 16 (hex) or ~58 (Base58), so a linear score
 * would put every interesting address in the top percent. 100 is pinned at
 * 10^18 expected attempts, roughly the point where a single machine cannot
 * finish inside a human lifetime and only a pool can.
 */

/** @typedef {'common'|'uncommon'|'rare'|'epic'|'legendary'|'mythic'} Tier */

/** Tier thresholds, in expected attempts. Ordered hardest-first for lookup. */
export const TIERS = Object.freeze([
	{ tier: 'mythic', minAttempts: 1e12, label: 'Mythic' },
	{ tier: 'legendary', minAttempts: 1e9, label: 'Legendary' },
	{ tier: 'epic', minAttempts: 1e7, label: 'Epic' },
	{ tier: 'rare', minAttempts: 1e5, label: 'Rare' },
	{ tier: 'uncommon', minAttempts: 1e3, label: 'Uncommon' },
	{ tier: 'common', minAttempts: 0, label: 'Common' },
]);

/**
 * @param {number} expectedAttempts
 * @returns {{ tier: Tier, label: string, minAttempts: number }}
 */
export function tierFor(expectedAttempts) {
	if (!Number.isFinite(expectedAttempts)) return { tier: 'mythic', label: 'Mythic', minAttempts: 1e12 };
	for (const t of TIERS) if (expectedAttempts >= t.minAttempts) return t;
	return TIERS[TIERS.length - 1];
}

/** The score at which the scale saturates: 10^18 expected attempts. */
const SCORE_CEILING_LOG10 = 18;

/**
 * A 0-100 rarity score, comparable across chains.
 * @param {number} expectedAttempts
 * @returns {number} rounded to one decimal
 */
export function rarityScore(expectedAttempts) {
	if (!Number.isFinite(expectedAttempts) || expectedAttempts <= 1) return 0;
	const raw = (Math.log10(expectedAttempts) / SCORE_CEILING_LOG10) * 100;
	return Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;
}

/**
 * What the grind would cost in machine time, priced from a reference rate.
 *
 * Defaults describe one commodity cloud vCPU running the Sigil WASM grinder:
 * ~1.1 M attempts/second measured on a Cloud Run 1-vCPU instance, at the current
 * spot price for that vCPU-hour. Both are inputs, not hidden constants: pass
 * your own to price against your own fleet.
 *
 * @param {number} expectedAttempts
 * @param {object} [opts]
 * @param {number} [opts.attemptsPerSecond=1_100_000]
 * @param {number} [opts.usdPerCoreHour=0.0113]
 * @returns {{ coreHours: number, usd: number, attemptsPerSecond: number, usdPerCoreHour: number }}
 */
export function machineCost(expectedAttempts, opts = {}) {
	const attemptsPerSecond = opts.attemptsPerSecond ?? 1_100_000;
	const usdPerCoreHour = opts.usdPerCoreHour ?? 0.0113;
	const coreHours = expectedAttempts / attemptsPerSecond / 3600;
	return {
		coreHours,
		usd: coreHours * usdPerCoreHour,
		attemptsPerSecond,
		usdPerCoreHour,
	};
}

/**
 * The full rarity picture for a difficulty result.
 * @param {{ expectedAttempts: number }} difficultyResult
 * @param {object} [costOpts] forwarded to {@link machineCost}
 * @returns {{ tier: Tier, label: string, score: number, expectedAttempts: number, cost: ReturnType<typeof machineCost> }}
 */
export function rarity(difficultyResult, costOpts) {
	const attempts = difficultyResult.expectedAttempts;
	const t = tierFor(attempts);
	return {
		tier: t.tier,
		label: t.label,
		score: rarityScore(attempts),
		expectedAttempts: attempts,
		cost: machineCost(attempts, costOpts),
	};
}
