import type { AccountMeta, PublicKey } from "@solana/web3.js";
import type { BN } from "@coral-xyz/anchor";

// ─── Environment ────────────────────────────────────────────────────────────

export type PumpEnvironment = "devnet" | "mainnet";

// ─── Vault / Balance types ──────────────────────────────────────────────────

export interface VaultBalance {
  address: PublicKey;
  balance: bigint;
}

export interface AgentBalances {
  /** ATA of the TokenAgentPayments PDA (incoming payments land here) */
  paymentVault: VaultBalance;
  /** ATA of the Buyback Authority PDA */
  buybackVault: VaultBalance;
  /** ATA of the Withdraw Authority PDA */
  withdrawVault: VaultBalance;
}

// ─── Instruction parameter interfaces ───────────────────────────────────────

export interface CreateParams {
  /** Signer – must be the bonding-curve creator for this mint */
  authority: PublicKey;
  /** The token mint this agent manages */
  mint: PublicKey;
  /** The pubkey that will act as the agent authority (for withdraw / update) */
  agentAuthority: PublicKey;
  /** Basis points allocated to buyback (0–10 000) */
  buybackBps: number;
}

export interface WithdrawParams {
  /** Agent authority signer */
  authority: PublicKey;
  /** Currency mint to withdraw */
  currencyMint: PublicKey;
  /** Receiver's token account for the currency */
  receiverAta: PublicKey;
  /** Token program for the currency mint (defaults to TOKEN_PROGRAM_ID) */
  tokenProgram?: PublicKey;
}

export interface UpdateBuybackBpsParams {
  /** Agent authority signer */
  authority: PublicKey;
  /** New buyback basis points (0–10 000) */
  buybackBps: number;
}

export interface UpdateBuybackBpsOptions {
  /** Supported currencies and their token programs */
  supportedCurrencies: {
    mint: PublicKey;
    tokenProgram: PublicKey;
  }[];
}

export interface AcceptPaymentParams {
  /** Payer / user signer */
  user: PublicKey;
  /** User's token account holding the currency */
  userTokenAccount: PublicKey;
  /** The currency mint being paid */
  currencyMint: PublicKey;
  amount: BN;
  memo: BN;
  startTime: BN;
  endTime: BN;
  /** Token program for the currency mint (defaults to TOKEN_PROGRAM_ID) */
  tokenProgram?: PublicKey;
}

export interface AcceptPaymentSimpleParams {
  user: PublicKey;
  userTokenAccount: PublicKey;
  currencyMint: PublicKey;
  amount: bigint | number | string;
  memo: bigint | number | string;
  startTime: bigint | number | string;
  endTime: bigint | number | string;
  tokenProgram?: PublicKey;
  /** Compute unit limit (defaults to 130_000) */
  computeUnitLimit?: number;
  /** Priority fee in micro lamports per compute unit (defaults to 1_000) */
  computeUnitPrice?: number;
}

export interface BuildAcceptPaymentParams {
  user: PublicKey;
  currencyMint: PublicKey;
  amount: bigint | number | string;
  memo: bigint | number | string;
  startTime: bigint | number | string;
  endTime: bigint | number | string;
  tokenProgram?: PublicKey;
  /** Compute unit limit for the transaction (defaults to 100_000) */
  computeUnitLimit?: number;
  /** Priority fee in microlamports per compute unit. If provided, a SetComputeUnitPrice instruction is prepended. */
  computeUnitPrice?: number;
}

export interface DistributePaymentsParams {
  /** Any signer (permissionless) */
  user: PublicKey;
  /** Currency mint to distribute */
  currencyMint: PublicKey;
  /** Token program for the currency mint (defaults to TOKEN_PROGRAM_ID) */
  tokenProgram?: PublicKey;
  /**
   * For native SOL only: prepend `agentTransferExtraLamports` before distribute.
   * Default is false.
   */
  includeTransferExtraLamportsForNative?: boolean;
}

export interface BuybackTriggerParams {
  /** Must match globalConfig.buybackAuthority */
  globalBuybackAuthority: PublicKey;
  /** The currency mint used for the swap (tracks per-currency buyback accounting) */
  currencyMint: PublicKey;
  /** Swap program to CPI into (must be in the allowed list) */
  swapProgramToInvoke: PublicKey;
  /** Serialised swap instruction data (pass empty Buffer to skip swap & just burn) */
  swapInstructionData: Buffer;
  /** All accounts the swap instruction requires */
  remainingAccounts: AccountMeta[];
  /** Token program for the currency mint (defaults to TOKEN_PROGRAM_ID) */
  tokenProgramCurrency?: PublicKey;
  /** Token program for the agent token mint (defaults to TOKEN_PROGRAM_ID) */
  tokenProgram?: PublicKey;
}

export interface ExtendAccountParams {
  /** Account to extend (must be a supported account type on-chain) */
  account: PublicKey;
  /** Signer paying rent for extension */
  user: PublicKey;
}

export interface UpdateAuthorityParams {
  /** Current agent authority signer (or protocol authority for recovery) */
  authority: PublicKey;
  /** The new authority pubkey to set */
  newAuthority: PublicKey;
}

export interface CloseAccountParams {
  /** The account to close (TokenAgentPayments, PaymentInCurrency, etc.) */
  account: PublicKey;
  /** Signer who receives the reclaimed rent lamports */
  user: PublicKey;
}

// ─── Decoded account types (derived from the Anchor program) ────────────────

import { OFFLINE_PUMP_PROGRAM } from "./program";

export type GlobalConfig = Awaited<
  ReturnType<typeof OFFLINE_PUMP_PROGRAM.account.GlobalConfig.fetch>
>;

export type TokenAgentPaymentInCurrency = Awaited<
  ReturnType<typeof OFFLINE_PUMP_PROGRAM.account.TokenAgentPaymentInCurrency.fetch>
>;

export type TokenAgentPayments = Awaited<
  ReturnType<typeof OFFLINE_PUMP_PROGRAM.account.TokenAgentPayments.fetch>
>;
