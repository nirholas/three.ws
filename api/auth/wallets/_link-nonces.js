// In-memory nonce store for wallet linking. Separate from login nonces.
// Used by nonce.js (issuer) and index.js (validator).

import { randomToken } from '../../_lib/crypto.js';

export const NONCE_TTL_SEC = 5 * 60;
const nonceStore = new Map();

// Cleanup expired nonces every 30 seconds.
setInterval(() => {
	const now = Date.now();
	for (const [nonce, data] of nonceStore) {
		if (now - data.issuedAt > NONCE_TTL_SEC * 1000) {
			nonceStore.delete(nonce);
		}
	}
}, 30_000);

export function issueNonce(userId) {
	let nonce = '';
	while (nonce.length < 16) {
		nonce += randomToken(24).replace(/[^A-Za-z0-9]/g, '');
	}
	nonce = nonce.slice(0, 16);
	nonceStore.set(nonce, { userId, issuedAt: Date.now() });
	return nonce;
}

export function consumeNonce(nonce, userId) {
	const data = nonceStore.get(nonce);
	if (!data) return null;
	if (data.userId !== userId) return null;
	nonceStore.delete(nonce);
	return data;
}
