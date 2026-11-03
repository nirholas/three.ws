// Resolve the currency of a peer-supplied x402 accept entry from the on-chain
// asset, never from the peer's free-text label. A peer controls `extra.name`, so
// trusting it let any asset call itself "USDC" and be priced as a dollar by the
// mandate currency check and the spend guard.

const KNOWN_USDC = new Set([
	'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Solana mainnet
	'4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Solana devnet
	'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // Base
	'0xaf88d065e77c8cc2239327c5edb3a432268e5831', // Arbitrum
	'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // Polygon
	'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // Ethereum
]);

/**
 * @param {{asset?: string, extra?: {name?: string}}} accept
 * @returns {string|undefined} 'USDC' only for a recognised USDC asset; otherwise
 *   the raw asset id (so a mandate pinned to USDC rejects it), or undefined when
 *   the accept names no asset at all.
 */
export function currencyOfAccept(accept) {
	const asset = typeof accept?.asset === 'string' ? accept.asset.trim() : '';
	if (!asset) return undefined;
	if (KNOWN_USDC.has(asset) || KNOWN_USDC.has(asset.toLowerCase())) return 'USDC';
	return asset;
}
