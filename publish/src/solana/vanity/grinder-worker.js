/**
 * Vanity grinder Web Worker.
 *
 * Loops Keypair.generate() and reports matches + progress back to the host.
 * The host owns the matcher predicate (passed as serialized config); this
 * worker only decides "does the base58 address match?".
 *
 * Algorithm parity with nirholas/solana-wallet-toolkit
 * (typescript/src/lib/generator.ts).
 */

import { Keypair } from '@solana/web3.js';

const PROGRESS_INTERVAL = 5000;

let running = false;

self.onmessage = (e) => {
	const msg = e.data;
	if (msg?.type === 'start') {
		running = true;
		grind(msg.prefix || '', msg.suffix || '', !!msg.ignoreCase);
	} else if (msg?.type === 'stop') {
		running = false;
	}
};

/**
 * @param {string} prefix
 * @param {string} suffix
 * @param {boolean} ignoreCase
 */
async function grind(prefix, suffix, ignoreCase) {
	const wantPrefix = ignoreCase ? prefix.toLowerCase() : prefix;
	const wantSuffix = ignoreCase ? suffix.toLowerCase() : suffix;
	const pLen = prefix.length;
	const sLen = suffix.length;

	let attempts = 0;
	let intervalStart = performance.now();
	let intervalAttempts = 0;

	while (running) {
		const kp = Keypair.generate();
		const address = kp.publicKey.toBase58();
		attempts++;
		intervalAttempts++;

		const head = pLen
			? (ignoreCase ? address.substring(0, pLen).toLowerCase() : address.substring(0, pLen))
			: '';
		const tail = sLen
			? (ignoreCase ? address.slice(-sLen).toLowerCase() : address.slice(-sLen))
			: '';

		if ((!pLen || head === wantPrefix) && (!sLen || tail === wantSuffix)) {
			self.postMessage({
				type: 'match',
				publicKey: address,
				secretKey: kp.secretKey,
				attempts,
			}, [kp.secretKey.buffer]);
			running = false;
			return;
		}

		if (intervalAttempts >= PROGRESS_INTERVAL) {
			const now = performance.now();
			const elapsed = (now - intervalStart) / 1000;
			const rate = elapsed > 0 ? intervalAttempts / elapsed : 0;
			self.postMessage({ type: 'progress', attempts, rate });
			intervalStart = now;
			intervalAttempts = 0;
			// Yield to the event loop so 'stop' messages get processed.
			await new Promise((r) => setTimeout(r, 0));
		}
	}
}
