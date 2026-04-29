import { Connection, PublicKey } from '@solana/web3.js';
import { resolve, getFavoriteDomain } from '@bonfida/spl-name-service';

const DEFAULT_RPC_URL =
	(typeof process !== 'undefined' && process.env?.SOLANA_RPC_URL) ||
	'https://api.mainnet-beta.solana.com';

function makeConnection() {
	return new Connection(DEFAULT_RPC_URL, 'confirmed');
}

function stripSol(name) {
	return name.endsWith('.sol') ? name.slice(0, -4) : name;
}

/**
 * Forward lookup: .sol domain name → owner wallet address (base58) or null.
 * @param {string} name - e.g. 'bonfida.sol' or 'bonfida'
 * @returns {Promise<string|null>}
 */
export async function resolveSnsName(name) {
	try {
		const pk = await resolve(makeConnection(), stripSol(name));
		return pk.toBase58();
	} catch {
		return null;
	}
}

/**
 * Reverse lookup: wallet address (base58) → primary .sol domain name or null.
 * @param {string} addr - base58-encoded wallet public key
 * @returns {Promise<string|null>}
 */
export async function reverseLookupAddress(addr) {
	try {
		const owner = new PublicKey(addr);
		const { reverse } = await getFavoriteDomain(makeConnection(), owner);
		return reverse.endsWith('.sol') ? reverse : `${reverse}.sol`;
	} catch {
		return null;
	}
}
