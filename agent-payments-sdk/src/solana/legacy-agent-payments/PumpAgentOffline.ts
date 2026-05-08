// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { BN, Program } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  getBuybackAuthorityPDA,
  getGlobalConfigPDA,
  getInvoiceIdPDA,
  getPaymentInCurrencyPDA,
  getTokenAgentPaymentsPDA,
  getWithdrawAuthorityPDA,
  getBondingCurvePDA,
} from "./pdas.js";
import {
  getLegacyPumpProgramWithFallback,
} from "./program.js";
import type { LegacyPumpAgentPayments } from "./idl.js";
import type {
  LegacyAcceptPaymentParams,
  LegacyAcceptPaymentSimpleParams,
  LegacyBuybackTriggerParams,
  LegacyCreateParams,
  LegacyDistributePaymentsParams,
  LegacyExtendAccountParams,
  LegacyUpdateAuthorityParams,
  LegacyUpdateBuybackBpsOptions,
  LegacyUpdateBuybackBpsParams,
  LegacyWithdrawParams,
} from "./types.js";

const toBn = (v: number | bigint | BN): BN =>
  BN.isBN(v as BN) ? (v as BN) : new BN(v.toString());

/**
 * Offline-capable client for the legacy 1.0.7 `pump_agent_payments` program
 * (`pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4`). All methods return raw
 * `TransactionInstruction`s — the caller is responsible for transaction
 * assembly and signing. Mirrors the surface of the original npm package
 * exactly so coins registered via @pump-fun/pump-sdk's
 * `isTokenizedAgent: true` path remain operable.
 */
export class LegacyPumpAgentOffline {
  readonly mint: PublicKey;
  protected readonly program: Program<LegacyPumpAgentPayments>;

  constructor(mint: PublicKey, program?: Program<LegacyPumpAgentPayments>) {
    this.mint = mint;
    this.program = program ?? getLegacyPumpProgramWithFallback();
  }

  static load(
    mint: PublicKey,
    connection?: Connection,
  ): LegacyPumpAgentOffline {
    return new LegacyPumpAgentOffline(
      mint,
      getLegacyPumpProgramWithFallback(connection),
    );
  }

  async create(params: LegacyCreateParams): Promise<TransactionInstruction> {
    const { authority, mint, agentAuthority, buybackBps } = params;
    const [bondingCurve] = getBondingCurvePDA(mint);
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(mint);

    return this.program.methods
      .agentInitialize(agentAuthority, buybackBps)
      .accountsPartial({
        authority,
        bondingCurve,
        mint,
        tokenAgentPayments,
      })
      .instruction();
  }

