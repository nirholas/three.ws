// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import type { Log } from "viem";
import type {
  EvmAgentEvent,
  EvmAgentCreatedEvent,
  EvmPaymentAcceptedEvent,
  EvmPaymentsDistributedEvent,
  EvmBuybackTriggeredEvent,
  EvmWithdrawnEvent,
} from "./types.js";

type RawLog = Log & { args?: Record<string, unknown>; eventName?: string };

/**
 * Parse raw viem event logs into typed EvmAgentEvent objects.
 * Mirrors parseAgentEvents() from the Solana SDK.
 */
export function parseEvmAgentEvents(logs: RawLog[]): EvmAgentEvent[] {
  const events: EvmAgentEvent[] = [];

  for (const log of logs) {
    const name = log.eventName;
    const args = log.args ?? {};
    const meta = {
      txHash: log.transactionHash ?? "0x",
      blockNumber: log.blockNumber ?? 0n,
    } as const;

    try {
      switch (name) {
        case "AgentCreated":
          events.push({
            name: "AgentCreated",
            agentToken: args.agentToken as `0x${string}`,
            authority: args.authority as `0x${string}`,
            buybackBps: Number(args.buybackBps),
            ...meta,
          } satisfies EvmAgentCreatedEvent);
          break;

        case "PaymentAccepted":
          events.push({
            name: "PaymentAccepted",
            agentToken: args.agentToken as `0x${string}`,
            payer: args.payer as `0x${string}`,
            currencyToken: args.currencyToken as `0x${string}`,
            amount: BigInt(String(args.amount ?? 0n)),
            memo: BigInt(String(args.memo ?? 0n)),
            invoiceId: args.invoiceId as `0x${string}`,
            ...meta,
          } satisfies EvmPaymentAcceptedEvent);
          break;

        case "PaymentsDistributed":
          events.push({
            name: "PaymentsDistributed",
            agentToken: args.agentToken as `0x${string}`,
            currencyToken: args.currencyToken as `0x${string}`,
            buybackAmount: BigInt(String(args.buybackAmount ?? 0n)),
            withdrawAmount: BigInt(String(args.withdrawAmount ?? 0n)),
            ...meta,
          } satisfies EvmPaymentsDistributedEvent);
          break;

        case "BuybackTriggered":
          events.push({
            name: "BuybackTriggered",
            agentToken: args.agentToken as `0x${string}`,
            currencyToken: args.currencyToken as `0x${string}`,
            currencySpent: BigInt(String(args.currencySpent ?? 0n)),
            tokensBurned: BigInt(String(args.tokensBurned ?? 0n)),
            ...meta,
          } satisfies EvmBuybackTriggeredEvent);
          break;

        case "Withdrawn":
          events.push({
            name: "Withdrawn",
            agentToken: args.agentToken as `0x${string}`,
            authority: args.authority as `0x${string}`,
            currencyToken: args.currencyToken as `0x${string}`,
            amount: BigInt(String(args.amount ?? 0n)),
            receiver: args.receiver as `0x${string}`,
            ...meta,
          } satisfies EvmWithdrawnEvent);
          break;
      }
    } catch {
      // skip malformed logs
    }
  }

  return events;
}
