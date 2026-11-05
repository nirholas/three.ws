// Solana reads and the connection every lending layer shares. Both ride the
// platform's failover RPC lanes (api/_lib/solana/connection.js), so a provider
// outage rotates to the next endpoint instead of failing the request.

import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { solanaConnection } from '../agent-pumpfun.js';
import { solanaKitRpc } from '../solana/kit-rpc.js';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** web3.js connection on the failover lanes (mainnet: the lending market lives there). */
export function lendingConnection() {
	return solanaConnection('mainnet');
}

/** @solana/kit client on the same lanes, for the venue SDK. */
export function lendingKitRpc() {
	return solanaKitRpc('mainnet');
}

/** The associated token account of an owner for a mint. */
export function ataFor(owner, mint) {
	return getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true);
}

/** Decode the u64 amount field of a raw SPL token account (null account is zero). */
export function decodeTokenAmount(account) {
	if (!account) return 0n;
	const data = Array.isArray(account.data) ? Buffer.from(account.data[0], 'base64') : null;
	if (!data || data.length < 72) return 0n;
	return data.readBigUInt64LE(64);
}

/**
 * Liquid balance of a token in the wallet, in base units. Native SOL reads the
 * lamport balance; any other mint reads its associated token account (zero when
 * the account does not exist yet).
 */
export async function liquidBalanceRaw(owner, mint, conn = lendingConnection()) {
	if (mint === WSOL_MINT) return BigInt(await conn.getBalance(new PublicKey(owner), 'confirmed'));
	try {
		const bal = await conn.getTokenAccountBalance(ataFor(owner, mint), 'confirmed');
		return BigInt(bal?.value?.amount || '0');
	} catch (err) {
		if (/could not find account|invalid param/i.test(String(err?.message))) return 0n;
		throw err;
	}
}
