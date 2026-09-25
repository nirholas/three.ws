// The EVM leg's chains: Base and Robinhood Chain.
//
// Solana is the home chain; this module describes the secondary leg every agent
// also has. One custodial EVM address (agent_identities.wallet_address, key in
// meta.encrypted_wallet_key, generated at agent creation exactly like the
// Solana wallet) works on both chains, because an EVM address is the same on
// every EVM chain.
//
// Each chain entry carries what the wallet, transfer, launch and payment paths
// need, and nothing is hardcoded that the libraries already know: the chain
// object (name, native gas coin, explorer) comes from viem or from the
// Robinhood Chain definition in api/_lib/robinhood.js, RPC failover comes from
// the platform's shared EVM transports, and USDC comes from the payments config.
//
// Robinhood Chain is treated as a crypto venue only. Its USDC contract is not
// in the platform's payments config yet, so USDC on that chain lights up when
// ROBINHOOD_CHAIN_USDC_ADDRESS is set; until then the chain shows its native
// balance and USDC is reported as not configured, never as zero.

import { createPublicClient, createWalletClient, fallback, http } from 'viem';
import { base } from 'viem/chains';

import { EVM_USDC } from '../../payments/_config.js';
import { evmTransport } from '../evm/rpc.js';
import { evmNativeCoingeckoId } from '../evm/chain-market.js';
import { HOOD_MAINNET, rpcUrls as hoodRpcUrls } from '../robinhood.js';

const USDC_DECIMALS = 6;

function hoodTransport() {
	const urls = hoodRpcUrls(false);
	const opts = { timeout: 12_000, retryCount: 2 };
	return urls.length === 1 ? http(urls[0], opts) : fallback(urls.map((u) => http(u, opts)), { rank: false });
}

function isAddressLike(v) {
	return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v.trim());
}

/**
 * The chains of the EVM leg, in the order every surface lists them (after
 * Solana). `slug` is what APIs, tools and the custody ledger's `network`
 * column use.
 */
export const EVM_LEG_CHAINS = Object.freeze({
	base: Object.freeze({
		slug: 'base',
		chainId: base.id,
		caip2: `eip155:${base.id}`,
		name: base.name,
		viemChain: base,
		transport: () => evmTransport(base.id, { retryCount: 1, timeout: 12_000 }),
		usdc: () => EVM_USDC[base.id] || null,
		// x402 on Base runs through the existing EVM exact scheme.
		x402: true,
	}),
	robinhood: Object.freeze({
		slug: 'robinhood',
		chainId: HOOD_MAINNET.id,
		caip2: `eip155:${HOOD_MAINNET.id}`,
		name: HOOD_MAINNET.name,
		viemChain: HOOD_MAINNET,
		transport: hoodTransport,
		usdc: () => {
			const v = process.env.ROBINHOOD_CHAIN_USDC_ADDRESS;
			return isAddressLike(v) ? v.trim() : null;
		},
		x402: false,
	}),
});

export const EVM_LEG_SLUGS = Object.freeze(Object.keys(EVM_LEG_CHAINS));

/** The chain entry for a slug, chain id or CAIP-2 id, or null. */
export function evmLegChain(ref) {
	if (ref == null || ref === '') return null;
	const s = String(ref).trim().toLowerCase();
	if (EVM_LEG_CHAINS[s]) return EVM_LEG_CHAINS[s];
	return Object.values(EVM_LEG_CHAINS).find((c) => String(c.chainId) === s || c.caip2 === s) || null;
}

/** A chain entry or a ToolInputError-shaped throw naming the supported slugs. */
export function requireEvmLegChain(ref) {
	const c = evmLegChain(ref);
	if (!c) {
		throw Object.assign(new Error(`chain must be one of ${EVM_LEG_SLUGS.join(', ')}`), {
			status: 400,
			code: 'unsupported_chain',
		});
	}
	return c;
}

const publicClients = new Map();

/** Cached read client for one chain of the leg. */
export function evmLegPublicClient(chain) {
	const c = typeof chain === 'string' ? requireEvmLegChain(chain) : chain;
	if (!publicClients.has(c.slug)) {
		publicClients.set(c.slug, createPublicClient({ chain: c.viemChain, transport: c.transport() }));
	}
	return publicClients.get(c.slug);
}

/** A signing client for one chain, bound to a viem account. Never cached. */
export function evmLegWalletClient(chain, account) {
	const c = typeof chain === 'string' ? requireEvmLegChain(chain) : chain;
	return createWalletClient({ chain: c.viemChain, transport: c.transport(), account });
}

/** The native gas coin as the chain definition names it. */
export function nativeCurrency(chain) {
	return chain.viemChain.nativeCurrency;
}

/**
 * The market-data id that prices this chain's native gas coin. A chain the
 * market table does not list, but whose gas coin is the same asset as Base's,
 * is priced like Base.
 */
export function nativePriceId(chain) {
	const direct = evmNativeCoingeckoId(chain.chainId);
	if (direct) return direct;
	return chain.viemChain.nativeCurrency.symbol === base.nativeCurrency.symbol ? evmNativeCoingeckoId(base.id) : null;
}

/** Explorer links from the chain definition. */
export function explorerAddress(chain, address) {
	const root = chain.viemChain.blockExplorers?.default?.url;
	return root ? `${root.replace(/\/+$/, '')}/address/${address}` : null;
}

export function explorerTx(chain, hash) {
	const root = chain.viemChain.blockExplorers?.default?.url;
	return root ? `${root.replace(/\/+$/, '')}/tx/${hash}` : null;
}

export { USDC_DECIMALS };
