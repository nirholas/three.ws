/**
 * CREATE2 vanity grinder Web Worker.
 *
 * Hot loop: sample 32 random salt bytes, compute the EIP-1014 CREATE2
 * address, check prefix/suffix against the lowercased hex address.
 *
 *   address = keccak256(0xff ‖ deployer ‖ salt ‖ initCodeHash)[12:]
 *
 * `deployer` (20 bytes) and `initCodeHash` (32 bytes) are fixed for the
 * session — we pre-build an 85-byte input buffer with those segments
 * already in place and only rewrite bytes 21..52 (the salt) per attempt.
 *
 * Uses `@noble/hashes/sha3` keccak_256. Vite bundles workers, so the
 * import resolves at build time.
 */

import { keccak_256 } from '@noble/hashes/sha3';

const PROGRESS_INTERVAL = 5000;
const HEX_CHARS = '0123456789abcdef';

let running = false;

self.onmessage = (e) => {
	const msg = e.data;
	if (msg?.type === 'start') {
		running = true;
		grind(msg);
	} else if (msg?.type === 'stop') {
		running = false;
	}
};

/** Decode a 0x-prefixed hex string to a Uint8Array. */
function hexToBytes(hex) {
	let h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
	if (h.length % 2) h = '0' + h;
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
	}
	return out;
}

/** Encode bytes as a lowercase hex string (no 0x). */
function bytesToHex(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i];
		s += HEX_CHARS[b >> 4] + HEX_CHARS[b & 0xf];
	}
	return s;
}

/**
 * @param {{ deployer: string, initCodeHash: string, prefix: string, suffix: string }} cfg
 */
async function grind(cfg) {
	const deployer     = hexToBytes(cfg.deployer);
	const initCodeHash = hexToBytes(cfg.initCodeHash);
	if (deployer.length !== 20)     return self.postMessage({ type: 'error', message: 'deployer must be 20 bytes' });
	if (initCodeHash.length !== 32) return self.postMessage({ type: 'error', message: 'initCodeHash must be 32 bytes' });

	// Pre-build the 85-byte CREATE2 preimage: 0xff ‖ deployer(20) ‖ salt(32) ‖ initCodeHash(32).
	// Only bytes 21..52 (salt) change per attempt.
	const buf = new Uint8Array(1 + 20 + 32 + 32);
	buf[0] = 0xff;
	buf.set(deployer, 1);
	buf.set(initCodeHash, 1 + 20 + 32);
	const saltView = buf.subarray(1 + 20, 1 + 20 + 32);

	const wantPrefix = (cfg.prefix || '').toLowerCase();
	const wantSuffix = (cfg.suffix || '').toLowerCase();
	const pLen = wantPrefix.length;
	const sLen = wantSuffix.length;

	// Seed the salt with a fresh random base; we then increment a counter
	// at the tail to avoid re-deriving entropy on every iteration. The
	// remaining 24 bytes of randomness still give 2^192 distinct salts
	// per worker, which is more than enough.
	crypto.getRandomValues(saltView);
	const counter = new DataView(buf.buffer, buf.byteOffset + 1 + 20 + 24, 8); // last 8 bytes of salt
	let lo = counter.getUint32(4, false);
	let hi = counter.getUint32(0, false);

	let attempts = 0;
	let intervalAttempts = 0;
	let intervalStart = performance.now();

	while (running) {
		// Bump the salt counter (big-endian 64-bit increment at salt[24..32]).
		lo = (lo + 1) >>> 0;
		if (lo === 0) hi = (hi + 1) >>> 0;
		counter.setUint32(0, hi, false);
		counter.setUint32(4, lo, false);

		const digest = keccak_256(buf);
		// Address is digest[12..32] — 20 bytes, lowercase hex.
		const addr = bytesToHex(digest.subarray(12));

		attempts++;
		intervalAttempts++;

		const headOk = !pLen || addr.startsWith(wantPrefix);
		const tailOk = !sLen || addr.endsWith(wantSuffix);

		if (headOk && tailOk) {
			// Copy salt out before transferring buf — saltView is a subarray of buf,
			// and we want to keep buf inside the worker for any subsequent runs.
			const saltOut = new Uint8Array(32);
			saltOut.set(saltView);
			self.postMessage({
				type: 'match',
				address: '0x' + addr,
				salt:    '0x' + bytesToHex(saltOut),
				attempts,
			}, [saltOut.buffer]);
			running = false;
			return;
		}

		if (intervalAttempts >= PROGRESS_INTERVAL) {
			const now = performance.now();
			const elapsed = (now - intervalStart) / 1000;
			const rate = elapsed > 0 ? intervalAttempts / elapsed : 0;
			self.postMessage({ type: 'progress', attempts, rate, sample: '0x' + addr });
			intervalStart = now;
			intervalAttempts = 0;
			// Yield so 'stop' messages get processed.
			await new Promise((r) => setTimeout(r, 0));
		}
	}
}
