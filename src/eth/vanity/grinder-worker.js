/**
 * CREATE2 vanity grinder Web Worker.
 *
 * Hot loop:
 *   1. bump the salt counter (last 8 bytes of salt)
 *   2. keccak_256 over `0xff ‖ deployer ‖ salt ‖ initCodeHash` (85 bytes)
 *   3. take the lower 20 bytes as the candidate address
 *   4. if pattern matching is case-INsensitive → compare lowercase hex
 *      directly; else compute the EIP-55 checksum (one extra keccak over
 *      the 40-char lowercase ASCII hex) and compare case-sensitively.
 *
 * The 0xff‖deployer prefix is constant per session, but Keccak-f[1600]'s
 * permutation is the dominant cost and can't be cached for partial inputs
 * shorter than the rate (136 bytes) — our preimage is 85 bytes, fits in
 * one block. So per-attempt cost is ~1 permutation (case-insensitive) or
 * ~2 permutations (case-sensitive).
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

function hexToBytes(hex) {
	let h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
	if (h.length % 2) h = '0' + h;
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function bytesToHex(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i];
		s += HEX_CHARS[b >> 4] + HEX_CHARS[b & 0xf];
	}
	return s;
}

/**
 * EIP-55 checksum of a 40-char lowercase hex address. Inlined so the hot
 * loop avoids any function-call overhead beyond the keccak itself.
 */
function eip55(lowerHex) {
	const ascii = new Uint8Array(40);
	for (let i = 0; i < 40; i++) ascii[i] = lowerHex.charCodeAt(i);
	const h = keccak_256(ascii);
	let out = '';
	for (let i = 0; i < 40; i++) {
		const c = lowerHex.charCodeAt(i);
		if (c < 0x61) { out += lowerHex[i]; continue; }       // not a letter
		const nibble = (i & 1) === 0 ? (h[i >> 1] >> 4) : (h[i >> 1] & 0xf);
		out += nibble >= 8 ? lowerHex[i].toUpperCase() : lowerHex[i];
	}
	return out;
}

/**
 * @param {{ deployer: string, initCodeHash: string,
 *           prefix: string, suffix: string, caseSensitive: boolean }} cfg
 */
async function grind(cfg) {
	const deployer     = hexToBytes(cfg.deployer);
	const initCodeHash = hexToBytes(cfg.initCodeHash);
	if (deployer.length !== 20)     return self.postMessage({ type: 'error', message: 'deployer must be 20 bytes' });
	if (initCodeHash.length !== 32) return self.postMessage({ type: 'error', message: 'initCodeHash must be 32 bytes' });

	// Pre-build the 85-byte CREATE2 preimage. Only bytes 21..52 (salt) change.
	const buf = new Uint8Array(1 + 20 + 32 + 32);
	buf[0] = 0xff;
	buf.set(deployer, 1);
	buf.set(initCodeHash, 1 + 20 + 32);
	const saltView = buf.subarray(1 + 20, 1 + 20 + 32);

	const caseSensitive = !!cfg.caseSensitive;
	const wantPrefix = caseSensitive ? (cfg.prefix || '') : (cfg.prefix || '').toLowerCase();
	const wantSuffix = caseSensitive ? (cfg.suffix || '') : (cfg.suffix || '').toLowerCase();
	const pLen = wantPrefix.length;
	const sLen = wantSuffix.length;

	// Seed salt with crypto-random bytes; per-iteration we increment a
	// 64-bit counter at salt[24..32], leaving 24 bytes of fresh entropy.
	crypto.getRandomValues(saltView);
	const counter = new DataView(buf.buffer, buf.byteOffset + 1 + 20 + 24, 8);
	let lo = counter.getUint32(4, false);
	let hi = counter.getUint32(0, false);

	let attempts = 0;
	let intervalAttempts = 0;
	let intervalStart = performance.now();

	while (running) {
		// Bump 64-bit counter (big-endian) at salt[24..32].
		lo = (lo + 1) >>> 0;
		if (lo === 0) hi = (hi + 1) >>> 0;
		counter.setUint32(0, hi, false);
		counter.setUint32(4, lo, false);

		const digest = keccak_256(buf);
		const lowerHex = bytesToHex(digest.subarray(12));

		attempts++;
		intervalAttempts++;

		const candidate = caseSensitive ? eip55(lowerHex) : lowerHex;
		const headOk = !pLen || candidate.startsWith(wantPrefix);
		const tailOk = !sLen || candidate.endsWith(wantSuffix);

		if (headOk && tailOk) {
			const saltOut = new Uint8Array(32);
			saltOut.set(saltView);
			self.postMessage({
				type: 'match',
				address: '0x' + lowerHex,           // canonical lowercase
				addressChecksum: '0x' + (caseSensitive ? candidate : eip55(lowerHex)),
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
			self.postMessage({
				type: 'progress',
				attempts,
				rate,
				sample: '0x' + (caseSensitive ? candidate : lowerHex),
			});
			intervalStart = now;
			intervalAttempts = 0;
			await new Promise((r) => setTimeout(r, 0));
		}
	}
}
