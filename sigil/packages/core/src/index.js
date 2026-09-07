/**
 * @three-ws/sigil-core: the shared math behind every Sigil grinder.
 *
 * Part of Sigil (https://github.com/nirholas/sigil). Apache-2.0.
 *
 * ```js
 * import { quote } from '@three-ws/sigil-core';
 *
 * const q = quote({ space: 'solana', prefix: 'sig', suffix: 'il' });
 * q.rarity.label;              // 'Epic'
 * q.difficulty.p90;            // attempts for a 90% chance
 * ```
 */

export {
	BASE58_ALPHABET,
	caseVariants,
	prefixProbability as base58PrefixProbability,
	suffixProbability as base58SuffixProbability,
	patternProbability as base58PatternProbability,
	LEADING_CHAR_PROBABILITY,
	leadingCharDifficultyRatio,
} from './base58.js';

export {
	HEX_ALPHABET,
	EVM_ADDRESS_NIBBLES,
	isHexPattern,
	letterCount,
	prefixProbability as hexPrefixProbability,
	suffixProbability as hexSuffixProbability,
	patternProbability as hexPatternProbability,
	caseSensitivityCost,
} from './hex.js';

export {
	SPACES,
	MAX_PATTERN_LENGTH,
	parsePattern,
	createMatcher,
	patternKey,
	parsePatternKey,
	describePattern,
} from './pattern.js';

export {
	DIFFICULTY_MODELS,
	probability,
	expectedAttempts,
	attemptsForConfidence,
	probabilityAfter,
	etaSeconds,
	difficulty,
	formatDuration,
	formatAttempts,
} from './difficulty.js';

export { TIERS, tierFor, rarityScore, machineCost, rarity } from './rarity.js';

import { parsePattern, describePattern, patternKey } from './pattern.js';
import { difficulty } from './difficulty.js';
import { rarity } from './rarity.js';

/**
 * Parse a request and price it in one call: the shape every Sigil surface
 * (site, CLI, MCP tool, HTTP API) hands back.
 *
 * @param {object} input see {@link parsePattern}
 * @param {object} [opts]
 * @param {number} [opts.attemptsPerSecond] measured rate, adds wall-clock ETAs
 * @param {number} [opts.usdPerCoreHour]
 * @returns {{ ok: boolean, errors: string[], pattern: import('./pattern.js').Pattern,
 *   key: string, describe: string,
 *   difficulty: ReturnType<typeof difficulty>, rarity: ReturnType<typeof rarity> }}
 */
export function quote(input, opts = {}) {
	const parsed = parsePattern(input);
	const d = difficulty(parsed.pattern, opts);
	return {
		ok: parsed.ok,
		errors: parsed.errors,
		pattern: parsed.pattern,
		key: patternKey(parsed.pattern),
		describe: describePattern(parsed.pattern),
		difficulty: d,
		rarity: rarity(d, opts),
	};
}
