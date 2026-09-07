/**
 * One pattern object for every chain Sigil grinds.
 *
 * Part of Sigil (https://github.com/nirholas/sigil). Apache-2.0.
 *
 * A vanity request is always the same four facts: which address space, what the
 * address should start with, what it should end with, and whether the casing has
 * to match exactly. The two address spaces disagree on everything else. Base58
 * has a non-uniform leading character and an alphabet with holes (`0 O I l` are
 * absent), hex is uniform and only 16 wide but carries EIP-55 casing, so this
 * module normalizes the request once and every other package consumes the
 * normalized form.
 *
 * `parsePattern` never throws: it returns `errors`, so a UI can render the
 * problem next to the field the user is typing in rather than in a try/catch.
 */

import { BASE58_ALPHABET, caseVariants } from './base58.js';
import { isHexPattern, letterCount, EVM_ADDRESS_NIBBLES } from './hex.js';

/** The address spaces Sigil can grind. */
export const SPACES = /** @type {const} */ (['solana', 'evm']);

/**
 * Practical ceilings. Above these a browser grind is measured in years, so the
 * UI refuses rather than showing a progress bar that will never finish; the
 * distributed/pool path lifts them.
 */
export const MAX_PATTERN_LENGTH = Object.freeze({ solana: 8, evm: 12 });

const BASE58_SET = new Set([...BASE58_ALPHABET]);

/**
 * @typedef {object} Pattern
 * @property {'solana'|'evm'} space
 * @property {string} prefix         normalized (EVM: lowercase unless caseSensitive)
 * @property {string} suffix
 * @property {boolean} caseSensitive
 * @property {number} length         prefix.length + suffix.length
 */

/**
 * @typedef {object} ParsedPattern
 * @property {boolean} ok
 * @property {string[]} errors
 * @property {Pattern} pattern
 */

/**
 * Normalize and validate a vanity request.
 *
 * @param {object} input
 * @param {'solana'|'evm'} [input.space='solana']
 * @param {string} [input.prefix]
 * @param {string} [input.suffix]
 * @param {boolean} [input.caseSensitive] EVM defaults to "sensitive iff the
 *   pattern contains an uppercase letter"; Solana defaults to true, because
 *   Base58 casing is part of the symbol.
 * @returns {ParsedPattern}
 */
export function parsePattern(input = {}) {
	const space = input.space === 'evm' ? 'evm' : 'solana';
	const errors = [];

	let prefix = String(input.prefix ?? '').trim();
	let suffix = String(input.suffix ?? '').trim();

	if (space === 'evm') {
		prefix = prefix.replace(/^0x/i, '');
		suffix = suffix.replace(/^0x/i, '');
	}

	const hasUpper = /[A-Z]/.test(prefix + suffix);
	const caseSensitive = typeof input.caseSensitive === 'boolean'
		? input.caseSensitive
		: (space === 'evm' ? hasUpper : true);

	if (space === 'evm' && !caseSensitive) {
		prefix = prefix.toLowerCase();
		suffix = suffix.toLowerCase();
	}

	if (!prefix && !suffix) errors.push('give a prefix, a suffix, or both');

	const max = MAX_PATTERN_LENGTH[space];
	if (prefix.length + suffix.length > max) {
		errors.push(`pattern is longer than ${max} characters for ${space}`);
	}

	if (space === 'solana') {
		for (const side of [prefix, suffix]) {
			for (const ch of side) {
				if (!BASE58_SET.has(ch)) {
					errors.push(`"${ch}" is not a Base58 character (0, O, I and l do not exist)`);
					break;
				}
			}
		}
		if (!caseSensitive) {
			if (prefix && caseVariants(prefix).length === 0) errors.push('prefix has no valid Base58 spelling');
			if (suffix && caseVariants(suffix).length === 0) errors.push('suffix has no valid Base58 spelling');
		}
	} else {
		if (prefix && !isHexPattern(prefix)) errors.push('prefix must be hex characters (0-9, a-f)');
		if (suffix && !isHexPattern(suffix)) errors.push('suffix must be hex characters (0-9, a-f)');
		if (prefix.length + suffix.length > EVM_ADDRESS_NIBBLES) errors.push('pattern is longer than an EVM address');
	}

	return {
		ok: errors.length === 0,
		errors,
		pattern: { space, prefix, suffix, caseSensitive, length: prefix.length + suffix.length },
	};
}

/**
 * Build a fast predicate for a normalized pattern.
 *
 * The returned function takes an address string in that space's canonical
 * rendering (Base58 for Solana, `0x`-prefixed hex for EVM, checksummed when the
 * pattern is case-sensitive) and answers whether it matches.
 *
 * @param {Pattern} pattern
 * @returns {(address: string) => boolean}
 */
export function createMatcher(pattern) {
	const { space, caseSensitive } = pattern;
	const prefix = caseSensitive ? pattern.prefix : pattern.prefix.toLowerCase();
	const suffix = caseSensitive ? pattern.suffix : pattern.suffix.toLowerCase();
	const strip = space === 'evm';

	return (address) => {
		if (typeof address !== 'string') return false;
		let body = strip ? address.replace(/^0x/i, '') : address;
		if (!caseSensitive) body = body.toLowerCase();
		if (prefix && !body.startsWith(prefix)) return false;
		if (suffix && !body.endsWith(suffix)) return false;
		return true;
	};
}

/**
 * A stable, URL-safe string for a pattern. Used as a cache key, a bounty id
 * component, and the value signed inside a proof-of-grind certificate, so it
 * must round-trip exactly.
 * @param {Pattern} pattern
 * @returns {string}
 */
export function patternKey(pattern) {
	const flags = pattern.caseSensitive ? 'cs' : 'ci';
	return `${pattern.space}:${pattern.prefix}:${pattern.suffix}:${flags}`;
}

/**
 * Parse a `patternKey` back into a pattern.
 * @param {string} key
 * @returns {ParsedPattern}
 */
export function parsePatternKey(key) {
	const [space, prefix = '', suffix = '', flags = 'cs'] = String(key).split(':');
	return parsePattern({ space, prefix, suffix, caseSensitive: flags === 'cs' });
}

/**
 * Human summary of a pattern, e.g. `SoL…pump (case-sensitive)`.
 * @param {Pattern} pattern
 * @returns {string}
 */
export function describePattern(pattern) {
	const head = pattern.prefix || '';
	const tail = pattern.suffix || '';
	const shape = pattern.space === 'evm'
		? `0x${head || ''}${head && tail ? '…' : (head ? '…' : '…')}${tail}`
		: `${head}${head && tail ? '…' : (head ? '…' : '…')}${tail}`;
	return `${shape} (${pattern.caseSensitive ? 'case-sensitive' : 'any case'})`;
}

/** How many case-carrying characters a pattern has (EVM only; 0 for Solana). */
export { letterCount };
