// Mint Keypair vanity grinder for pump.fun launches.
//
// Generates Solana Keypairs until the base58 address starts with `prefix`.
// Capped by `maxIterations` so a serverless invocation can't time out.
//
// Base58 alphabet excludes 0, O, I, l — reject prefixes containing those
// up-front so callers get a clear 400 instead of an infinite loop.

import { Keypair } from '@solana/web3.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

// Rough expected attempts ≈ 58^len. Hard cap default keeps us under
// ~5s wall time for 4-char prefixes on Vercel's serverless CPU.
const DEFAULT_MAX_ITERATIONS = 2_000_000;

export function isValidVanityPrefix(prefix) {
	if (!prefix || typeof prefix !== 'string') return false;
	if (prefix.length > 6) return false;
	return BASE58_RE.test(prefix);
}

export function grindMintKeypair({ prefix, maxIterations = DEFAULT_MAX_ITERATIONS } = {}) {
	if (!prefix) return { keypair: Keypair.generate(), iterations: 1 };
	if (!isValidVanityPrefix(prefix)) {
		throw Object.assign(new Error('invalid vanity prefix'), {
			status: 400,
			code: 'invalid_vanity',
		});
	}
	for (let i = 1; i <= maxIterations; i++) {
		const kp = Keypair.generate();
		if (kp.publicKey.toBase58().startsWith(prefix)) {
			return { keypair: kp, iterations: i };
		}
	}
	throw Object.assign(
		new Error(`vanity prefix '${prefix}' not found in ${maxIterations} attempts`),
		{ status: 504, code: 'vanity_timeout' },
	);
}
