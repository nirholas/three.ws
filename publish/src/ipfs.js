/**
 * IPFS / Arweave URI resolver.
 *
 * Translates decentralised storage URIs into HTTPS gateway URLs
 * so the Three.js loader can fetch them normally.
 *
 *   ipfs://QmXyz...        → https://dweb.link/ipfs/QmXyz...
 *   ipfs://bafkreiXyz...   → https://dweb.link/ipfs/bafkreiXyz...
 *   ar://txId               → https://arweave.net/txId
 */

const IPFS_GATEWAYS = [
	'https://dweb.link/ipfs/',
	'https://cloudflare-ipfs.com/ipfs/',
	'https://ipfs.io/ipfs/',
];

const AR_GATEWAY = 'https://arweave.net/';

/**
 * Returns true when the URL uses a decentralised storage scheme.
 * @param {string} url
 * @returns {boolean}
 */
export function isDecentralizedURI(url) {
	return /^(ipfs|ar):\/\//i.test(url);
}

/**
 * Resolve an ipfs:// or ar:// URI to an HTTPS gateway URL.
 * For regular URLs the input is returned unchanged.
 *
 * @param {string} uri
 * @param {number} [gatewayIndex=0]  Which IPFS gateway to use (for fallback).
 * @returns {string}
 */
export function resolveURI(uri, gatewayIndex = 0) {
	if (!uri) return uri;

	// ipfs://CID  or  ipfs://CID/path
	const ipfsMatch = uri.match(/^ipfs:\/\/(.+)$/i);
	if (ipfsMatch) {
		const gw = IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length];
		return gw + ipfsMatch[1];
	}

	// ar://txId
	const arMatch = uri.match(/^ar:\/\/(.+)$/i);
	if (arMatch) {
		return AR_GATEWAY + arMatch[1];
	}

	return uri;
}

/**
 * Try to fetch from the primary gateway; on failure, cycle through fallbacks.
 *
 * @param {string} ipfsURI  An ipfs:// URI.
 * @returns {Promise<Response>}
 */
export async function fetchWithFallback(ipfsURI) {
	let lastError;
	for (let i = 0; i < IPFS_GATEWAYS.length; i++) {
		const url = resolveURI(ipfsURI, i);
		try {
			const res = await fetch(url);
			if (res.ok) return res;
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError || new Error('All IPFS gateways failed for ' + ipfsURI);
}
