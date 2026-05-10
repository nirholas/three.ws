'use strict';

var viem = require('viem');

// src/evm/EvmAgentOffline.ts

// src/evm/abi.ts
var AGENT_PAYMENTS_ABI = [
  // ── Write functions ──────────────────────────────────────────────────────
  {
    name: "createAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "agentAuthority", type: "address" },
      { name: "buybackBps", type: "uint16" }
    ],
    outputs: []
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
      { name: "endTime", type: "int64" }
    ],
    outputs: [{ name: "invoiceId", type: "bytes32" }]
  },
  {
    name: "acceptPaymentNative",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "memo", type: "uint64" },
      { name: "startTime", type: "int64" },
      { name: "endTime", type: "int64" }
    ],
    outputs: [{ name: "invoiceId", type: "bytes32" }]
  },
  {
    name: "distributePayments",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" }
    ],
    outputs: []
  },
  {
    name: "buybackTrigger",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" },
      { name: "swapRouter", type: "address" },
      { name: "swapData", type: "bytes" }
    ],
    outputs: [{ name: "tokensBurned", type: "uint256" }]
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" },
      { name: "receiver", type: "address" }
    ],
    outputs: [{ name: "amount", type: "uint256" }]
  },
  {
    name: "updateBuybackBps",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "buybackBps", type: "uint16" }
    ],
    outputs: []
  },
  {
    name: "updateAuthority",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "newAuthority", type: "address" }
    ],
    outputs: []
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
      { name: "exists", type: "bool" }
    ]
  },
  {
    name: "getBalances",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" }
    ],
    outputs: [
      { name: "paymentVault", type: "uint256" },
      { name: "buybackVault", type: "uint256" },
      { name: "withdrawVault", type: "uint256" }
    ]
  },
  {
    name: "getPaymentStats",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentToken", type: "address" },
      { name: "currencyToken", type: "address" }
    ],
    outputs: [
      { name: "totalPayments", type: "uint256" },
      { name: "totalBuybacks", type: "uint256" },
      { name: "totalWithdrawn", type: "uint256" },
      { name: "tokensBurned", type: "uint256" }
    ]
  },
  {
    name: "isInvoicePaid",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }]
  },
  // ── Events ───────────────────────────────────────────────────────────────
  {
    name: "AgentCreated",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "authority", type: "address", indexed: true },
      { name: "buybackBps", type: "uint16", indexed: false }
    ]
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
      { name: "invoiceId", type: "bytes32", indexed: false }
    ]
  },
  {
    name: "PaymentsDistributed",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "currencyToken", type: "address", indexed: false },
      { name: "buybackAmount", type: "uint256", indexed: false },
      { name: "withdrawAmount", type: "uint256", indexed: false }
    ]
  },
  {
    name: "BuybackTriggered",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "currencyToken", type: "address", indexed: false },
      { name: "currencySpent", type: "uint256", indexed: false },
      { name: "tokensBurned", type: "uint256", indexed: false }
    ]
  },
  {
    name: "Withdrawn",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "authority", type: "address", indexed: true },
      { name: "currencyToken", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "receiver", type: "address", indexed: false }
    ]
  },
  {
    name: "AuthorityUpdated",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "oldAuthority", type: "address", indexed: false },
      { name: "newAuthority", type: "address", indexed: false }
    ]
  },
  {
    name: "BuybackBpsUpdated",
    type: "event",
    inputs: [
      { name: "agentToken", type: "address", indexed: true },
      { name: "oldBps", type: "uint16", indexed: false },
      { name: "newBps", type: "uint16", indexed: false }
    ]
  }
];
var ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }]
  }
];

