// Content addressing for signs under review.
//
// A reviewer approves one exact sign, not a word. The hash is taken over the
// sign's canonical JSON (object keys sorted at every depth, arrays kept in
// order), so reformatting a pack file or reordering keys never changes it, and
// any real edit (a handshape, a place, a timing) does. An approval is recorded
// against the hash, which is what makes an edited sign drop back to unreviewed.
//
// SHA-256 through @noble/hashes so the browser, the API and the validator all
// compute the identical value without node:crypto.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * JSON with object keys sorted at every depth. Numbers, strings and booleans
 * serialize as JSON does; undefined members are dropped, as JSON drops them.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
	const keys = Object.keys(value)
		.filter((k) => value[k] !== undefined)
		.sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/**
 * The review identity of one sign: hex SHA-256 of its canonical JSON.
 * @param {object} sign  a pack entry ({ gloss, phases })
 * @returns {string}
 */
export function signContentHash(sign) {
	return bytesToHex(sha256(utf8ToBytes(canonicalJson(sign))));
}
