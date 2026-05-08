// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

/** Pump.fun cross-chain deposit API (MoonPay-powered) */
export const PUMP_CROSSCHAIN_API = "https://api.pump.fun/crosschain";

/** MoonPay widget base URL for fallback UI */
export const MOONPAY_WIDGET_URL = "https://buy.moonpay.com";

/** Solana USDC mint */
export const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Pump Agent Payments program */
export const PUMP_AGENT_PAYMENTS_PROGRAM = "AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7";

/** ERC-20 transfer + approve function selectors */
export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Quote expiry buffer — reject quotes within this many seconds of expiry */
export const QUOTE_EXPIRY_BUFFER_SECONDS = 30;

/** How often to poll for cross-chain payment status (ms) */
export const STATUS_POLL_INTERVAL_MS = 5_000;

/** Max wait before declaring a cross-chain payment failed (ms) */
export const STATUS_TIMEOUT_MS = 30 * 60 * 1_000; // 30 min