// src/evm/addresses.ts
var UNDEPLOYED = "0x0000000000000000000000000000000000000000";
var EVM_CHAINS = {
  1: {
    id: 1,
    name: "Ethereum",
    rpcUrl: "https://eth.llamarpc.com",
    blockExplorer: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    wrappedNative: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    agentPayments: UNDEPLOYED
  },
  8453: {
    id: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    wrappedNative: "0x4200000000000000000000000000000000000006",
    agentPayments: UNDEPLOYED
  },
  42161: {
    id: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    blockExplorer: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    wrappedNative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    agentPayments: UNDEPLOYED
  },
  137: {
    id: 137,
    name: "Polygon",
    rpcUrl: "https://polygon-rpc.com",
    blockExplorer: "https://polygonscan.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    wrappedNative: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    agentPayments: UNDEPLOYED
  },
  56: {
    id: 56,
    name: "BNB Smart Chain",
    rpcUrl: "https://bsc-dataseed.binance.org",
    blockExplorer: "https://bscscan.com",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    wrappedNative: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    agentPayments: UNDEPLOYED
  },
  43114: {
    id: 43114,
    name: "Avalanche",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    blockExplorer: "https://snowtrace.io",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    wrappedNative: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    agentPayments: UNDEPLOYED
  }
};
var SUPPORTED_CHAIN_IDS = Object.keys(EVM_CHAINS).map(Number);
function getEvmChain(chainId) {
  const chain = EVM_CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported EVM chain: ${chainId}`);
  return chain;
}
function isEvmChainSupported(chainId) {
  return chainId in EVM_CHAINS;
}
var NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
function getInvoiceId(agentToken, currencyToken, amount, memo, startTime, endTime) {
  return viem.keccak256(
    viem.encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint64" },
        { type: "int64" },
        { type: "int64" }
      ],
      [agentToken, currencyToken, amount, memo, startTime, endTime]
    )
  );
}
function buildInvoiceWindow(windowSeconds = 300) {
  const now = BigInt(Math.floor(Date.now() / 1e3));
  return {
    startTime: now,
    endTime: now + BigInt(windowSeconds)
  };
}
function generateMemo() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return arr.reduce((acc, byte) => acc << 8n | BigInt(byte), 0n);
}

// src/evm/EvmAgentOffline.ts
var EvmAgentOffline = class {
  constructor(agentToken, chainId) {
    this.agentToken = agentToken;
    this.chainId = chainId;
    this.contractAddress = getEvmChain(chainId).agentPayments;
  }
  // ── Agent setup ────────────────────────────────────────────────────────────
  /** Build the createAgent transaction (one-time agent registration). */
  buildCreateAgentTx(params) {
    return {
      to: this.contractAddress,
      data: viem.encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "createAgent",
        args: [params.agentToken, params.agentAuthority, params.buybackBps]
      }),
      value: 0n,
      chainId: this.chainId
    };
  }
  // ── Payment acceptance ────────────────────────────────────────────────────
  /**
   * Build the acceptPayment transaction bundle.
   * Returns an optional ERC-20 approval + the main payment tx.
   *
   * For native currency (ETH/BNB/AVAX), pass currencyToken as "native".
   * The value field on the tx will be set to the payment amount.
   */
  buildAcceptPaymentTx(params, _payer) {
    const isNative = params.currencyToken === "native";
    if (isNative) {
      return {
        tx: {
          to: this.contractAddress,
          data: viem.encodeFunctionData({
            abi: AGENT_PAYMENTS_ABI,
            functionName: "acceptPaymentNative",
            args: [
              params.agentToken,
              params.memo,
              params.startTime,
              params.endTime
            ]
          }),
          value: params.amount,
          chainId: this.chainId
        }
      };
    }
    const approval = {
      to: params.currencyToken,
      data: viem.encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [this.contractAddress, viem.maxUint256]
      }),
      value: 0n,
      chainId: this.chainId
    };
    const tx = {
      to: this.contractAddress,
      data: viem.encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "acceptPayment",
        args: [
          params.agentToken,
          params.currencyToken,
          params.amount,
          params.memo,
          params.startTime,
          params.endTime
        ]
      }),
      value: 0n,
      chainId: this.chainId
    };
    return { approval, tx };
  }
  /**
   * Convenience wrapper: auto-generates memo + time window.
   * Mirrors PumpAgentOffline.buildAcceptPaymentInstructions().
   */
  buildAcceptPaymentInstructions(opts) {
    const memo = generateMemo();
    const { startTime, endTime } = buildInvoiceWindow(opts.windowSeconds);
    const currencyAddress = opts.currencyToken === "native" ? NATIVE_TOKEN_ADDRESS : opts.currencyToken;
    const invoiceId = getInvoiceId(
      opts.agentToken,
      currencyAddress,
      opts.amount,
      memo,
      startTime,
      endTime
    );
    const bundle = this.buildAcceptPaymentTx(
      {
        agentToken: opts.agentToken,
        currencyToken: opts.currencyToken,
        amount: opts.amount,
        memo,
        startTime,
        endTime
      },
      opts.payer
    );
    return { bundle, memo, invoiceId };
  }
  // ── Distribution + buyback ─────────────────────────────────────────────────
  /** Build the distributePayments transaction. Permissionless. */
  buildDistributePaymentsTx(params) {
    return {
      to: this.contractAddress,
      data: viem.encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "distributePayments",
        args: [params.agentToken, params.currencyToken]
      }),
      value: 0n,
      chainId: this.chainId
    };
  }
  /** Build the buybackTrigger transaction. Caller must be global buyback authority. */
  buildBuybackTriggerTx(params) {
    return {
      to: this.contractAddress,
      data: viem.encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "buybackTrigger",
        args: [
          params.agentToken,
          params.currencyToken,
          params.swapRouter,
          params.swapData
        ]
      }),
      value: 0n,
      chainId: this.chainId
    };
  }
  // ── Withdrawal ─────────────────────────────────────────────────────────────
  /** Build the withdraw transaction. Caller must be agent authority. */
  buildWithdrawTx(params) {
    return {
      to: this.contractAddress,
      data: viem.encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "withdraw",
        args: [params.agentToken, params.currencyToken, params.receiver]
      }),
      value: 0n,
      chainId: this.chainId
    };
  }
  // ── Config updates ─────────────────────────────────────────────────────────
  buildUpdateBuybackBpsTx(params) {
    return {
      to: this.contractAddress,
      data: viem.encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "updateBuybackBps",
        args: [params.agentToken, params.buybackBps]
      }),
      value: 0n,
      chainId: this.chainId
    };
  }
  buildUpdateAuthorityTx(params) {
    return {
      to: this.contractAddress,
      data: viem.encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "updateAuthority",
        args: [params.agentToken, params.newAuthority]
      }),
      value: 0n,
      chainId: this.chainId
    };
  }
  // ── Helpers ────────────────────────────────────────────────────────────────
  /** Compute the invoice ID for a payment without sending anything. */
  computeInvoiceId(currencyToken, amount, memo, startTime, endTime) {
    const currency = currencyToken === "native" ? NATIVE_TOKEN_ADDRESS : currencyToken;
    return getInvoiceId(this.agentToken, currency, amount, memo, startTime, endTime);
  }
};

// src/evm/events.ts
function parseEvmAgentEvents(logs) {
  const events = [];
  for (const log of logs) {
    const name = log.eventName;
    const args = log.args ?? {};
    const meta = {
      txHash: log.transactionHash ?? "0x",
      blockNumber: log.blockNumber ?? 0n
    };
    try {
      switch (name) {
        case "AgentCreated":
          events.push({
            name: "AgentCreated",
            agentToken: args.agentToken,
            authority: args.authority,
            buybackBps: Number(args.buybackBps),
            ...meta
          });
          break;
        case "PaymentAccepted":
          events.push({
            name: "PaymentAccepted",
            agentToken: args.agentToken,
            payer: args.payer,
            currencyToken: args.currencyToken,
            amount: BigInt(String(args.amount ?? 0n)),
            memo: BigInt(String(args.memo ?? 0n)),
            invoiceId: args.invoiceId,
            ...meta
          });
          break;
        case "PaymentsDistributed":
          events.push({
            name: "PaymentsDistributed",
            agentToken: args.agentToken,
            currencyToken: args.currencyToken,
            buybackAmount: BigInt(String(args.buybackAmount ?? 0n)),
            withdrawAmount: BigInt(String(args.withdrawAmount ?? 0n)),
            ...meta
          });
          break;
        case "BuybackTriggered":
          events.push({
            name: "BuybackTriggered",
            agentToken: args.agentToken,
            currencyToken: args.currencyToken,
            currencySpent: BigInt(String(args.currencySpent ?? 0n)),
            tokensBurned: BigInt(String(args.tokensBurned ?? 0n)),
            ...meta
          });
          break;
        case "Withdrawn":
          events.push({
            name: "Withdrawn",
            agentToken: args.agentToken,
            authority: args.authority,
            currencyToken: args.currencyToken,
            amount: BigInt(String(args.amount ?? 0n)),
            receiver: args.receiver,
            ...meta
          });
          break;
      }
    } catch {
    }
  }
  return events;
}

// src/evm/EvmAgent.ts
var EvmAgent = class extends EvmAgentOffline {
  constructor(agentToken, chainId, rpcUrl) {
    super(agentToken, chainId);
    const chain = getEvmChain(chainId);
    this.client = viem.createPublicClient({
      transport: viem.http(rpcUrl ?? chain.rpcUrl)
    });
  }
  // ── Read functions ────────────────────────────────────────────────────────
  /** Fetch the agent's on-chain config. Mirrors PumpAgent.getAgentConfig(). */
  async getAgentConfig() {
    const [authority, buybackBps, exists] = await this.client.readContract({
      address: this.contractAddress,
      abi: AGENT_PAYMENTS_ABI,
      functionName: "getAgentConfig",
      args: [this.agentToken]
    });
    return { agentToken: this.agentToken, authority, buybackBps, exists };
  }
  /** Fetch vault balances for a given currency. Mirrors PumpAgent.getAgentBalances(). */
  async getBalances(currencyToken) {
    const [paymentVault, buybackVault, withdrawVault] = await this.client.readContract({
      address: this.contractAddress,
      abi: AGENT_PAYMENTS_ABI,
      functionName: "getBalances",
      args: [this.agentToken, currencyToken]
    });
    return {
      agentToken: this.agentToken,
      currencyToken,
      paymentVault,
      buybackVault,
      withdrawVault
    };
  }
  /** Fetch cumulative payment stats. Mirrors PumpAgent.getPaymentStats(). */
  async getPaymentStats(currencyToken) {
    const [totalPayments, totalBuybacks, totalWithdrawn, tokensBurned] = await this.client.readContract({
      address: this.contractAddress,
      abi: AGENT_PAYMENTS_ABI,
      functionName: "getPaymentStats",
      args: [this.agentToken, currencyToken]
    });
    return {
      agentToken: this.agentToken,
      currencyToken,
      totalPayments,
      totalBuybacks,
      totalWithdrawn,
      tokensBurned
    };
  }
  /** Check if an invoice has already been paid. */
  async isInvoicePaid(invoiceId) {
    return this.client.readContract({
      address: this.contractAddress,
      abi: AGENT_PAYMENTS_ABI,
      functionName: "isInvoicePaid",
      args: [invoiceId]
    });
  }
  // ── Invoice validation ────────────────────────────────────────────────────
  /**
   * Validate that a specific invoice has been paid on-chain.
   * Mirrors PumpAgent.validateInvoicePayment().
   *
   * Primary path: checks the isInvoicePaid mapping directly.
   * Fallback: scans PaymentAccepted events for matching parameters.
   */
  async validateInvoicePayment(params) {
    const currency = params.currencyToken === "native" ? NATIVE_TOKEN_ADDRESS : params.currencyToken;
    const invoiceId = getInvoiceId(
      this.agentToken,
      currency,
      params.amount,
      params.memo,
      params.startTime,
      params.endTime
    );
    const paid = await this.isInvoicePaid(invoiceId);
    if (paid) {
      return { paid: true, invoiceId };
    }
    try {
      const logs = await this.client.getLogs({
        address: this.contractAddress,
        event: AGENT_PAYMENTS_ABI.find((x) => x.type === "event" && x.name === "PaymentAccepted"),
        args: { agentToken: this.agentToken, payer: params.payer },
        fromBlock: "earliest"
      });
      const events = parseEvmAgentEvents(logs);
      const match = events.find(
        (e) => e.name === "PaymentAccepted" && e.invoiceId.toLowerCase() === invoiceId.toLowerCase()
      );
      if (match) {
        return {
          paid: true,
          invoiceId,
          txHash: match.txHash,
          blockNumber: match.blockNumber
        };
      }
    } catch {
    }
    return { paid: false, invoiceId };
  }
  /**
   * Get recent PaymentAccepted events for this agent.
   * Mirrors PumpAgent payment history queries.
   */
  async getPaymentHistory(opts = {}) {
    const logs = await this.client.getLogs({
      address: this.contractAddress,
      event: AGENT_PAYMENTS_ABI.find((x) => x.type === "event" && x.name === "PaymentAccepted"),
      args: {
        agentToken: this.agentToken,
        ...opts.payer ? { payer: opts.payer } : {}
      },
      fromBlock: opts.fromBlock ?? "earliest",
      toBlock: opts.toBlock ?? "latest"
    });
    return parseEvmAgentEvents(logs).filter(
      (e) => e.name === "PaymentAccepted" && (!opts.currencyToken || e.currencyToken.toLowerCase() === opts.currencyToken.toLowerCase())
    );
  }
};

exports.AGENT_PAYMENTS_ABI = AGENT_PAYMENTS_ABI;
exports.ERC20_ABI = ERC20_ABI;
exports.EVM_CHAINS = EVM_CHAINS;
exports.EvmAgent = EvmAgent;
exports.EvmAgentOffline = EvmAgentOffline;
exports.NATIVE_TOKEN_ADDRESS = NATIVE_TOKEN_ADDRESS;
exports.SUPPORTED_CHAIN_IDS = SUPPORTED_CHAIN_IDS;
exports.buildInvoiceWindow = buildInvoiceWindow;
exports.generateMemo = generateMemo;
exports.getEvmChain = getEvmChain;
exports.getInvoiceId = getInvoiceId;
exports.isEvmChainSupported = isEvmChainSupported;
exports.parseEvmAgentEvents = parseEvmAgentEvents;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map