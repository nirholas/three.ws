// Vanity Solana keypair generator.
// Iterates Keypair.generate() until publicKey matches both prefix and suffix.
// Single-threaded; suitable for short suffixes (≤4 chars) on server.

import { Keypair } from '@solana/web3.js';

/**
 * @param {Object} opts
 * @param {string} [opts.suffix]
 * @param {string} [opts.prefix]
 * @param {boolean} [opts.caseSensitive]
 * @param {number} [opts.maxAttempts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{publicKey: string, secretKey: Uint8Array, attempts: number, ms: number}|null>}
 */
export async function generateVanityKey({
	suffix = '',
	prefix = '',
	caseSensitive = false,
	maxAttempts = 5_000_000,
	signal,
} = {}) {
	if (!suffix && !prefix) throw new Error('at least one of suffix or prefix is required');

	const normalize = caseSensitive ? (s) => s : (s) => s.toLowerCase();
	const wantSuffix = normalize(suffix);
	const wantPrefix = normalize(prefix);

	const start = Date.now();
	let attempts = 0;

	// Yield to the event loop every 10k iterations so abort signals are checked
	// and the process stays responsive.
	const YIELD_EVERY = 10_000;

	while (attempts < maxAttempts) {
		if (signal?.aborted) return null;

		const batchEnd = Math.min(attempts + YIELD_EVERY, maxAttempts);
		while (attempts < batchEnd) {
			const kp = Keypair.generate();
			const addr = normalize(kp.publicKey.toBase58());
			attempts++;
			if (
				(!wantPrefix || addr.startsWith(wantPrefix)) &&
				(!wantSuffix || addr.endsWith(wantSuffix))
			) {
				return {
					publicKey: kp.publicKey.toBase58(),
					secretKey: kp.secretKey,
					attempts,
					ms: Date.now() - start,
				};
			}
		}
		// Allow the event loop to process abort / timer signals.
		await new Promise((r) => setImmediate(r));
	}

	return null;
}
