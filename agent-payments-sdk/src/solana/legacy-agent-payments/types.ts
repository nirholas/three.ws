// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import type { PublicKey, AccountMeta } from "@solana/web3.js";
import type { BN } from "@coral-xyz/anchor";

/** Args for `agentInitialize` — registers a tokenized agent for a coin. */
export interface LegacyCreateParams {
  authority: PublicKey;
  mint: PublicKey;
  agentAuthority: PublicKey;
  buybackBps: number;
}

export interface LegacyWithdrawParams {
  authority: PublicKey;
  currencyMint: PublicKey;
  receiverAta: PublicKey;
  tokenProgram?: PublicKey;
}

export interface LegacyUpdateBuybackBpsParams {
  authority: PublicKey;
  buybackBps: number;
}

/** Optional override fed in lieu of an on-chain fetch of `globalConfig`. */
export interface LegacyUpdateBuybackBpsOptions {
  supportedCurrenciesMint: PublicKey[];
}

export interface LegacyAcceptPaymentParams {
  user: PublicKey;
  userTokenAccount: PublicKey;
  currencyMint: PublicKey;
  amount: BN;
  memo: BN;
  startTime: BN;
  endTime: BN;
  tokenProgram?: PublicKey;
}

export interface LegacyAcceptPaymentSimpleParams {
  user: PublicKey;
  userTokenAccount: PublicKey;
  currencyMint: PublicKey;
  amount: number | bigint;
  memo: number | bigint;
  startTime: number | bigint;
  endTime: number | bigint;
  tokenProgram?: PublicKey;
}

export interface LegacyDistributePaymentsParams {
  user: PublicKey;
  currencyMint: PublicKey;
  tokenProgram?: PublicKey;
}

export interface LegacyBuybackTriggerParams {
  globalBuybackAuthority: PublicKey;
  currencyMint: PublicKey;
  swapProgramToInvoke: PublicKey;
  swapInstructionData: Buffer;
  remainingAccounts: AccountMeta[];
  tokenProgram?: PublicKey;
}

export interface LegacyExtendAccountParams {
  account: PublicKey;
  user: PublicKey;
}

export interface LegacyUpdateAuthorityParams {
  authority: PublicKey;
  newAuthority: PublicKey;
}

export interface LegacyVaultBalance {
  address: PublicKey;
  balance: bigint;
}

export interface LegacyAgentBalances {
  paymentVault: LegacyVaultBalance;
  buybackVault: LegacyVaultBalance;
  withdrawVault: LegacyVaultBalance;
}

/** Decoded `tokenAgentPayments` account. Mirrors the 1.0.7 IDL exactly. */
export interface LegacyTokenAgentPayments {
  bump: number;
  mint: PublicKey;
  authority: PublicKey;
  buybackBps: number;
}

/** Decoded `tokenAgentPaymentInCurrency` account. */
export interface LegacyTokenAgentPaymentInCurrency {
  mint: PublicKey;
  currencyMint: PublicKey;
  totalInvoicePaymentsMade: BN;
  totalBuyback: BN;
  totalWithdrawals: BN;
  tokensBoughtBackAndBurned: BN;
}

/** Decoded `globalConfig` account. */
export interface LegacyGlobalConfig {
  bump: number;
  protocolAuthority: PublicKey;
  buybackAuthority: PublicKey;
  /** Fixed-length `[Pubkey; 10]`. Empty slots are `Pubkey::default()`. */
  supportedCurrenciesMint: PublicKey[];
  tokenizedAgentSequence: BN;
}
