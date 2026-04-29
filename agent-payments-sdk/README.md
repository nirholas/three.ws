# @pump-fun/agent-payments-sdk 

TypeScript SDK for the **Pump Agent Payments** Solana program (`AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7`).

Reverse-engineered from the published npm package. Original by [@pump-fun](https://github.com/pump-fun).

## Architecture

```
src/
├── idl/
│   ├── pump_agent_payments.json   # Anchor IDL (snake_case, runtime)
│   └── pump_agent_payments.ts     # Anchor IDL type (camelCase, compile-time)
├── pdas.ts                        # PDA derivation helpers (seeds + constants)
├── program.ts                     # Anchor Program creation / offline instance
├── types.ts                       # All parameter interfaces & decoded account types
├── PumpAgentOffline.ts            # Instruction builder — no RPC required
├── PumpAgent.ts                   # Online agent — extends Offline with RPC calls
├── decoders.ts                    # Account data decoders (GlobalConfig, etc.)
├── events.ts                      # Event parsing, types & WebSocket subscriptions
├── x402/                          # x402 HTTP 402 Payment Required protocol
│   ├── types.ts                   # Protocol constants & type definitions
│   ├── headers.ts                 # Header encoding/decoding helpers
│   ├── facilitator.ts             # Server-side verify & settle + resource server
│   └── client.ts                  # Client-side fetch wrapper (auto 402 handling)
└── index.ts                       # Barrel export
```

## Install

```bash
npm install @pump-fun/agent-payments-sdk
```

## Build

```bash
npm install
npm run build
```

## Development

```bash
npm run dev          # watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run lint:fix     # eslint --fix
```

## Usage

```typescript
import { PumpAgent, PumpAgentOffline, PROGRAM_ID } from "@pump-fun/agent-payments-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

// Offline — build instructions without an RPC connection
const offline = new PumpAgentOffline(mintPubkey);
const createIx = await offline.create({
  authority: walletPubkey,
  mint: mintPubkey,
  agentAuthority: agentPubkey,
  buybackBps: 500, // 5%
});

// Online — with RPC for balance queries and invoice validation
const connection = new Connection("https://api.mainnet-beta.solana.com");
const agent = new PumpAgent(mintPubkey, "mainnet", connection);
const balances = await agent.getBalances(currencyMint);
```

### Invoice Validation

```typescript
const paid = await agent.validateInvoicePayment({
  user: payerPubkey,
  currencyMint: usdcMint,
  amount: 1_000_000, // 1 USDC (6 decimals)
  memo: 12345,
  startTime: Math.floor(Date.now() / 1000),
  endTime: Math.floor(Date.now() / 1000) + 300,
});
```

### Event Parsing

```typescript
import { parseAgentEvents, subscribeToAgentEvents } from "@pump-fun/agent-payments-sdk";

// Parse events from transaction logs
const events = parseAgentEvents(tx.meta.logMessages);
for (const event of events) {
  if (event.name === "agentAcceptPaymentEvent") {
    console.log("Payment amount:", event.data.amount.toString());
  }
}

// Subscribe to real-time events via WebSocket
const sub = subscribeToAgentEvents(connection, (event, slot) => {
  console.log(`[slot ${slot}] ${event.name}`, event.data);
}, { eventNames: ["agentAcceptPaymentEvent"] });

// Later: stop listening
sub.unsubscribe();
```

### x402 (HTTP 402 Payment Required)

The SDK includes an x402 sub-package for pay-gating HTTP endpoints:

```typescript
import { x402 } from "@pump-fun/agent-payments-sdk";

// Server: build payment requirements for a 402 response
const requirements = x402.buildPumpAgentRequirements({
  agentMint: "YourAgentMintAddress...",
  payTo: "PaymentVaultAddress...",
  amount: "1000000", // 1 USDC in minor units
});

// Client: auto-pay 402 responses
const x402fetch = x402.createX402Fetch({
  payer: wallet.publicKey.toBase58(),
  connection,
  signTransaction: async (tx) => { /* sign */ },
  sendTransaction: async (tx) => { /* send */ },
});
const res = await x402fetch("https://api.agent.example/inference");
```

## Program Instructions

| Instruction | Description |
|---|---|
| `agentInitialize` | Register a new agent for a token mint |
| `agentAcceptPayment` | Accept a payment in a supported currency |
| `agentDistributePayments` | Split vault funds between buyback and withdraw |
| `agentBuybackTrigger` | Execute buyback via CPI swap + burn |
| `agentWithdraw` | Withdraw funds from the withdraw vault |
| `agentUpdateBuybackBps` | Update the buyback basis points |
| `agentUpdateAuthority` | Transfer agent authority |
| `agentTransferExtraLamports` | Transfer excess lamports (native SOL) |
| `extendAccount` | Extend account size |
| `closeAccount` | Close an account |
| `globalConfigInitialize` | Initialize the global config |
| `globalAddNewCurrency` | Add a supported currency |
| `globalRemoveCurrency` | Remove a supported currency |
| `globalUpdateAuthorities` | Update protocol / buyback authorities |

## On-Chain Accounts

| Account | Description |
|---|---|
| `GlobalConfig` | Protocol-wide config: authorities, supported currencies |
| `TokenAgentPayments` | Per-mint agent config: authority, buyback bps |
| `TokenAgentPaymentInCurrency` | Per-mint per-currency accounting |
| `BondingCurve` | Pump bonding curve state (read-only) |

## Key Exports

- **Classes**: `PumpAgent`, `PumpAgentOffline`
- **Constants**: `PROGRAM_ID`, `PUMP_PROGRAM_ID`, `PUMP_AGENT_PAYMENTS_PROGRAM_ID`
- **PDAs**: `getGlobalConfigPDA`, `getTokenAgentPaymentsPDA`, `getPaymentInCurrencyPDA`, `getInvoiceIdPDA`, `getBuybackAuthorityPDA`, `getWithdrawAuthorityPDA`, `getBondingCurvePDA`
- **Decoders**: `decodeGlobalConfig`, `decodeTokenAgentPaymentInCurrency`, `decodeTokenAgentPayments`
- **Events**: `createEventParser`, `parseAgentEvents`, `subscribeToAgentEvents` + all event type interfaces
- **Program**: `getPumpProgram`, `getPumpProgramWithFallback`, `getOfflineProgram`, `getProgram`
- **x402**: `x402.createX402Fetch`, `x402.PumpAgentFacilitator`, `x402.createResourceServer`, `x402.buildPumpAgentRequirements`, header helpers

## License

ISC
