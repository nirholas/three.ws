// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

/**
 * ABI for the EVM Agent Payments contract.
 * Mirrors the Solana pump_agent_payments program interface.
 *
 * Functions:
 *   createAgent       — register an agent (mirrors agentInitialize)
 *   acceptPayment     — user pays agent (mirrors agentAcceptPayment)
 *   distributePayments— split vault to buyback + withdraw (mirrors agentDistributePayments)
 *   buybackTrigger    — swap + burn agent token (mirrors agentBuybackTrigger)
 *   withdraw          — owner pulls from withdraw vault (mirrors agentWithdraw)
 *   updateBuybackBps  — change buyback split
 *   updateAuthority   — transfer agent authority
 */
export const AGENT_PAYMENTS_ABI = [
  // ── Write functions ──────────────────────────────────────────────────────

  {
    name: "createAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "agentAuthority", type: "address" },
      { name: "buybackBps", type: "uint16" },
    ],
    outputs: [],
  },

  {
    name: "acceptPayment",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memo", type: "uint64" },
      { name: "startTime", type: "int64" },
      { name: "endTime", type: "int64" },
    ],
    outputs: [{ name: "invoiceId", type: "bytes32" }],
  },

  {
    name: "acceptPaymentNative",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "memo", type: "uint64" },
      { name: "startTime", type: "int64" },
      { name: "endTime", type: "int64" },
    ],
    outputs: [{ name: "invoiceId", type: "bytes32" }],
  },

  {
    name: "distributePayments",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" },
    ],
    outputs: [],
  },

  {
    name: "buybackTrigger",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" },
      { name: "swapRouter", type: "address" },
      { name: "swapData", type: "bytes" },
    ],
    outputs: [{ name: "tokensBurned", type: "uint256" }],
  },

  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },

  {
    name: "updateBuybackBps",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "buybackBps", type: "uint16" },
    ],
    outputs: [],
  },

  {
    name: "updateAuthority",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "newAuthority", type: "address" },
    ],
    outputs: [],
  },

  // ── Read functions ───────────────────────────────────────────────────────

  {
    name: "getAgentConfig",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentToken", type: "address" }],
    outputs: [
      { name: "authority", type: "address" },
      { name: "buybackBps", type: "uint16" },
      { name: "exists", type: "bool" },
    ],
  },

  {
    name: "getBalances",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" },
    ],
    outputs: [
      { name: "paymentVault", type: "uint256" },
      { name: "buybackVault", type: "uint256" },
      { name: "withdrawVault", type: "uint256" },
    ],
  },

  {
    name: "getPaymentStats",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" },
    ],
    outputs: [
      { name: "totalPayments", type: "uint256" },
      { name: "totalBuybacks", type: "uint256" },
      { name: "totalWithdrawn", type: "uint256" },
      { name: "tokensBurned", type: "uint256" },
    ],
  },

  {
    name: "isInvoicePaid",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },

  // ── Events ───────────────────────────────────────────────────────────────

  {
    name: "AgentCreated",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "authority", type: "address", indexed: true },
      { name: "buybackBps", type: "uint16", indexed: false },
    ],
  },

  {
    name: "PaymentAccepted",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "currencyToken", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "memo", type: "uint64", indexed: false },
      { name: "invoiceId", type: "bytes32", indexed: false },
    ],
  },

  {
    name: "PaymentsDistributed",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "currencyToken", type: "address", indexed: false },
      { name: "buybackAmount", type: "uint256", indexed: false },
      { name: "withdrawAmount", type: "uint256", indexed: false },
    ],
  },

  {
    name: "BuybackTriggered",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "currencyToken", type: "address", indexed: false },
      { name: "currencySpent", type: "uint256", indexed: false },
      { name: "tokensBurned", type: "uint256", indexed: false },
    ],
  },

  {
    name: "Withdrawn",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "authority", type: "address", indexed: true },
      { name: "currencyToken", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "receiver", type: "address", indexed: false },
    ],
  },

  {
    name: "AuthorityUpdated",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "oldAuthority", type: "address", indexed: false },
      { name: "newAuthority", type: "address", indexed: false },
    ],
  },

  {
    name: "BuybackBpsUpdated",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "oldBps", type: "uint16", indexed: false },
      { name: "newBps", type: "uint16", indexed: false },
    ],
  },
] as const;

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
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
