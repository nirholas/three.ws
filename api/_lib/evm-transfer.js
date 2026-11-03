/**
 * EVM USDC transfer helper — used by payout/withdrawal flows that need to
 * send USDC from a treasury wallet to a recipient on an EVM chain.
 *
 * Mirrors the club-payouts.js sender but supports multiple chains and uses
 * the generic EVM_TREASURY_PRIVATE_KEY env var. Per-chain RPC URLs are
 * resolved from env: EVM_RPC_URL_<chainId> falls back to a viem-default
 * public RPC if not configured.
 */

import {
	createPublicClient,
	createWalletClient,
	encodeFunctionData,
	keccak256,
	parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { evmTransport } from './evm/rpc.js';
import {
	mainnet,
	base,
	optimism,
	arbitrum,
	polygon,
	sepolia,
	baseSepolia,
} from 'viem/chains';
import { env } from './env.js';
import { EVM_USDC } from '../payments/_config.js';

const ERC20_TRANSFER_ABI = parseAbi([
	'function transfer(address to, uint256 amount) returns (bool)',
]);

const CHAINS = {
	1: mainnet,
	8453: base,
	10: optimism,
	42161: arbitrum,
	137: polygon,
	11155111: sepolia,
	84532: baseSepolia,
};

const SEND_TIMEOUT_MS = 90_000;
const CONFIRMATIONS = 1;

function evmRpcUrl(chainId) {
	return (
		process.env[`EVM_RPC_URL_${chainId}`] ||
		(chainId === 8453 && env.CLUB_BASE_RPC_URL) ||
		undefined
	);
}

function treasuryAccount() {
	const pk = env.EVM_TREASURY_PRIVATE_KEY || process.env.EVM_TREASURY_PRIVATE_KEY;
	if (!pk) throw new Error('EVM_TREASURY_PRIVATE_KEY not set');
	return privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
}

/** Address of the configured EVM treasury (the sender of every EVM payout). */
export function evmTreasuryAddress() {
	return treasuryAccount().address;
}

/** Read-only client for a supported chain, on the same RPC the sender uses. */
export function evmPublicClient(chainId) {
	const chain = CHAINS[chainId];
	if (!chain) throw new Error(`unsupported EVM chain ${chainId}`);
	return createPublicClient({ chain, transport: evmTransport(chainId, { primaryUrl: evmRpcUrl(chainId) }) });
}

/**
 * Send `amount` USDC atomics from the configured EVM treasury to `recipient`
 * on the given chain. Waits for inclusion before returning so the caller can
 * confidently advance ledger state.
 *
 * The transaction is signed locally and its hash and nonce are handed to
 * `onSigned` BEFORE it is broadcast, so a timeout or RPC error after broadcast
 * can be reconciled by hash/nonce instead of guessed at. If `onSigned` throws,
 * nothing has been broadcast.
 *
 * @param {object} opts
 * @param {number} opts.chainId
 * @param {string} opts.recipient        0x-prefixed EVM address
 * @param {bigint|string} opts.amount    USDC atomics (6 decimals)
 * @param {(signed: { hash: string, nonce: number }) => Promise<void>} [opts.onSigned]
 * @returns {Promise<{ hash: string, chainId: number, amount: string }>}
 */
export async function sendEvmUsdc({ chainId, recipient, amount, onSigned }) {
	const chain = CHAINS[chainId];
	if (!chain) throw new Error(`unsupported EVM chain ${chainId}`);

	const usdc = EVM_USDC[chainId];
	if (!usdc) throw new Error(`no USDC contract for chain ${chainId}`);

	if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
		throw new Error(`invalid EVM recipient: ${recipient}`);
	}

	const amt = typeof amount === 'bigint' ? amount : BigInt(amount);
	if (amt <= 0n) throw new Error('amount must be > 0');

	const account = treasuryAccount();
	const transport = evmTransport(chainId, { primaryUrl: evmRpcUrl(chainId) });
	const publicClient = createPublicClient({ chain, transport });
	const walletClient = createWalletClient({ account, chain, transport });

	const data = encodeFunctionData({
		abi: ERC20_TRANSFER_ABI,
		functionName: 'transfer',
		args: [recipient, amt],
	});

	const request = await walletClient.prepareTransactionRequest({
		to: usdc,
		data,
		value: 0n,
	});
	const serializedTransaction = await walletClient.signTransaction(request);
	const hash = keccak256(serializedTransaction);

	if (typeof onSigned === 'function') {
		await onSigned({ hash, nonce: Number(request.nonce) });
	}

	await publicClient.sendRawTransaction({ serializedTransaction });

	const receipt = await publicClient.waitForTransactionReceipt({
		hash,
		timeout: SEND_TIMEOUT_MS,
		confirmations: CONFIRMATIONS,
	});
	if (receipt.status !== 'success') {
		throw new Error(`evm_tx_reverted: ${hash}`);
	}

	return { hash, chainId, amount: amt.toString() };
}

/**
 * Chain-id lookup so `agent_withdrawals.chain` text values map to integers.
 * Supports both the canonical chain names and numeric strings.
 */
export function resolveEvmChainId(chain) {
	if (chain == null) return null;
	const lower = String(chain).toLowerCase();
	const named = {
		ethereum: 1,
		eth: 1,
		mainnet: 1,
		base: 8453,
		optimism: 10,
		op: 10,
		arbitrum: 42161,
		arb: 42161,
		polygon: 137,
		matic: 137,
		sepolia: 11155111,
		'base-sepolia': 84532,
	};
	if (named[lower]) return named[lower];
	const n = Number(lower);
	if (Number.isInteger(n) && CHAINS[n]) return n;
	return null;
}

export { CHAINS as EVM_CHAINS };