  async withdraw(params: LegacyWithdrawParams): Promise<TransactionInstruction> {
    const { authority, currencyMint, receiverAta, tokenProgram } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);
    const withdrawVault = getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true,
    );

    return this.program.methods
      .agentWithdraw()
      .accountsPartial({
        authority,
        tokenAgentPayments,
        currencyMint,
        withdrawAuthority,
        withdrawVault,
        receiverAta,
        tokenProgram: tokenProgram ?? TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * `agent_update_buyback_bps` — when the global config has supported
   * currencies, each currency's payment-vault ATA must be passed as a
   * remaining account. The 1.0.7 SDK fetched `globalConfig` from chain when
   * called via the connection-bound `LegacyPumpAgent`; for the offline
   * flow you must supply `supportedCurrenciesMint` yourself.
   */
  async updateBuybackBps(
    params: LegacyUpdateBuybackBpsParams,
    options?: LegacyUpdateBuybackBpsOptions,
  ): Promise<TransactionInstruction> {
    const { authority, buybackBps } = params;
    const supportedCurrenciesMint = options?.supportedCurrenciesMint;
    if (!supportedCurrenciesMint) {
      throw new Error(
        "LegacyPumpAgentOffline.updateBuybackBps requires options.supportedCurrenciesMint.",
      );
    }
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();

    const remainingAccounts = supportedCurrenciesMint
      .filter((m) => !m.equals(PublicKey.default))
      .map((mint) => ({
        pubkey: getAssociatedTokenAddressSync(mint, tokenAgentPayments, true),
        isWritable: false,
        isSigner: false,
      }));

    return this.program.methods
      .agentUpdateBuybackBps(buybackBps)
      .accountsPartial({
        authority,
        tokenAgentPayments,
        globalConfig,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();
  }

  async acceptPayment(
    params: LegacyAcceptPaymentParams,
  ): Promise<TransactionInstruction> {
    const {
      user,
      userTokenAccount,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime,
      tokenProgram,
    } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [tokenAgentPaymentInCurrency] = getPaymentInCurrencyPDA(
      this.mint,
      currencyMint,
    );
    const [invoiceId] = getInvoiceIdPDA(
      this.mint,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime,
    );
    const tokenAgentAssociatedAccount = getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true,
    );

    return this.program.methods
      .agentAcceptPayment(amount, memo, startTime, endTime)
      .accountsPartial({
        user,
        userTokenAccount,
        tokenAgentPayments,
        tokenAgentAssociatedAccount,
        tokenAgentPaymentInCurrency,
        globalConfig,
        invoiceId,
        currencyMint,
        tokenProgram: tokenProgram ?? TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  async acceptPaymentSimple(
    params: LegacyAcceptPaymentSimpleParams,
  ): Promise<TransactionInstruction> {
    const { amount, memo, startTime, endTime, ...rest } = params;
    return this.acceptPayment({
      ...rest,
      amount: toBn(amount),
      memo: toBn(memo),
      startTime: toBn(startTime),
      endTime: toBn(endTime),
    });
  }

  async distributePayments(
    params: LegacyDistributePaymentsParams,
  ): Promise<TransactionInstruction> {
    const { user, currencyMint, tokenProgram } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [tokenAgentPaymentInCurrency] = getPaymentInCurrencyPDA(
      this.mint,
      currencyMint,
    );
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);
    const tokenAgentAssociatedAccount = getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true,
    );
    const buybackVault = getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true,
    );
    const withdrawVault = getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true,
    );

    return this.program.methods
      .agentDistributePayments()
      .accountsPartial({
        user,
        globalConfig,
        currencyMint,
        tokenAgentPayments,
        tokenAgentPaymentInCurrency,
        tokenAgentAssociatedAccount,
        buybackAuthority,
        withdrawAuthority,
        buybackVault,
        withdrawVault,
        tokenProgram: tokenProgram ?? TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  async buybackTrigger(
    params: LegacyBuybackTriggerParams,
  ): Promise<TransactionInstruction> {
    const {
      globalBuybackAuthority,
      currencyMint,
      swapProgramToInvoke,
      swapInstructionData,
      remainingAccounts,
      tokenProgram,
    } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [burnAuthority] = getBuybackAuthorityPDA(this.mint);
    const [tokenAgentPaymentInCurrency] = getPaymentInCurrencyPDA(
      this.mint,
      currencyMint,
    );
    const burnMintVault = getAssociatedTokenAddressSync(
      this.mint,
      burnAuthority,
      true,
    );

    return this.program.methods
      .agentBuybackTrigger(swapInstructionData)
      .accountsPartial({
        globalBuybackAuthority,
        mint: this.mint,
        tokenAgentPayments,
        tokenAgentPaymentInCurrency,
        currencyMint,
        globalConfig,
        swapProgramToInvoke,
        burnAuthority,
        burnMintVault,
        tokenProgram: tokenProgram ?? TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();
  }

  async extendAccount(
    params: LegacyExtendAccountParams,
  ): Promise<TransactionInstruction> {
    const { account, user } = params;
    return this.program.methods
      .extendAccount()
      .accountsPartial({ account, user })
      .instruction();
  }

  async updateAuthority(
    params: LegacyUpdateAuthorityParams,
  ): Promise<TransactionInstruction> {
    const { authority, newAuthority } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    return this.program.methods
      .agentUpdateAuthority(newAuthority)
      .accountsPartial({ authority, tokenAgentPayments })
      .instruction();
  }
}
