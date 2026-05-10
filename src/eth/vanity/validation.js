/**
 * Validation for Ethereum CREATE2 vanity grinding.
 *
 * Pattern grammar
 * ───────────────
 * Hex chars [0-9a-fA-F]. The casing of the user's pattern selects the
 * matching mode:
 *
 *   • all lowercase  → case-INsensitive match against the lowercase address.
 *                      Fastest — no extra hashing per attempt.
 *   • any uppercase  → case-SENSITIVE match against the EIP-55 checksummed
 *                      address. ~16× rarer per char; +1 keccak per attempt.
 *
 * CREATE2 derivation (EIP-1014):
 *   address = keccak256(0xff ‖ deployer ‖ salt ‖ keccak256(initCode))[12:]
 *
 * The grinder samples random `salt` values; `deployer` and `initCodeHash`
 * are fixed per session. Result is a deterministic smart-contract address —
 * the standard pattern used by Safe, ERC-4337 SimpleAccount, Coinbase Smart
 * Wallet, CreateX, the Arachnid deterministic-deployment-proxy, etc.
 */

import { keccak_256 } from '@noble/hashes/sha3';

const HEX_ANY  = /^[0-9a-fA-F]+$/;
const HEX_LOW  = /^[0-9a-f]+$/;

/** 20 hex chars (40 nibbles) is the entire address — anything past that is impossible. */
export const MAX_PATTERN_LENGTH = 10;

/** Below this, grinding finishes in seconds on a laptop; >= this hits minutes+. */
export const FREE_THRESHOLD = 6;

/**
 * Validate a hex pattern (prefix or suffix). Preserves casing so the caller
 * can decide whether to grind in case-sensitive mode.
 *
 * @param {string} pattern
 * @returns {{ valid: boolean, errors: string[], normalized: string, caseSensitive: boolean }}
 */
export function validatePattern(pattern) {
	const errors = [];
	if (typeof pattern !== 'string') {
		return { valid: false, errors: ['pattern must be a string'], normalized: '', caseSensitive: false };
	}
	let p = pattern.trim();
	if (p.startsWith('0x') || p.startsWith('0X')) p = p.slice(2);
	if (p.length === 0) {
		return { valid: false, errors: ['pattern is empty'], normalized: '', caseSensitive: false };
	}
	if (p.length > MAX_PATTERN_LENGTH) {
		errors.push(`length ${p.length} exceeds maximum of ${MAX_PATTERN_LENGTH}`);
	}
	if (!HEX_ANY.test(p)) {
		errors.push('pattern must be hexadecimal (0-9, a-f, A-F)');
	}
	// Mixed/upper case → case-sensitive (EIP-55 checksum match).
	const caseSensitive = !HEX_LOW.test(p);
	return {
		valid: errors.length === 0,
		errors,
		normalized: caseSensitive ? p : p.toLowerCase(),
		caseSensitive,
	};
}

/** Validate a 20-byte EVM address: optional 0x, 40 hex chars. */
export function validateAddress(addr) {
	if (typeof addr !== 'string') return { valid: false, error: 'address must be a string' };
	let a = addr.trim();
	if (a.startsWith('0x') || a.startsWith('0X')) a = a.slice(2);
	if (a.length !== 40) return { valid: false, error: `address must be 20 bytes (40 hex chars), got ${a.length}` };
	if (!HEX_ANY.test(a)) return { valid: false, error: 'address contains non-hex characters' };
	return { valid: true, normalized: '0x' + a.toLowerCase() };
}

/** Validate a 32-byte keccak256 init-code hash: optional 0x, 64 hex chars. */
export function validateInitCodeHash(hash) {
	if (typeof hash !== 'string') return { valid: false, error: 'init code hash must be a string' };
	let h = hash.trim();
	if (h.startsWith('0x') || h.startsWith('0X')) h = h.slice(2);
	if (h.length !== 64) return { valid: false, error: `init code hash must be 32 bytes (64 hex chars), got ${h.length}` };
	if (!HEX_ANY.test(h)) return { valid: false, error: 'init code hash contains non-hex characters' };
	return { valid: true, normalized: '0x' + h.toLowerCase() };
}

/**
 * Expected attempts to find a pattern of `length` chars.
 *  - case-insensitive: 16^length (uniform random nibble)
 *  - case-sensitive (EIP-55): each letter has an extra ½ probability of
 *    being the right case → 16^length × 2^(letterCount). Digits are never
 *    upper/lowercased so they don't pay the casing tax.
 *
 * @param {number} length
 * @param {number} [letterCount] – number of A-F characters in the pattern
 * @param {boolean} [caseSensitive=false]
 */
export function estimateAttempts(length, letterCount = 0, caseSensitive = false) {
	const base = Math.pow(16, length);
	if (!caseSensitive) return base;
	return base * Math.pow(2, letterCount);
}

/** Format a duration estimate as a human-readable string. */
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

/** Count A-F (case-insensitive) characters in a hex string — for difficulty estimation. */
export function letterCount(pattern) {
	let n = 0;
	for (const c of pattern) {
		if (/[a-fA-F]/.test(c)) n++;
	}
	return n;
}

const _ASCII_HEX = '0123456789abcdef';

/**
 * Apply EIP-55 mixed-case checksum to a 40-char lowercase hex address.
 * Returns the checksummed address string (no 0x prefix).
 *
 *   For each nibble of keccak256(asciiLowerAddress):
 *     • if the corresponding char is a-f AND the hash nibble >= 8 → uppercase it
 *     • else leave it
 *
 * @param {string} lowerHex  - 40 lowercase hex chars
 * @returns {string} 40-char checksummed hex
 */
export function eip55Checksum(lowerHex) {
	const asciiBytes = new Uint8Array(40);
	for (let i = 0; i < 40; i++) asciiBytes[i] = lowerHex.charCodeAt(i);
	const hash = keccak_256(asciiBytes);
	let out = '';
	for (let i = 0; i < 40; i++) {
		const c = lowerHex[i];
		if (c < 'a') { out += c; continue; }
		// Each byte of the hash is two nibbles; the i-th nibble is at byte i>>1, high if i even.
		const nibble = (i & 1) === 0 ? (hash[i >> 1] >> 4) : (hash[i >> 1] & 0xf);
		out += nibble >= 8 ? c.toUpperCase() : c;
	}
	return out;
}
