
## What's included

- **Full Solana SDK** — `PumpAgent`, `PumpAgentOffline`, PDAs, events, decoders, x402, solana-agent-kit plugin
- **EVM cross-chain** — quote, build, and submit payments from Ethereum, Base, Arbitrum, Polygon, BNB, Avalanche
- **x402 EVM** — HTTP 402 auto-pay for EVM wallets, server-side facilitator

## Install

```bash
npm install @pump-fun/agent-payments-crosschain-sdk
```

## Usage

### Solana (existing flow)

```ts
import { PumpAgent } from "@pump-fun/agent-payments-crosschain-sdk/solana";
```

### EVM cross-chain (new)

```ts
import { CrossChainPaymentClient } from "@pump-fun/agent-payments-crosschain-sdk";

const client = new CrossChainPaymentClient({
  rpcEndpoint: "https://api.mainnet-beta.solana.com",
  agentMint: "YOUR_AGENT_MINT",
});

// 1. Get a quote
const quote = await client.getEvmQuote(
  8453,           // Base
  "native",       // ETH
  10000000000000000n  // 0.01 ETH in wei
);

// 2. Build transactions
const txs = await client.buildEvmPayment(
  quote,
  "0xYourEvmAddress",
  "YourSolanaWallet",
  "invoice-123"
);

// 3. Sign txs.approval (if present) then txs.bridge in user's EVM wallet
// 4. Track arrival
const receipt = client.createReceipt(bridgeTxHash, quote, depositId);
const result = await client.waitForArrival(receipt);
```

### x402 EVM auto-pay

```ts
import { createEvmX402Fetch } from "@pump-fun/agent-payments-crosschain-sdk/x402";

const fetch = createEvmX402Fetch({ walletClient });
const res = await fetch("https://agent.example/api/chat", { method: "POST" });
```

## Sub-path exports

| Import | Contents |
|---|---|
| `/solana` | Full Solana SDK |
| `/evm` | Quote, transaction builder, status polling |
| `/x402` | EVM x402 client + server facilitator |
| `/solana-agent-kit` | solana-agent-kit plugin |

## Supported EVM chains

| Chain | ID |
|---|---|
| Ethereum | 1 |
| Base | 8453 |
| Arbitrum One | 42161 |
| Polygon | 137 |
| BNB Smart Chain | 56 |
| Avalanche | 43114 |
