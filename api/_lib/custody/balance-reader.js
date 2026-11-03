// SOL and USDC balance of one Solana address, read straight from the chain.
//
// One real read shared by the hourly history cron, GET /api/me/wallet and the
// private-wallet tools, so the three can never disagree about what a wallet
// holds. USD comes from the platform's cached SOL price; USDC is counted at par.

import { PublicKey } from '@solana/web3.js';
import { solanaConnection } from '../solana/connection.js';
import { cachedSolUsd } from '../trader-stats.js';
import { USDC_MINT_BY_NETWORK, clientError } from './builders.js';

const USDC_DECIMALS = 6;
const NETWORKS = Object.freeze(['mainnet', 'devnet']);

export function parseNetwork(value) {
	const n = value == null || value === '' ? 'mainnet' : String(value);
	if (!NETWORKS.includes(n)) throw clientError('invalid_parameter', `network must be one of ${NETWORKS.join(', ')}`);
	return n;
}

/** Sum every USDC token account a wallet holds (normally one, the ATA). */
export function sumUsdcRaw(parsedAccounts) {
	let total = 0n;
	for (const { account } of parsedAccounts || []) {
		const raw = account?.data?.parsed?.info?.tokenAmount?.amount;
		if (raw != null) total += BigInt(raw);
	}
	return total;
}

export function usdTotal({ lamports, usdcRaw, solUsd }) {
	const sol = Number(lamports) / 1e9;
	const usdc = Number(usdcRaw) / 10 ** USDC_DECIMALS;
	if (sol > 0 && solUsd == null) return null;
	return (solUsd == null ? 0 : sol * solUsd) + usdc;
}

/**
 * @param {{ address: string, network?: 'mainnet'|'devnet', connection?: object, solUsd?: number|null }} p
 * @returns {Promise<{ address: string, network: string, lamports: bigint, sol: number, usdc_raw: bigint, usdc: number, sol_usd: number|null, usd_total: number|null }>}
 */
export async function readSolUsdc({ address, network = 'mainnet', connection = null, solUsd }) {
	const owner = new PublicKey(address);
	const conn = connection || solanaConnection({ network, commitment: 'confirmed' });
	const [lamports, accounts, price] = await Promise.all([
		conn.getBalance(owner, 'confirmed'),
		conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(USDC_MINT_BY_NETWORK[network]) }, 'confirmed'),
		solUsd !== undefined ? Promise.resolve(solUsd) : network === 'mainnet' ? cachedSolUsd() : Promise.resolve(null),
	]);
	const lam = BigInt(lamports);
	const usdcRaw = sumUsdcRaw(accounts.value);
	return {
		address,
		network,
		lamports: lam,
		sol: Number(lam) / 1e9,
		usdc_raw: usdcRaw,
		usdc: Number(usdcRaw) / 10 ** USDC_DECIMALS,
		sol_usd: price ?? null,
		usd_total: usdTotal({ lamports: lam, usdcRaw, solUsd: price ?? null }),
	};
}
