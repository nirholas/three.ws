// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import type {
  CrossChainPaymentStatusResult,
  EvmPaymentReceipt,
} from "../types.js";
import { PUMP_CROSSCHAIN_API, STATUS_POLL_INTERVAL_MS, STATUS_TIMEOUT_MS } from "../constants.js";

/**
 * Poll Pump.fun's cross-chain API until the payment arrives on Solana
 * or the timeout is reached.
 *
 * Resolves with status "arrived_on_solana" and the Solana tx signature,
 * or rejects with the last known status on timeout.
 */
export async function waitForSolanaArrival(
  receipt: EvmPaymentReceipt,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<CrossChainPaymentStatusResult> {
  const timeout = opts.timeoutMs ?? STATUS_TIMEOUT_MS;
  const interval = opts.pollIntervalMs ?? STATUS_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const status = await getPaymentStatus(receipt.depositId);

    if (status.status === "arrived_on_solana" || status.status === "failed") {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(
    `Cross-chain payment ${receipt.depositId} did not arrive within ${timeout / 1000}s`
  );
}

/** Single status check — use this if you want to poll manually. */
export async function getPaymentStatus(
  depositId: string
): Promise<CrossChainPaymentStatusResult> {
  const res = await fetch(`${PUMP_CROSSCHAIN_API}/status/${depositId}`);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Status check failed (${res.status}): ${body}`);
  }

  const data: {
    status: string;
    solanaSignature?: string;
    error?: string;
  } = await res.json();

  const mapped = mapStatus(data.status);

  return {
    status: mapped,
    depositId,
    solanaSignature: data.solanaSignature,
    error: data.error,
  };
}

function mapStatus(raw: string): CrossChainPaymentStatusResult["status"] {
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
