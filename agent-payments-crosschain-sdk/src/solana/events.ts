import { PublicKey, type Connection } from "@solana/web3.js";
import { BN, EventParser, type Program } from "@coral-xyz/anchor";
import type { PumpAgentPayments as PumpAgentPaymentsIDL } from "./idl/pump_agent_payments";
import { getPumpProgramWithFallback, OFFLINE_PUMP_PROGRAM } from "./program";

// ─── Typed Event Interfaces ─────────────────────────────────────────────────

export interface AgentAcceptPaymentEvent {
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

export interface AgentBuybackTriggerEvent {
  tokenizedAgentMint: PublicKey;
  currencyMint: PublicKey;
  amountBurned: BN;
  swapProgram: PublicKey;
  newTokensBoughtAndBurnedForCurrency: BN;
  agentPostBalance: BN;
  timestamp: BN;
  currencyMintAmountForBuyback: BN;
}

export interface AgentDistributePaymentsEvent {
  tokenAgentPayments: PublicKey;
  currencyMint: PublicKey;
  buybackBps: number;
  buybackAmount: BN;
  withdrawAmount: BN;
  timestamp: BN;
}

export interface AgentInitializeEvent {
  tokenAgentPayments: PublicKey;
  mint: PublicKey;
  authority: PublicKey;
  buybackBps: number;
  timestamp: BN;
  tokenizedAgentSequence: BN;
}

export interface AgentUpdateAuthorityEvent {
  tokenAgentPayments: PublicKey;
  oldAuthority: PublicKey;
  newAuthority: PublicKey;
  timestamp: BN;
}

export interface AgentUpdateBuybackBpsEvent {
  tokenAgentPayments: PublicKey;
  mint: PublicKey;
  oldBuybackBps: number;
  newBuybackBps: number;
  timestamp: BN;
}

export interface AgentWithdrawEvent {
  tokenizedAgentMint: PublicKey;
  currencyMint: PublicKey;
  amount: BN;
  receiver: PublicKey;
  timestamp: BN;
}

export interface ExtendAccountEvent {
  account: PublicKey;
  user: PublicKey;
  currentSize: BN;
  newSize: BN;
  timestamp: BN;
}

export interface GlobalAddNewCurrencyEvent {
  globalConfig: PublicKey;
  currencyMint: PublicKey;
  timestamp: BN;
}

export interface GlobalConfigInitializeEvent {
  globalConfig: PublicKey;
  protocolAuthority: PublicKey;
  buybackAuthority: PublicKey;
  timestamp: BN;
}

export interface GlobalUpdateAuthoritiesEvent {
  globalConfig: PublicKey;
  protocolAuthority: PublicKey | null;
  buybackAuthority: PublicKey | null;
  timestamp: BN;
}

// ─── Event Name Union ───────────────────────────────────────────────────────

export type AgentEventName =
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

export type AgentEventData =
  | AgentAcceptPaymentEvent
  | AgentBuybackTriggerEvent
  | AgentDistributePaymentsEvent
  | AgentInitializeEvent
  | AgentUpdateAuthorityEvent
  | AgentUpdateBuybackBpsEvent
  | AgentWithdrawEvent
  | ExtendAccountEvent
  | GlobalAddNewCurrencyEvent
  | GlobalConfigInitializeEvent
  | GlobalUpdateAuthoritiesEvent;

export interface ParsedAgentEvent<
  T extends AgentEventData = AgentEventData,
> {
  name: AgentEventName;
  data: T;
}

// ─── Event Parser ───────────────────────────────────────────────────────────

/**
 * Create an Anchor EventParser bound to the Pump Agent Payments program.
 * Works offline (no connection required) or with a connection.
 */
export function createEventParser(
  connection?: Connection,
): EventParser {
  const program: Program<PumpAgentPaymentsIDL> = connection
    ? getPumpProgramWithFallback(connection)
    : OFFLINE_PUMP_PROGRAM;
  return new EventParser(program.programId, program.coder);
}

/**
 * Parse transaction log messages into typed agent events.
 *
 * @example
 * ```ts
 * const tx = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
 * const events = parseAgentEvents(tx.meta.logMessages);
 * for (const event of events) {
 *   if (event.name === "agentAcceptPaymentEvent") {
 *     console.log("Payment:", event.data.amount.toString());
 *   }
 * }
 * ```
 */
export function parseAgentEvents(
  logs: string[],
  connection?: Connection,
): ParsedAgentEvent[] {
  const parser = createEventParser(connection);
  const events: ParsedAgentEvent[] = [];

  for (const event of parser.parseLogs(logs)) {
    events.push({
      name: event.name as AgentEventName,
      data: event.data as AgentEventData,
    });
  }

  return events;
}

// ─── Event Subscription ─────────────────────────────────────────────────────

export interface EventSubscriptionOptions {
  /** Filter to specific event names. If omitted, all events are emitted. */
  eventNames?: AgentEventName[];
}

export interface EventSubscription {
  /** Stop listening and clean up the WebSocket subscription. */
  unsubscribe(): void;
}

/**
 * Subscribe to real-time Pump Agent Payments program events via WebSocket.
 * Calls the provided callback whenever a matching event is detected.
 *
 * @example
 * ```ts
 * const sub = subscribeToAgentEvents(connection, (event, slot) => {
 *   console.log(`[slot ${slot}] ${event.name}`, event.data);
 * }, { eventNames: ["agentAcceptPaymentEvent"] });
 *
 * // Later: stop listening
 * sub.unsubscribe();
 * ```
 */
export function subscribeToAgentEvents(
  connection: Connection,
  callback: (event: ParsedAgentEvent, slot: number) => void,
  options?: EventSubscriptionOptions,
): EventSubscription {
  const parser = createEventParser(connection);
  const filterNames = options?.eventNames
    ? new Set(options.eventNames)
    : null;

  const subId = connection.onLogs(
    OFFLINE_PUMP_PROGRAM.programId,
    (logInfo, ctx) => {
      if (logInfo.err) return;

      for (const event of parser.parseLogs(logInfo.logs)) {
        const parsed: ParsedAgentEvent = {
          name: event.name as AgentEventName,
          data: event.data as AgentEventData,
        };

        if (filterNames && !filterNames.has(parsed.name)) continue;
        callback(parsed, ctx.slot);
      }
    },
    "confirmed",
  );

  return {
    unsubscribe() {
      connection.removeOnLogsListener(subId);
    },
  };
}
