// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { encodeAbiParameters, keccak256 } from "viem";
import type { Address } from "viem";

/**
 * Derives a deterministic invoice ID — the EVM equivalent of the Solana InvoiceId PDA.
 *
 * Mirrors PDA seeds: ["invoice-id", tokenMint, currencyMint, amount, memo, startTime, endTime]
 *
 * On-chain the contract computes:
 *   keccak256(abi.encode(agentToken, currencyToken, amount, memo, startTime, endTime))
 */
export function getInvoiceId(
  agentToken: Address,
  currencyToken: Address,
  amount: bigint,
  memo: bigint,
  startTime: bigint,
  endTime: bigint
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint64" },
        { type: "int64" },
        { type: "int64" },
      ],
      [agentToken, currencyToken, amount, memo, startTime, endTime]
    )
  );
}

/**
 * Build a time-bounded invoice window matching the Solana SDK's convention.
 * Returns startTime and endTime as unix timestamps (seconds).
 *
 * @param windowSeconds  How long the invoice is valid (default: 5 minutes)
 */
export function buildInvoiceWindow(windowSeconds = 300): {
  startTime: bigint;
  endTime: bigint;
} {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    startTime: now,
    endTime: now + BigInt(windowSeconds),
  };
}

/**
 * Generate a random memo ID — same helper pattern as the Solana SDK.
 * Returns a random u64 as bigint.
 */
export function generateMemo(): bigint {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return arr.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
}
