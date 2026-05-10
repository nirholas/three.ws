/**
 * EOA wallet vanity grinder Web Worker.
 *
 * Hot loop:
 *   1. Generate a cryptographically random 32-byte private key
 *   2. Derive the uncompressed secp256k1 public key (64 bytes, no 04 prefix)
 *   3. keccak_256(pubkey) → take lower 20 bytes → candidate address
 *   4. Compare against prefix / suffix pattern
 *
 * Security: the private key is only ever held in this worker's memory and
 * the main thread receives it ONCE via postMessage when a match is found.
 * It is never stored anywhere — the user must save it immediately.
 */

// CDN imports so this worker is portable: works in dev (Vite), prod (Vite build),
// or any plain static-file host. Pinned versions for reproducibility.
import { secp256k1 } from 'https://esm.sh/@noble/curves@1.6.0/secp256k1?bundle';
import { keccak_256 } from 'https://esm.sh/@noble/hashes@1.5.0/sha3?bundle';

const PROGRESS_INTERVAL = 2000;
const HEX = '0123456789abcdef';

function bytesToHex(b) {
	let s = '';
	for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 0xf];
	return s;
}

function eip55(lowerHex) {
	const ascii = new Uint8Array(40);
	for (let i = 0; i < 40; i++) ascii[i] = lowerHex.charCodeAt(i);
	const h = keccak_256(ascii);
	let out = '';
	for (let i = 0; i < 40; i++) {
		const c = lowerHex.charCodeAt(i);
		if (c < 0x61) { out += lowerHex[i]; continue; }
		out += ((i & 1) === 0 ? (h[i >> 1] >> 4) : (h[i >> 1] & 0xf)) >= 8
			? lowerHex[i].toUpperCase()
			: lowerHex[i];
	}
	return out;
}

let running = false;

self.onmessage = (e) => {
	if (e.data?.type === 'start') { running = true; grind(e.data); }
	else if (e.data?.type === 'stop') { running = false; }
};

async function grind(cfg) {
	const caseSensitive = !!cfg.caseSensitive;
	const wantPrefix = caseSensitive ? (cfg.prefix || '') : (cfg.prefix || '').toLowerCase();
	const wantSuffix = caseSensitive ? (cfg.suffix || '') : (cfg.suffix || '').toLowerCase();
	const pLen = wantPrefix.length;
	const sLen = wantSuffix.length;

	const privKey = new Uint8Array(32);
	let attempts = 0;
	let intervalAttempts = 0;
	let intervalStart = performance.now();

	while (running) {
		crypto.getRandomValues(privKey);

		// Validate private key range (must be in [1, secp256k1.n-1])
		// Noble handles this; invalid keys throw, so we catch and retry.
		let pub;
		try {
			pub = secp256k1.getPublicKey(privKey, false).slice(1); // 64 bytes
		} catch {
			continue;
		}

		const addrBytes = keccak_256(pub).slice(12);
		const lowerHex = bytesToHex(addrBytes);

		attempts++;
		intervalAttempts++;

		const candidate = caseSensitive ? eip55(lowerHex) : lowerHex;
		const headOk = !pLen || candidate.startsWith(wantPrefix);
		const tailOk = !sLen || candidate.endsWith(wantSuffix);

		if (headOk && tailOk) {
			const privKeyCopy = new Uint8Array(privKey); // copy before overwrite
			self.postMessage({
				type: 'match',
				address:         '0x' + lowerHex,
				addressChecksum: '0x' + (caseSensitive ? candidate : eip55(lowerHex)),
				privateKey:      '0x' + bytesToHex(privKeyCopy),
				attempts,
			});
			// Overwrite key in worker memory
			crypto.getRandomValues(privKey);
			running = false;
			return;
		}

		if (intervalAttempts >= PROGRESS_INTERVAL) {
			const now = performance.now();
			const rate = intervalAttempts / ((now - intervalStart) / 1000);
			self.postMessage({
				type: 'progress',
				attempts,
				rate,
				sample: '0x' + (caseSensitive ? candidate : lowerHex),
			});
			intervalStart = now;
			intervalAttempts = 0;
			await new Promise(r => setTimeout(r, 0));
		}
	}
}
