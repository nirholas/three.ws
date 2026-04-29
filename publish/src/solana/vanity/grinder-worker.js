/**
 * Vanity grinder Web Worker.
 *
 * Loops keypair generation and reports matches + progress back to the host.
 * The host owns the matcher predicate (passed as serialized config); this
 * worker only decides "does the base58 address match?".
 *
 * Algorithm parity with nirholas/solana-wallet-toolkit
 * (typescript/src/lib/generator.ts).
 *
 * Uses SubtleCrypto Ed25519 instead of @solana/web3.js so this file can be
 * served as a raw ES module (no bundler / import-map required).
 */

// ── Crypto helpers ────────────────────────────────────────────────────────────

const _B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function _base58(bytes) {
	let n = 0n;
	for (const b of bytes) n = (n << 8n) | BigInt(b);
	let s = '';
	while (n > 0n) { s = _B58[Number(n % 58n)] + s; n /= 58n; }
	for (const b of bytes) { if (b) break; s = '1' + s; }
	return s;
}

function _b64u(s) {
	return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

async function _generateKeypair() {
	const { privateKey, publicKey } = await crypto.subtle.generateKey(
		{ name: 'Ed25519' }, true, ['sign'],
	);
	const [privJwk, pubRaw] = await Promise.all([
		crypto.subtle.exportKey('jwk', privateKey),
		crypto.subtle.exportKey('raw', publicKey),
	]);
	const pub = new Uint8Array(pubRaw);
	const sk = new Uint8Array(64);
	sk.set(_b64u(privJwk.d)); // 32-byte seed
	sk.set(pub, 32);           // 32-byte public key
	return { address: _base58(pub), secretKey: sk };
}

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
		const { address, secretKey } = await _generateKeypair();
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
				secretKey,
				attempts,
			}, [secretKey.buffer]);
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
