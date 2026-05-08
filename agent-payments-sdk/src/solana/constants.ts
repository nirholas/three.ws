// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { PublicKey } from "@solana/web3.js";

/**
 * Static buyback fee recipients pool. Mirrors
 * `CURRENT_FEE_RECIPIENTS_FOR_BUYBACK` in @pump-fun/pump-sdk 1.35.0
 * (the constant is embedded but not exported by the SDK).
 *
 * Source: pump-public-docs/docs/FEE_RECIPIENTS.md.
 */
export const BUYBACK_FEE_RECIPIENTS: ReadonlyArray<PublicKey> = [
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
].map((s) => new PublicKey(s));

/** Pick a random buyback fee recipient from the static v1.35 list. */
export function pickBuybackFeeRecipient(): PublicKey {
  return BUYBACK_FEE_RECIPIENTS[
    Math.floor(Math.random() * BUYBACK_FEE_RECIPIENTS.length)
  ]!;
}

/**
 * Pick a regular or reserved (mayhem) fee recipient at random from the
 * Global config pool. Mirrors `getFeeRecipient` in @pump-fun/pump-sdk.
 */
export function pickFeeRecipient(
  global: {
    feeRecipient: PublicKey;
    feeRecipients: PublicKey[];
    reservedFeeRecipient: PublicKey;
    reservedFeeRecipients: PublicKey[];
  },
  mayhemMode: boolean,
): PublicKey {
  const pool = mayhemMode
    ? [global.reservedFeeRecipient, ...global.reservedFeeRecipients]
    : [global.feeRecipient, ...global.feeRecipients];
  return pool[Math.floor(Math.random() * pool.length)]!;
}
