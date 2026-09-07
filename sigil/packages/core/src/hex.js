/**
 * The probability distribution of hex-encoded EVM addresses.
 *
 * Part of Sigil (https://github.com/nirholas/sigil). Apache-2.0.
 *
 * ── Why this is simpler than Base58 ──────────────────────────────────────────
 * A Solana address is a *numeral* (a 256-bit integer rendered in Base58), so its
 * leading character is not uniform. An EVM address is not a numeral: it is the
 * low 20 bytes of a Keccak-256 digest, rendered as a fixed 40-character hex
 * string with no length variance and no leading-zero stripping. Every one of the
 * 40 nibbles is independently uniform over 16 symbols, at both ends. So the
 * honest model here really is 16⁻ⁿ, and `0x0000…` is exactly as hard as
 * `0xdead…`: 65 536 expected attempts for four nibbles, either way.
 *
 * That holds for all three EVM address derivations Sigil grinds:
 *
 *   EOA      address = keccak256(uncompressed pubkey[1:])[12:]
 *   CREATE   address = keccak256(rlp([sender, nonce]))[12:]
 *   CREATE2  address = keccak256(0xff ‖ deployer ‖ salt ‖ initCodeHash)[12:]
 *
 * ── The case dimension (EIP-55) ──────────────────────────────────────────────
 * EIP-55 re-cases the hex letters of an address using bits of
 * keccak256(lowercase address), which behave as fair coin flips. Asking for a
 * *specific* case spelling therefore costs an extra factor of two per letter in
 * the pattern: `dead` (4 letters) is 16 times harder to hit as `dEaD` than as
 * any-case `dead`. Digits 0-9 carry no case and cost nothing extra.
 *
 * That is the single most misquoted number in EVM vanity tooling: a mixed-case
 * request is not "the same speed", it is 2^letters harder, and Sigil prices and
 * ETAs say so.
 *
 * Pure and isomorphic: no I/O, no crypto, identical in browser and server.
 */

export const HEX_ALPHABET = '0123456789abcdef';

const HEX_SET = new Set([...'0123456789abcdefABCDEF']);
const LETTER_SET = new Set([...'abcdefABCDEF']);

/** Every EVM address is 20 bytes = 40 hex nibbles. */
export const EVM_ADDRESS_NIBBLES = 40;

/** @param {string} s @returns {boolean} */
export function isHexPattern(s) {
	if (typeof s !== 'string') return false;
	for (const ch of s) if (!HEX_SET.has(ch)) return false;
	return true;
}

/**
 * Count the case-carrying characters (a-f) in a pattern. Each one doubles the
 * work when the match is case-sensitive (EIP-55).
 * @param {string} pattern
 * @returns {number}
 */
export function letterCount(pattern) {
	let n = 0;
	for (const ch of pattern || '') if (LETTER_SET.has(ch)) n++;
	return n;
}

/**
 * Probability that a uniformly random EVM address starts with `prefix`.
 * @param {string} prefix hex characters, without the `0x`
 * @param {boolean} [caseSensitive=false] match EIP-55 casing exactly
 * @returns {number} probability in [0, 1]; 0 when the prefix is unreachable
 */
export function prefixProbability(prefix, caseSensitive = false) {
	return sideProbability(prefix, caseSensitive);
}

/**
 * Probability that a uniformly random EVM address ends with `suffix`.
 * Identical model to the prefix: every nibble is uniform.
 * @param {string} suffix hex characters, without the `0x`
 * @param {boolean} [caseSensitive=false]
 * @returns {number} probability in [0, 1]
 */
export function suffixProbability(suffix, caseSensitive = false) {
	return sideProbability(suffix, caseSensitive);
}

/**
 * @param {string} side
 * @param {boolean} caseSensitive
 * @returns {number}
 */
function sideProbability(side, caseSensitive) {
	if (!side) return 1;
	if (!isHexPattern(side)) return 0;
	if (side.length > EVM_ADDRESS_NIBBLES) return 0;
	const base = Math.pow(16, -side.length);
	return caseSensitive ? base * Math.pow(2, -letterCount(side)) : base;
}

/**
 * Probability that a random EVM address satisfies both ends of a pattern.
 *
 * Prefix and suffix cover disjoint nibbles as long as they fit inside the 40
 * available, so the two probabilities simply multiply. A pattern longer than the
 * address is unreachable and scores 0.
 *
 * @param {object} pattern
 * @param {string} [pattern.prefix]
 * @param {string} [pattern.suffix]
 * @param {boolean} [pattern.caseSensitive=false]
 * @returns {number} probability in [0, 1]
 */
export function patternProbability({ prefix = '', suffix = '', caseSensitive = false } = {}) {
	if ((prefix?.length || 0) + (suffix?.length || 0) > EVM_ADDRESS_NIBBLES) return 0;
	return sideProbability(prefix || '', caseSensitive) * sideProbability(suffix || '', caseSensitive);
}

/**
 * How much harder a case-sensitive (EIP-55) spelling is than the any-case one.
 * @param {object} pattern
 * @param {string} [pattern.prefix]
 * @param {string} [pattern.suffix]
 * @returns {number} multiplier ≥ 1
 */
export function caseSensitivityCost({ prefix = '', suffix = '' } = {}) {
	return Math.pow(2, letterCount(prefix) + letterCount(suffix));
}
