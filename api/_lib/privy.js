// Privy JWT verification: JWKS fetch + cache + token verification.

import { jwtVerify, importJWK } from 'jose';
import { env } from './env.js';

// JWKS cache: Map<kid, publicKey>. Fetched once per PRIVY_APP_ID per 60-minute window.
const jwksCache = new Map();
let lastJwksFetch = 0;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function fetchJwks() {
	const now = Date.now();
	if (jwksCache.size > 0 && now - lastJwksFetch < JWKS_TTL_MS) {
		return;
	}

	const appId = env.PRIVY_APP_ID;
	const url = `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`JWKS fetch failed: ${res.status} ${res.statusText}`);
	}

	const data = await res.json();
	jwksCache.clear();
	for (const key of data.keys || []) {
		if (key.kid && key.use === 'sig' && key.kty === 'EC') {
			const publicKey = await importJWK(key, 'ES256');
			jwksCache.set(key.kid, publicKey);
		}
	}
	lastJwksFetch = now;
}

// Verify a Privy identity token.
// Returns { userId, walletAddress, email, iat, exp } on success.
export async function verifyPrivyIdToken(token) {
	await fetchJwks();

	const appId = env.PRIVY_APP_ID;
	const decoded = jwtDecode(token);
	const kid = decoded.header.kid;

	if (!kid) {
		throw new Error('Token missing kid in header');
	}

	let publicKey = jwksCache.get(kid);
	if (!publicKey) {
		// Cache miss — refresh JWKS and try again.
		jwksCache.clear();
		lastJwksFetch = 0;
		await fetchJwks();
		publicKey = jwksCache.get(kid);
	}

	if (!publicKey) {
		throw new Error(`Key not found in JWKS: ${kid}`);
	}

	const { payload } = await jwtVerify(token, publicKey, {
		issuer: 'privy.io',
		audience: appId,
		algorithms: ['ES256'],
	});

	// Extract wallet address from linked_accounts
	let walletAddress = null;
	if (payload.linked_accounts && Array.isArray(payload.linked_accounts)) {
		const wallet = payload.linked_accounts.find((acct) => acct.type === 'wallet');
		if (wallet && wallet.address) {
			walletAddress = wallet.address.toLowerCase();
		}
	}

	return {
		userId: payload.sub,
		walletAddress,
		email: payload.email || null,
		iat: payload.iat,
		exp: payload.exp,
	};
}

// Simple JWT header decoder (without verification) to extract kid.
function jwtDecode(token) {
	const [headerB64] = token.split('.');
	if (!headerB64) throw new Error('Invalid token format');
	const header = JSON.parse(Buffer.from(headerB64, 'base64').toString('utf8'));
	return { header };
}
