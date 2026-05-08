// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import type { Address } from "viem";

export type EvmChainId = 1 | 8453 | 42161 | 137 | 56 | 43114;

export interface EvmChainConfig {
  id: EvmChainId;
  name: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** USDC token address on this chain */
  usdc: Address;
  /** WETH/wrapped native address */
  wrappedNative: Address;
  /** Deployed AgentPayments contract — set after deployment */
  agentPayments: Address;
}

/** Placeholder — replace with deployed contract addresses post-deployment */
const UNDEPLOYED = "0x0000000000000000000000000000000000000000" as Address;

export const EVM_CHAINS: Record<EvmChainId, EvmChainConfig> = {
  1: {
    id: 1,
    name: "Ethereum",
    rpcUrl: "https://eth.llamarpc.com",
    blockExplorer: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    wrappedNative: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    agentPayments: UNDEPLOYED,
  },
  8453: {
    id: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    wrappedNative: "0x4200000000000000000000000000000000000006",
    agentPayments: UNDEPLOYED,
  },
  42161: {
    id: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    blockExplorer: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    wrappedNative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    agentPayments: UNDEPLOYED,
  },
  137: {
    id: 137,
    name: "Polygon",
    rpcUrl: "https://polygon-rpc.com",
    blockExplorer: "https://polygonscan.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    wrappedNative: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    agentPayments: UNDEPLOYED,
  },
  56: {
    id: 56,
    name: "BNB Smart Chain",
    rpcUrl: "https://bsc-dataseed.binance.org",
    blockExplorer: "https://bscscan.com",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    wrappedNative: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    agentPayments: UNDEPLOYED,
  },
  43114: {
    id: 43114,
    name: "Avalanche",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    blockExplorer: "https://snowtrace.io",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    wrappedNative: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    agentPayments: UNDEPLOYED,
  },
};

export const SUPPORTED_CHAIN_IDS = Object.keys(EVM_CHAINS).map(Number) as EvmChainId[];

export function getEvmChain(chainId: EvmChainId): EvmChainConfig {
  const chain = EVM_CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported EVM chain: ${chainId}`);
  return chain;
}

export function isEvmChainSupported(chainId: number): chainId is EvmChainId {
  return chainId in EVM_CHAINS;
}

/** Native ETH/BNB/AVAX sentinel address (matches EIP-7528) */
export const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
