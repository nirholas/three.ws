/**
 * Validation for Ethereum CREATE2 vanity grinding.
 *
 * Pattern grammar: hex chars [0-9a-f], case-insensitive (we always compare
 * lowercased — Ethereum addresses are 20 raw bytes; the EIP-55 mixed-case
 * checksum is purely a presentation layer and isn't matched against here).
 *
 * CREATE2 address derivation (EIP-1014):
 *   address = keccak256(0xff ‖ deployer ‖ salt ‖ keccak256(initCode))[12:]
 *
 * The grinder samples random `salt` values; `deployer` and `initCodeHash`
 * are fixed per session. Result is a deterministic smart-contract address —
 * this is the standard pattern used by modern smart-account factories
 * (Safe, ERC-4337 SimpleAccount, Coinbase Smart Wallet, CreateX, etc.).
 */

const HEX = /^[0-9a-f]+$/i;

/** 20 hex chars (40 nibbles) is the entire address — anything past that is impossible. */
export const MAX_PATTERN_LENGTH = 10;

/** Below this, grinding finishes in seconds on a laptop; >= this hits minutes+. */
export const FREE_THRESHOLD = 6;

/**
 * Validate a hex pattern (prefix or suffix), case-insensitive.
 * Strips a leading "0x" if present.
 * @param {string} pattern
 * @returns {{ valid: boolean, errors: string[], normalized: string }}
 */
export function validatePattern(pattern) {
	const errors = [];
	if (typeof pattern !== 'string') {
		return { valid: false, errors: ['pattern must be a string'], normalized: '' };
	}
	let p = pattern.trim();
	if (p.startsWith('0x') || p.startsWith('0X')) p = p.slice(2);
	if (p.length === 0) {
		return { valid: false, errors: ['pattern is empty'], normalized: '' };
	}
	if (p.length > MAX_PATTERN_LENGTH) {
		errors.push(`length ${p.length} exceeds maximum of ${MAX_PATTERN_LENGTH}`);
	}
	if (!HEX.test(p)) {
		errors.push('pattern must be hexadecimal (0-9, a-f)');
	}
	return { valid: errors.length === 0, errors, normalized: p.toLowerCase() };
}

/** Validate a 20-byte EVM address: optional 0x, 40 hex chars. */
export function validateAddress(addr) {
	if (typeof addr !== 'string') return { valid: false, error: 'address must be a string' };
	let a = addr.trim();
	if (a.startsWith('0x') || a.startsWith('0X')) a = a.slice(2);
	if (a.length !== 40) return { valid: false, error: `address must be 20 bytes (40 hex chars), got ${a.length}` };
	if (!HEX.test(a)) return { valid: false, error: 'address contains non-hex characters' };
	return { valid: true, normalized: '0x' + a.toLowerCase() };
}

/** Validate a 32-byte keccak256 init-code hash: optional 0x, 64 hex chars. */
export function validateInitCodeHash(hash) {
	if (typeof hash !== 'string') return { valid: false, error: 'init code hash must be a string' };
	let h = hash.trim();
	if (h.startsWith('0x') || h.startsWith('0X')) h = h.slice(2);
	if (h.length !== 64) return { valid: false, error: `init code hash must be 32 bytes (64 hex chars), got ${h.length}` };
	if (!HEX.test(h)) return { valid: false, error: 'init code hash contains non-hex characters' };
	return { valid: true, normalized: '0x' + h.toLowerCase() };
}

/**
 * Expected attempts to find a hex pattern of `length` nibbles.
 * 16^length, since each nibble is uniformly random from a 16-char alphabet.
 */
export function estimateAttempts(length) {
	return Math.pow(16, length);
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
