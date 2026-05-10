import { encodeFunctionData, maxUint256 } from 'viem';

var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/chains.ts
function getChain(chainId) {
  const chain = EVM_CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  return chain;
}
var EVM_CHAINS;
var init_chains = __esm({
  "src/chains.ts"() {
    EVM_CHAINS = {
      1: {
        id: 1,
        name: "Ethereum",
        rpcUrl: "https://eth.llamarpc.com",
        blockExplorer: "https://etherscan.io",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        moonpayNetwork: "eth"
      },
      8453: {
        id: 8453,
        name: "Base",
        rpcUrl: "https://mainnet.base.org",
        blockExplorer: "https://basescan.org",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        moonpayNetwork: "base"
      },
      42161: {
        id: 42161,
        name: "Arbitrum One",
        rpcUrl: "https://arb1.arbitrum.io/rpc",
        blockExplorer: "https://arbiscan.io",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        moonpayNetwork: "arbitrum"
      },
      137: {
        id: 137,
        name: "Polygon",
        rpcUrl: "https://polygon-rpc.com",
        blockExplorer: "https://polygonscan.com",
        nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
        usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        moonpayNetwork: "polygon"
      },
      56: {
        id: 56,
        name: "BNB Smart Chain",
        rpcUrl: "https://bsc-dataseed.binance.org",
        blockExplorer: "https://bscscan.com",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        moonpayNetwork: "bsc"
      },
      43114: {
        id: 43114,
        name: "Avalanche",
        rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
        blockExplorer: "https://snowtrace.io",
        nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
        usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
        moonpayNetwork: "avaxc"
      }
    };
    Object.keys(EVM_CHAINS).map(Number);
  }
});

// src/constants.ts
var PUMP_CROSSCHAIN_API, ERC20_ABI, QUOTE_EXPIRY_BUFFER_SECONDS;
var init_constants = __esm({
  "src/constants.ts"() {
    PUMP_CROSSCHAIN_API = "https://api.pump.fun/crosschain";
    ERC20_ABI = [
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
      }
    ];
    QUOTE_EXPIRY_BUFFER_SECONDS = 30;
  }
});

