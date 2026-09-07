/**
 * Difficulty, ETA and confidence math shared by every Sigil grinder.
 *
 * Part of Sigil (https://github.com/nirholas/sigil). Apache-2.0.
 *
 * Grinding is a geometric process: each attempt is an independent Bernoulli
 * trial with success probability `p`, so the honest answers are
 *
 *     expected attempts        1 / p
 *     median (50% confidence)  ln(0.5) / ln(1 - p)
 *     n attempts get you       1 - (1 - p)ⁿ
 *
 * Most vanity tools show only the expected value and let users believe it is a
 * deadline. It is not: at the expected attempt count you have had a 63.2% chance
 * of finishing, and one run in twenty takes three times as long. Sigil reports
 * p50/p90/p99 alongside the mean everywhere, because a buyer deciding whether to
 * pay for a grind needs the tail, not the average.
 *
 * Models are versioned and named in every quote and certificate, so an
 * attestation issued under an older model still verifies against the model it
 * was issued under.
 */

import { patternProbability as base58Probability } from './base58.js';
import { patternProbability as hexProbability, caseSensitivityCost } from './hex.js';

/** Difficulty model identifiers, embedded in quotes and certificates. */
export const DIFFICULTY_MODELS = Object.freeze({
	solana: 'sigil-base58-exact/v1',
	evm: 'sigil-hex-uniform/v1',
});

/**
 * Exact probability that one random address in the pattern's space matches.
 * @param {import('./pattern.js').Pattern} pattern
 * @returns {number} probability in [0, 1]
 */
export function probability(pattern) {
	if (!pattern) return 0;
	if (pattern.space === 'evm') {
		return hexProbability({
			prefix: pattern.prefix,
			suffix: pattern.suffix,
			caseSensitive: pattern.caseSensitive,
		});
	}
	return base58Probability({
		prefix: pattern.prefix,
		suffix: pattern.suffix,
		ignoreCase: !pattern.caseSensitive,
	});
}

/**
 * Mean number of attempts before a hit. `Infinity` for an unreachable pattern.
 * @param {number} p
 * @returns {number}
 */
export function expectedAttempts(p) {
	if (!(p > 0)) return Infinity;
	return 1 / p;
}

/**
 * Attempts needed for a given probability of having found a match.
 * @param {number} p per-attempt probability
 * @param {number} confidence in (0, 1), e.g. 0.5 for the median
 * @returns {number}
 */
export function attemptsForConfidence(p, confidence) {
	if (!(p > 0)) return Infinity;
	if (!(confidence > 0 && confidence < 1)) throw new RangeError('confidence must be in (0, 1)');
	if (p >= 1) return 1;
	return Math.log(1 - confidence) / Math.log(1 - p);
}

/**
 * Probability of having found a match after `attempts` tries.
 * @param {number} p
 * @param {number} attempts
 * @returns {number}
 */
export function probabilityAfter(p, attempts) {
	if (!(p > 0)) return 0;
	if (!(attempts > 0)) return 0;
	return 1 - Math.pow(1 - p, attempts);
}

/**
 * Seconds to reach a confidence level at a measured hash rate.
 * @param {number} p
 * @param {number} attemptsPerSecond
 * @param {number} [confidence=0.5]
 * @returns {number}
 */
export function etaSeconds(p, attemptsPerSecond, confidence = 0.5) {
	if (!(attemptsPerSecond > 0)) return Infinity;
	return attemptsForConfidence(p, confidence) / attemptsPerSecond;
}

/**
 * The full difficulty picture for a pattern, ready to render.
 *
 * @param {import('./pattern.js').Pattern} pattern
 * @param {object} [opts]
 * @param {number} [opts.attemptsPerSecond] measured rate, to add wall-clock ETAs
 * @returns {{
 *   model: string, probability: number, expectedAttempts: number,
 *   p50: number, p90: number, p99: number,
 *   caseCost: number,
 *   eta?: { p50: number, p90: number, p99: number, attemptsPerSecond: number }
 * }}
 */
export function difficulty(pattern, opts = {}) {
	const p = probability(pattern);
	const out = {
		model: DIFFICULTY_MODELS[pattern.space] || DIFFICULTY_MODELS.solana,
		probability: p,
		expectedAttempts: expectedAttempts(p),
		p50: attemptsForConfidence(p, 0.5),
		p90: attemptsForConfidence(p, 0.9),
		p99: attemptsForConfidence(p, 0.99),
		caseCost: pattern.space === 'evm' && pattern.caseSensitive
			? caseSensitivityCost({ prefix: pattern.prefix, suffix: pattern.suffix })
			: 1,
	};
	const rate = opts.attemptsPerSecond;
	if (rate > 0) {
		out.eta = {
			attemptsPerSecond: rate,
			p50: out.p50 / rate,
			p90: out.p90 / rate,
			p99: out.p99 / rate,
		};
	}
	return out;
}

const UNITS = [
	[1, 'second'], [60, 'minute'], [3600, 'hour'], [86400, 'day'],
	[86400 * 365.25, 'year'], [86400 * 365.25 * 1000, 'millennium'],
];

/**
 * Human duration: "12 seconds", "3.4 hours", "longer than the universe".
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
	if (!Number.isFinite(seconds)) return 'never';
	if (seconds < 1) return 'under a second';
	if (seconds > 86400 * 365.25 * 13.8e9) return 'longer than the universe has existed';
	let unit = UNITS[0];
	for (const u of UNITS) if (seconds >= u[0]) unit = u;
	const value = seconds / unit[0];
	const rounded = value >= 100 ? Math.round(value) : Number(value.toPrecision(2));
	const label = unit[1] === 'millennium' ? (rounded === 1 ? 'millennium' : 'millennia') : unit[1];
	return `${rounded.toLocaleString('en-US')} ${label}${unit[1] !== 'millennium' && rounded !== 1 ? 's' : ''}`;
}

/**
 * Human attempt count: "65.5 thousand", "1.2 billion".
 * @param {number} n
 * @returns {string}
 */
export function formatAttempts(n) {
	if (!Number.isFinite(n)) return 'unreachable';
	const steps = [
		[1e18, 'quintillion'], [1e15, 'quadrillion'], [1e12, 'trillion'],
		[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'],
	];
	for (const [size, label] of steps) {
		if (n >= size) return `${Number((n / size).toPrecision(3)).toLocaleString('en-US')} ${label}`;
	}
	return Math.round(n).toLocaleString('en-US');
}
