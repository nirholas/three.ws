# Events — @pump-fun/agent-payments-sdk

The SDK provides typed event parsing from transaction logs and real-time WebSocket subscriptions.

## Quick Start

```ts
import { parseAgentEvents, subscribeToAgentEvents } from "@pump-fun/agent-payments-sdk";

// Parse from a fetched transaction
const tx = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
const events = parseAgentEvents(tx.meta.logMessages);

for (const event of events) {
  if (event.name === "agentAcceptPaymentEvent") {
    console.log("Payment:", event.data.amount.toString());
  }
}

// Subscribe to real-time events
const sub = subscribeToAgentEvents(connection, (event, slot) => {
  console.log(`[slot ${slot}] ${event.name}`, event.data);
}, {
  eventNames: ["agentAcceptPaymentEvent", "agentDistributePaymentsEvent"],
});

// Stop listening
sub.unsubscribe();
```

---

## Functions

### `parseAgentEvents(logs, connection?)`
Parse an array of log messages (from `tx.meta.logMessages`) into typed events. Works offline; `connection` is optional.

### `createEventParser(connection?)`
Returns a raw Anchor `EventParser` bound to the Pump Agent Payments program. Use this if you need lower-level control.

### `subscribeToAgentEvents(connection, callback, options?)`
Opens a WebSocket subscription (`connection.onLogs`) and calls `callback` for each matching event.
- `options.eventNames`: array of event names to filter to. If omitted, all events fire.
- Returns `{ unsubscribe() }`.

---

## Event Types

### `agentAcceptPaymentEvent`
Emitted when a user pays an invoice.
```ts
interface AgentAcceptPaymentEvent {
  user: PublicKey;
  tokenizedAgentMint: PublicKey;
  tokenAgentPayments: PublicKey;
  currencyMint: PublicKey;
  amount: BN;
  memo: BN;
  startTime: BN;
  endTime: BN;
  invoiceId: PublicKey;
  agentPostBalance: BN;
  timestamp: BN;
}
```

### `agentDistributePaymentsEvent`
Emitted when vault funds are split between buyback and withdraw.
```ts
interface AgentDistributePaymentsEvent {
  tokenAgentPayments: PublicKey;
  currencyMint: PublicKey;
  buybackBps: number;
  buybackAmount: BN;
  withdrawAmount: BN;
  timestamp: BN;
}
```

### `agentBuybackTriggerEvent`
Emitted when a buyback swap + burn is executed.
```ts
interface AgentBuybackTriggerEvent {
  tokenizedAgentMint: PublicKey;
  currencyMint: PublicKey;
  amountBurned: BN;
  swapProgram: PublicKey;
  newTokensBoughtAndBurnedForCurrency: BN;
  agentPostBalance: BN;
  timestamp: BN;
  currencyMintAmountForBuyback: BN;
}
```

### `agentWithdrawEvent`
Emitted when the agent authority withdraws funds.
```ts
interface AgentWithdrawEvent {
  tokenizedAgentMint: PublicKey;
  currencyMint: PublicKey;
  amount: BN;
  receiver: PublicKey;
  timestamp: BN;
}
```

### `agentInitializeEvent`
Emitted when a new agent is registered.
```ts
interface AgentInitializeEvent {
  tokenAgentPayments: PublicKey;
  mint: PublicKey;
  authority: PublicKey;
  buybackBps: number;
  timestamp: BN;
  tokenizedAgentSequence: BN;
}
```

### `agentUpdateAuthorityEvent`
```ts
interface AgentUpdateAuthorityEvent {
  tokenAgentPayments: PublicKey;
  oldAuthority: PublicKey;
  newAuthority: PublicKey;
  timestamp: BN;
}
```

### `agentUpdateBuybackBpsEvent`
```ts
interface AgentUpdateBuybackBpsEvent {
  tokenAgentPayments: PublicKey;
  mint: PublicKey;
  oldBuybackBps: number;
  newBuybackBps: number;
  timestamp: BN;
}
```

### `extendAccountEvent`
```ts
interface ExtendAccountEvent {
  account: PublicKey;
  user: PublicKey;
  currentSize: BN;
  newSize: BN;
  timestamp: BN;
}
```

### Global events

```ts
interface GlobalConfigInitializeEvent {
  globalConfig: PublicKey;
  protocolAuthority: PublicKey;
  buybackAuthority: PublicKey;
  timestamp: BN;
}

interface GlobalAddNewCurrencyEvent {
  globalConfig: PublicKey;
  currencyMint: PublicKey;
  timestamp: BN;
}

interface GlobalUpdateAuthoritiesEvent {
  globalConfig: PublicKey;
  protocolAuthority: PublicKey | null;
  buybackAuthority: PublicKey | null;
  timestamp: BN;
}
```

---

## `AgentEventName` union

```ts
type AgentEventName =
  | "agentAcceptPaymentEvent"
  | "agentBuybackTriggerEvent"
  | "agentDistributePaymentsEvent"
  | "agentInitializeEvent"
  | "agentUpdateAuthorityEvent"
  | "agentUpdateBuybackBpsEvent"
  | "agentWithdrawEvent"
  | "extendAccountEvent"
  | "globalAddNewCurrencyEvent"
  | "globalConfigInitializeEvent"
  | "globalUpdateAuthoritiesEvent";
```

## `ParsedAgentEvent<T>`

```ts
interface ParsedAgentEvent<T extends AgentEventData = AgentEventData> {
  name: AgentEventName;
  data: T;
}
```

Narrow `data` by checking `event.name` — TypeScript will infer the correct `data` type.
