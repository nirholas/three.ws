import { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";

/** Pump Agent Payments program ID */
export const PROGRAM_ID = new PublicKey(
  "AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7",
);

/** Pump (bonding curve) program ID */
export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

// PDA seeds
export const GLOBAL_CONFIG_SEED = Buffer.from("global-config");
export const TOKEN_AGENT_PAYMENTS_SEED = Buffer.from("token-agent-payments");
export const PAYMENT_IN_CURRENCY_SEED = Buffer.from("payment-in-currency");
export const INVOICE_ID_SEED = Buffer.from("invoice-id");
export const BUYBACK_AUTHORITY_SEED = Buffer.from("buyback-authority");
export const WITHDRAW_AUTHORITY_SEED = Buffer.from("withdraw-authority");
export const BONDING_CURVE_SEED = Buffer.from("bonding-curve");

/**
 * Minimum rent-exempt lamports for TokenAgentPayments account.
 * 0.00141288 SOL.
 */
export const TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS = 1_412_880;

/**
 * Derives the GlobalConfig PDA.
 * Seeds: ["global-config"]
 */
export function getGlobalConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([GLOBAL_CONFIG_SEED], PROGRAM_ID);
}

/**
 * Derives the TokenAgentPayments PDA for a given mint.
 * Seeds: ["token-agent-payments", mint]
 */
export function getTokenAgentPaymentsPDA(
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TOKEN_AGENT_PAYMENTS_SEED, mint.toBuffer()],
    PROGRAM_ID,
  );
}

/**
 * Derives the TokenAgentPaymentInCurrency PDA.
 * Seeds: ["payment-in-currency", tokenMint, currencyMint]
 */
export function getPaymentInCurrencyPDA(
  tokenMint: PublicKey,
  currencyMint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PAYMENT_IN_CURRENCY_SEED, tokenMint.toBuffer(), currencyMint.toBuffer()],
    PROGRAM_ID,
  );
}

/**
 * Derives the Invoice ID PDA used to validate payment uniqueness.
 * Seeds: ["invoice-id", tokenMint, currencyMint, amount, memo, startTime, endTime]
 */
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
    PROGRAM_ID,
  );
}

/**
 * Derives the Buyback Authority PDA for a given token mint.
 * Seeds: ["buyback-authority", tokenMint]
 */
export function getBuybackAuthorityPDA(
  tokenMint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BUYBACK_AUTHORITY_SEED, tokenMint.toBuffer()],
    PROGRAM_ID,
  );
}

/**
 * Derives the Withdraw Authority PDA for a given token mint.
 * Seeds: ["withdraw-authority", tokenMint]
 */
export function getWithdrawAuthorityPDA(
  tokenMint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [WITHDRAW_AUTHORITY_SEED, tokenMint.toBuffer()],
    PROGRAM_ID,
  );
}

/**
 * Derives the BondingCurve PDA from the Pump program for a given mint.
 * Seeds: ["bonding-curve", mint] (program = Pump)
 */
export function getBondingCurvePDA(
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BONDING_CURVE_SEED, mint.toBuffer()],
    PUMP_PROGRAM_ID,
  );
}
