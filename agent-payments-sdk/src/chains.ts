// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import type { EvmChainConfig, SupportedEvmChainId } from "./types.js";

export const EVM_CHAINS: Record<SupportedEvmChainId, EvmChainConfig> = {
  1: {
    id: 1,
    name: "Ethereum",
    rpcUrl: "https://eth.llamarpc.com",
    blockExplorer: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    moonpayNetwork: "eth",
  },
  8453: {
    id: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    moonpayNetwork: "base",
  },
  42161: {
    id: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    blockExplorer: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    moonpayNetwork: "arbitrum",
  },
  137: {
    id: 137,
    name: "Polygon",
    rpcUrl: "https://polygon-rpc.com",
    blockExplorer: "https://polygonscan.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    moonpayNetwork: "polygon",
  },
  56: {
    id: 56,
    name: "BNB Smart Chain",
    rpcUrl: "https://bsc-dataseed.binance.org",
    blockExplorer: "https://bscscan.com",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    moonpayNetwork: "bsc",
  },
  43114: {
    id: 43114,
    name: "Avalanche",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    blockExplorer: "https://snowtrace.io",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    moonpayNetwork: "avaxc",
  },
};

export const SUPPORTED_CHAIN_IDS = Object.keys(EVM_CHAINS).map(Number) as SupportedEvmChainId[];

export function getChain(chainId: SupportedEvmChainId): EvmChainConfig {
  const chain = EVM_CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  return chain;
}

export function isSupported(chainId: number): chainId is SupportedEvmChainId {
  return chainId in EVM_CHAINS;
}
