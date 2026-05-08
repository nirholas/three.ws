// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export const LEGACY_AGENT_PAYMENTS_PROGRAM_ID = new PublicKey(
  "pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4",
);

export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

export const GLOBAL_CONFIG_SEED = Buffer.from("global-config");
export const TOKEN_AGENT_PAYMENTS_SEED = Buffer.from("token-agent-payments");
export const PAYMENT_IN_CURRENCY_SEED = Buffer.from("payment-in-currency");
export const INVOICE_ID_SEED = Buffer.from("invoice-id");
export const BUYBACK_AUTHORITY_SEED = Buffer.from("buyback-authority");
export const WITHDRAW_AUTHORITY_SEED = Buffer.from("withdraw-authority");
export const BONDING_CURVE_SEED = Buffer.from("bonding-curve");

export function getGlobalConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [GLOBAL_CONFIG_SEED],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID,
  );
}

export function getTokenAgentPaymentsPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TOKEN_AGENT_PAYMENTS_SEED, mint.toBuffer()],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID,
  );
}

export function getPaymentInCurrencyPDA(
  tokenMint: PublicKey,
  currencyMint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PAYMENT_IN_CURRENCY_SEED, tokenMint.toBuffer(), currencyMint.toBuffer()],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID,
  );
}

export function getInvoiceIdPDA(
  tokenMint: PublicKey,
  currencyMint: PublicKey,
  amount: BN,
  memo: BN,
  startTime: BN,
  endTime: BN,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      INVOICE_ID_SEED,
      tokenMint.toBuffer(),
      currencyMint.toBuffer(),
      amount.toArrayLike(Buffer, "le", 8),
      memo.toArrayLike(Buffer, "le", 8),
      startTime.toArrayLike(Buffer, "le", 8),
      endTime.toArrayLike(Buffer, "le", 8),
    ],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID,
  );
}

export function getBuybackAuthorityPDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BUYBACK_AUTHORITY_SEED, tokenMint.toBuffer()],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID,
  );
}

export function getWithdrawAuthorityPDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [WITHDRAW_AUTHORITY_SEED, tokenMint.toBuffer()],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID,
  );
}

/**
 * Note: BondingCurve PDA is owned by the pump program, not the legacy
 * agent-payments program — it lives on the *pump* program ID. The legacy
 * SDK uses the same seed scheme as the modern bonding curve.
 */
export function getBondingCurvePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BONDING_CURVE_SEED, mint.toBuffer()],
    PUMP_PROGRAM_ID,
  );
}
