/**
 * Base58 validation for Solana vanity prefixes/suffixes.
 *
 * Algorithm ported from nirholas/solana-wallet-toolkit
 * (typescript/src/lib/validation.ts). The toolkit excludes the four
 * commonly-confused characters (0, O, I, l) per the Bitcoin/Solana
 * Base58 alphabet.
 */

export const BASE58_ALPHABET =
	'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const BASE58_CHARS = new Set(BASE58_ALPHABET);

const CONFUSED = {
	'0': '0 (zero) — use 1-9',
	O:   'O (uppercase o) — use other uppercase letters',
	I:   'I (uppercase i) — use other uppercase letters',
	l:   'l (lowercase L) — use other lowercase letters',
};

/** Hard ceiling regardless of paywall — past this, grinding is unrealistic in-browser. */
export const MAX_PATTERN_LENGTH = 6;

/** Length below which vanity is free; >= FREE_THRESHOLD requires the paid product. */
export const FREE_THRESHOLD = 5;

/**
 * Validate a vanity pattern (prefix or suffix).
 * @param {string} pattern
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePattern(pattern) {
	const errors = [];
	if (typeof pattern !== 'string' || pattern.length === 0) {
		return { valid: false, errors: ['pattern is empty'] };
	}
	if (pattern !== pattern.trim()) {
		errors.push('pattern has leading or trailing whitespace');
	}
	if (pattern.length > MAX_PATTERN_LENGTH) {
		errors.push(`length ${pattern.length} exceeds maximum of ${MAX_PATTERN_LENGTH}`);
	}
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		if (!BASE58_CHARS.has(c)) {
			const hint = CONFUSED[c];
			errors.push(`invalid character '${c}' at position ${i + 1}${hint ? ` — ${hint}` : ''}`);
		}
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Estimate expected attempts to find a Base58 prefix of the given length.
 * @param {number} length
 * @returns {number}
 */
export function estimateAttempts(length) {
	return Math.pow(58, length);
}

/**
 * Format a duration estimate (seconds) as a human string.
 * @param {number} attempts expected attempts
 * @param {number} ratePerSecond combined rate across worker pool
 * @returns {string}
 */
export function formatTimeEstimate(attempts, ratePerSecond) {
	if (!ratePerSecond || ratePerSecond <= 0) return 'unknown';
	const seconds = attempts / ratePerSecond;
	if (seconds < 1)        return 'less than a second';
	if (seconds < 60)       return `~${Math.round(seconds)} seconds`;
	if (seconds < 3600)     return `~${Math.round(seconds / 60)} minutes`;
	if (seconds < 86400)    return `~${Math.round(seconds / 3600)} hours`;
	if (seconds < 31536000) return `~${Math.round(seconds / 86400)} days`;
	return `~${Math.round(seconds / 31536000)} years`;
}