// src/evm/quote.ts
var quote_exports = {};
__export(quote_exports, {
  assertQuoteValid: () => assertQuoteValid,
  getQuote: () => getQuote,
  getTokenUsdPrice: () => getTokenUsdPrice
});
async function getQuote(request, apiKey) {
  const chain = getChain(request.fromChainId);
  const fromTokenAddr = request.fromToken === "native" ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : request.fromToken;
  const params = new URLSearchParams({
    fromChainId: String(request.fromChainId),
    fromToken: fromTokenAddr,
    fromAmount: String(request.fromAmount),
    toNetwork: "solana",
    toToken: "usdc",
    agentMint: request.agentMint,
    fromNetwork: chain.moonpayNetwork
  });
  const headers = {
    "Content-Type": "application/json"
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(`${PUMP_CROSSCHAIN_API}/quote?${params}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Quote request failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return {
    fromChainId: request.fromChainId,
    fromToken: request.fromToken,
    fromAmount: BigInt(data.fromAmount),
    toAmountUsdc: BigInt(data.toAmountUsdc),
    estimatedUsd: data.estimatedUsd,
    bridgeFeeUsd: data.bridgeFeeUsd,
    estimatedTimeSeconds: data.estimatedTimeSeconds,
    quoteId: data.quoteId,
    expiresAt: data.expiresAt
  };
}
function assertQuoteValid(quote) {
  const nowSeconds = Math.floor(Date.now() / 1e3);
  if (nowSeconds >= quote.expiresAt - QUOTE_EXPIRY_BUFFER_SECONDS) {
    throw new Error(
      `Quote ${quote.quoteId} has expired. Fetch a new quote before submitting.`
    );
  }
}
async function getTokenUsdPrice(chainId, tokenAddress) {
  const chain = getChain(chainId);
  const addr = tokenAddress === "native" ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : tokenAddress;
  const res = await fetch(
    `${PUMP_CROSSCHAIN_API}/price?network=${chain.moonpayNetwork}&token=${addr}`
  );
  if (!res.ok) throw new Error(`Price fetch failed (${res.status})`);
  const data = await res.json();
  return data.usdPrice;
}
var init_quote = __esm({
  "src/evm/quote.ts"() {
    init_chains();
    init_constants();
  }
});

// src/evm/transaction.ts
var transaction_exports = {};
__export(transaction_exports, {
  buildEvmPaymentTransaction: () => buildEvmPaymentTransaction,
  checkAllowance: () => checkAllowance
});
async function buildEvmPaymentTransaction(params, apiKey) {
  assertQuoteValid(params.quote);
  getChain(params.quote.fromChainId);
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(`${PUMP_CROSSCHAIN_API}/build-tx`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      quoteId: params.quote.quoteId,
      fromChainId: params.quote.fromChainId,
      fromToken: params.quote.fromToken === "native" ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : params.quote.fromToken,
      fromAmount: params.quote.fromAmount.toString(),
      sender: params.sender,
      agentMint: params.agentMint,
      destinationSolanaWallet: params.destinationSolanaWallet,
      memo: params.memo
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bridge tx build failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  const bridge = {
    to: data.to,
    data: data.data,
    value: BigInt(data.value),
    chainId: params.quote.fromChainId
  };
  if (params.quote.fromToken !== "native" && data.approvalSpender) {
    const approvalData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [data.approvalSpender, maxUint256]
    });
    return {
      approval: {
        to: params.quote.fromToken,
        data: approvalData,
        value: 0n
      },
      bridge
    };
  }
  return { bridge };
}
async function checkAllowance(tokenAddress, owner, spender, amount, rpcUrl) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [
      {
        to: tokenAddress,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [owner, spender]
        })
      },
      "latest"
    ]
  };
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  const allowance = BigInt(json.result);
  return allowance >= amount;
}
var init_transaction = __esm({
  "src/evm/transaction.ts"() {
    init_chains();
    init_constants();
    init_quote();
  }
});

// src/x402/evm-client.ts
init_chains();
function createEvmX402Fetch(opts) {
  return async function x402Fetch(input, init) {
    const firstRes = await fetch(input, init);
    if (firstRes.status !== 402) return firstRes;
    const requirementsHeader = firstRes.headers.get("X-Payment-Required");
    if (!requirementsHeader) return firstRes;
    let requirements;
    try {
      requirements = JSON.parse(atob(requirementsHeader));
    } catch {
      return firstRes;
    }
    if (requirements.scheme !== "pump-agent-evm") return firstRes;
    if (opts.onPaymentRequired) {
      const confirmed = await opts.onPaymentRequired(requirements);
      if (!confirmed) return firstRes;
    }
    const chain = getChain(opts.walletClient.chainId);
    const { getQuote: getQuote2 } = await Promise.resolve().then(() => (init_quote(), quote_exports));
    const { buildEvmPaymentTransaction: buildEvmPaymentTransaction2 } = await Promise.resolve().then(() => (init_transaction(), transaction_exports));
    const quote = await getQuote2({
      fromChainId: opts.walletClient.chainId,
      fromToken: chain.usdc,
      fromAmount: BigInt(requirements.maxAmountRequired),
      agentMint: requirements.agentMint
    });
    const txs = await buildEvmPaymentTransaction2({
      quote,
      agentMint: requirements.agentMint,
      destinationSolanaWallet: requirements.payTo,
      memo: requirements.memo,
      sender: opts.walletClient.address
    });
    if (txs.approval) {
      await opts.walletClient.sendTransaction({
        to: txs.approval.to,
        data: txs.approval.data,
        value: txs.approval.value,
        chainId: opts.walletClient.chainId
      });
    }
    const bridgeTxHash = await opts.walletClient.sendTransaction({
      to: txs.bridge.to,
      data: txs.bridge.data,
      value: txs.bridge.value,
      chainId: txs.bridge.chainId
    });
    const paymentProof = btoa(
      JSON.stringify({
        scheme: "pump-agent-evm",
        chainId: opts.walletClient.chainId,
        txHash: bridgeTxHash,
        quoteId: quote.quoteId,
        memo: requirements.memo
      })
    );
    if (opts.onPaymentSubmitted) {
      opts.onPaymentSubmitted(bridgeTxHash, quote.quoteId);
    }
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set("X-Payment", paymentProof);
    return fetch(input, { ...init, headers: retryHeaders });
  };
}

// src/evm/validate.ts
init_constants();
async function getPaymentStatus(depositId) {
  const res = await fetch(`${PUMP_CROSSCHAIN_API}/status/${depositId}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Status check failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  const mapped = mapStatus(data.status);
  return {
    status: mapped,
    depositId,
    solanaSignature: data.solanaSignature,
    error: data.error
  };
}
function mapStatus(raw) {
  switch (raw) {
    case "pending":
    case "waitingForDeposit":
      return "pending_evm_confirmation";
    case "processing":
    case "bridging":
    case "inTransit":
      return "bridging";
    case "completed":
    case "settled":
      return "arrived_on_solana";
    case "failed":
    case "expired":
    case "refunded":
      return "failed";
    default:
      return "bridging";
  }
}

// src/x402/evm-facilitator.ts
init_constants();
async function verifyEvmPayment(params) {
  const { proof, expectedMemo, minAmountUsdc, agentMint: _agentMint } = params;
  if (proof.scheme !== "pump-agent-evm") {
    return { valid: false, error: "Unknown payment scheme" };
  }
  if (proof.memo !== expectedMemo) {
    return { valid: false, error: "Memo mismatch" };
  }
  let depositId;
  try {
    const res = await fetch(
      `${PUMP_CROSSCHAIN_API}/deposit?txHash=${proof.txHash}&chainId=${proof.chainId}`
    );
    if (!res.ok) throw new Error(`Deposit lookup failed (${res.status})`);
    const data = await res.json();
    depositId = data.depositId;
    const confirmedAmount = BigInt(data.amountUsdc);
    if (confirmedAmount < minAmountUsdc) {
      return {
        valid: false,
        depositId,
        error: `Insufficient amount: got ${confirmedAmount}, need ${minAmountUsdc}`
      };
    }
  } catch (err) {
    return {
      valid: false,
      error: `EVM tx verification failed: ${err.message}`
    };
  }
  if (!params.waitForSolana) {
    return { valid: true, depositId };
  }
  try {
    const status = await waitWithTimeout(depositId);
    if (status.status === "arrived_on_solana") {
      return {
        valid: true,
        depositId,
        solanaSignature: status.solanaSignature
      };
    }
    return {
      valid: false,
      depositId,
      error: `Payment failed in transit: ${status.error ?? status.status}`
    };
  } catch (err) {
    return {
      valid: false,
      depositId,
      error: `Solana arrival timeout: ${err.message}`
    };
  }
}
async function waitWithTimeout(depositId, maxMs = 6e4) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const status = await getPaymentStatus(depositId);
    if (status.status === "arrived_on_solana" || status.status === "failed") {
      return status;
    }
    await new Promise((r) => setTimeout(r, 3e3));
  }
  throw new Error(`Timed out waiting for Solana arrival (${maxMs}ms)`);
}
function decodePaymentHeader(headerValue) {
  if (!headerValue) return null;
  try {
    const decoded = JSON.parse(atob(headerValue));
    if (decoded.scheme !== "pump-agent-evm") return null;
    return decoded;
  } catch {
    return null;
  }
}
function buildPaymentRequiredHeader(opts) {
  return btoa(
    JSON.stringify({
      scheme: "pump-agent-evm",
      agentMint: opts.agentMint,
      maxAmountRequired: opts.maxAmountUsdc.toString(),
      resource: opts.resource,
      description: opts.description,
      payTo: opts.payTo,
      memo: opts.memo
    })
  );
}

export { buildPaymentRequiredHeader, createEvmX402Fetch, decodePaymentHeader, verifyEvmPayment };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map