import { Connection, PublicKey } from '@solana/web3.js';

const DEFAULT_RPC_URL =
	(typeof process !== 'undefined' && process.env?.SOLANA_RPC_URL) ||
	'https://api.mainnet-beta.solana.com';

function makeConnection() {
	return new Connection(DEFAULT_RPC_URL, 'confirmed');
}

function stripSol(name) {
	return name.endsWith('.sol') ? name.slice(0, -4) : name;
}

// Dynamic import avoids the Rollup TDZ (temporal dead zone) error caused by
// circular dependencies inside @bonfida/spl-name-service when statically bundled.
async function getBonfida() {
	return import('@bonfida/spl-name-service');
}

export async function resolveSnsName(name) {
	try {
		const { resolve } = await getBonfida();
		const pk = await resolve(makeConnection(), stripSol(name));
		return pk.toBase58();
	} catch {
		return null;
	}
}

export async function reverseLookupAddress(addr) {
	try {
		const { getFavoriteDomain } = await getBonfida();
		const owner = new PublicKey(addr);
		const { reverse } = await getFavoriteDomain(makeConnection(), owner);
		return reverse.endsWith('.sol') ? reverse : `${reverse}.sol`;
	} catch {
		return null;
	}
}
