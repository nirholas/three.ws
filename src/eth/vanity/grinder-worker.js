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

import { keccak_256 } from '@noble/hashes/sha3.js';

const PROGRESS_INTERVAL = 5000;
const HEX_CHARS = '0123456789abcdef';

let running = false;
// Guards against two grind loops racing if 'resume' arrives before the
// previous loop has fully unwound.
let looping = false;
// Grind state hoisted to module scope so 'pause' can exit the hot loop —
// genuinely freeing the core — while 'resume' re-enters and continues the
// same salt search with a monotonic attempt count. Parity with the Solana
// worker's pause/resume contract.
let state = null;

self.onmessage = (e) => {
	const msg = e.data;
	if (msg?.type === 'start') {
		state = initState(msg);
		running = !!state;
		if (running) kick();
	} else if (msg?.type === 'resume') {
		if (!state) return;
		running = true;
		kick();
	} else if (msg?.type === 'pause' || msg?.type === 'stop') {
		running = false;
	}
};

/** Start the hot loop unless one is already in flight. */
function kick() {
	if (!looping) grindLoop();
}

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
 * Build the persistent grind state for a fresh 'start'. Returns null (after
 * posting an error) if the deployer/initCodeHash are malformed.
 * @param {{ deployer: string, initCodeHash: string,
 *           prefix: string, suffix: string, caseSensitive: boolean }} cfg
 */
function initState(cfg) {
	const deployer     = hexToBytes(cfg.deployer);
	const initCodeHash = hexToBytes(cfg.initCodeHash);
	if (deployer.length !== 20)     { self.postMessage({ type: 'error', message: 'deployer must be 20 bytes' }); return null; }
	if (initCodeHash.length !== 32) { self.postMessage({ type: 'error', message: 'initCodeHash must be 32 bytes' }); return null; }

	// Pre-build the 85-byte CREATE2 preimage. Only bytes 21..52 (salt) change.
	const buf = new Uint8Array(1 + 20 + 32 + 32);
	buf[0] = 0xff;
	buf.set(deployer, 1);
	buf.set(initCodeHash, 1 + 20 + 32);
	const saltView = buf.subarray(1 + 20, 1 + 20 + 32);

	const caseSensitive = !!cfg.caseSensitive;
	const wantPrefix = caseSensitive ? (cfg.prefix || '') : (cfg.prefix || '').toLowerCase();
	const wantSuffix = caseSensitive ? (cfg.suffix || '') : (cfg.suffix || '').toLowerCase();

	// Seed salt with crypto-random bytes; per-iteration we increment a
	// 64-bit counter at salt[24..32], leaving 24 bytes of fresh entropy.
	crypto.getRandomValues(saltView);
	const counter = new DataView(buf.buffer, buf.byteOffset + 1 + 20 + 24, 8);

	return {
		buf, saltView, counter, caseSensitive,
		wantPrefix, wantSuffix,
		pLen: wantPrefix.length, sLen: wantSuffix.length,
		lo: counter.getUint32(4, false),
		hi: counter.getUint32(0, false),
		attempts: 0,
	};
}

async function grindLoop() {
	looping = true;
	const s = state;
	const { buf, saltView, counter, caseSensitive, wantPrefix, wantSuffix, pLen, sLen } = s;

	let intervalAttempts = 0;
	let intervalStart = performance.now();

	while (running && state === s) {
		// Bump 64-bit counter (big-endian) at salt[24..32].
		s.lo = (s.lo + 1) >>> 0;
		if (s.lo === 0) s.hi = (s.hi + 1) >>> 0;
		counter.setUint32(0, s.hi, false);
		counter.setUint32(4, s.lo, false);

		const digest = keccak_256(buf);
		const lowerHex = bytesToHex(digest.subarray(12));

		s.attempts++;
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
				attempts: s.attempts,
			}, [saltOut.buffer]);
			running = false;
			break;
		}

		if (intervalAttempts >= PROGRESS_INTERVAL) {
			const now = performance.now();
			const elapsed = (now - intervalStart) / 1000;
			const rate = elapsed > 0 ? intervalAttempts / elapsed : 0;
			self.postMessage({
				type: 'progress',
				attempts: s.attempts,
				rate,
				sample: '0x' + (caseSensitive ? candidate : lowerHex),
			});
			intervalStart = now;
			intervalAttempts = 0;
			// Yield to the event loop so 'pause'/'stop' messages get processed.
			await new Promise((r) => setTimeout(r, 0));
		}
	}

	looping = false;
}
