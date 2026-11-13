// SOL and USDC balance of one Solana address, read straight from the chain.
//
// One real read shared by the hourly history cron, GET /api/me/wallet and the
// private-wallet tools, so the three can never disagree about what a wallet
// holds. USD comes from the platform's cached SOL price; USDC is counted at par.

import { PublicKey } from '@solana/web3.js';
import { AccountLayout, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { solanaConnection } from '../solana/connection.js';
import { cachedSolUsd } from '../trader-stats.js';
import { USDC_MINT_BY_NETWORK, clientError } from './builders.js';

const USDC_DECIMALS = 6;
const NETWORKS = Object.freeze(['mainnet', 'devnet']);
// getMultipleAccountsInfo takes at most 100 keys; each wallet needs two (owner + USDC ATA).
const WALLETS_PER_CALL = 50;

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
	return reading({ address, network, lamports: BigInt(lamports), usdcRaw: sumUsdcRaw(accounts.value), price });
}

function reading({ address, network, lamports, usdcRaw, price }) {
	return {
		address,
		network,
		lamports,
		sol: Number(lamports) / 1e9,
		usdc_raw: usdcRaw,
		usdc: Number(usdcRaw) / 10 ** USDC_DECIMALS,
		sol_usd: price ?? null,
		usd_total: usdTotal({ lamports, usdcRaw, solUsd: price ?? null }),
	};
}

/**
 * Batch form of readSolUsdc for sweeps over many wallets (the hourly cron).
 * One getMultipleAccountsInfo per 50 wallets reads each owner account and its USDC
 * associated token account, so 60 wallets cost two RPC calls instead of 120. A
 * burst of per-wallet reads rate-limits every provider in the failover list.
 * USDC held outside the associated token account is not counted here; agent
 * wallets only ever receive USDC at their ATA.
 *
 * @param {{ addresses: string[], network?: 'mainnet'|'devnet', connection?: object, solUsd?: number|null }} p
 * @returns {Promise<Map<string, ReturnType<typeof reading> | Error>>} keyed by address; a chunk the RPC refused maps each of its addresses to the Error
 */
export async function readSolUsdcMany({ addresses, network = 'mainnet', connection = null, solUsd }) {
	const conn = connection || solanaConnection({ network, commitment: 'confirmed' });
	const price = solUsd !== undefined ? solUsd : network === 'mainnet' ? await cachedSolUsd() : null;
	const mint = new PublicKey(USDC_MINT_BY_NETWORK[network]);
	const out = new Map();
	for (let i = 0; i < addresses.length; i += WALLETS_PER_CALL) {
		const chunk = addresses.slice(i, i + WALLETS_PER_CALL);
		const keys = [];
		const valid = [];
		for (const address of chunk) {
			try {
				const owner = new PublicKey(address);
				keys.push(owner, getAssociatedTokenAddressSync(mint, owner, true));
				valid.push(address);
			} catch (err) {
				out.set(address, new Error(`invalid wallet address: ${err.message}`));
			}
		}
		if (!keys.length) continue;
		let infos;
		try {
			infos = await conn.getMultipleAccountsInfo(keys, 'confirmed');
		} catch (err) {
			for (const address of valid) out.set(address, err instanceof Error ? err : new Error(String(err)));
			continue;
		}
		valid.forEach((address, j) => {
			const ownerInfo = infos[2 * j];
			const ataInfo = infos[2 * j + 1];
			const lamports = BigInt(ownerInfo?.lamports ?? 0);
			const usdcRaw = ataInfo?.data?.length >= AccountLayout.span ? BigInt(AccountLayout.decode(ataInfo.data).amount) : 0n;
			out.set(address, reading({ address, network, lamports, usdcRaw, price }));
		});
	}
	return out;
}
