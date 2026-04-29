import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import { BN, type Program } from "@coral-xyz/anchor";

import type { PumpAgentPayments as PumpAgentPaymentsIDL } from "./idl/pump_agent_payments";
import { getPumpProgramWithFallback } from "./program";
import {
  getBondingCurvePDA,
  getBuybackAuthorityPDA,
  getGlobalConfigPDA,
  getInvoiceIdPDA,
  getPaymentInCurrencyPDA,
  getTokenAgentPaymentsPDA,
  getWithdrawAuthorityPDA,
} from "./pdas";
import type {
  AcceptPaymentParams,
  BuildAcceptPaymentParams,
  BuybackTriggerParams,
  CloseAccountParams,
  CreateParams,
  DistributePaymentsParams,
  ExtendAccountParams,
  UpdateAuthorityParams,
  UpdateBuybackBpsOptions,
  UpdateBuybackBpsParams,
  WithdrawParams,
} from "./types";

function toBN(value: bigint | number | string): BN {
  return new BN(value.toString());
}

export class PumpAgentOffline {
  readonly mint: PublicKey;
  protected readonly program: Program<PumpAgentPaymentsIDL>;

  static readonly DEFAULT_COMPUTE_UNIT_LIMIT_FOR_AGENT_PAYMENTS = 100_000;
  static readonly DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS = 1_000;

  constructor(
    mint: PublicKey,
    program: Program<PumpAgentPaymentsIDL> = getPumpProgramWithFallback(),
  ) {
    this.mint = mint;
    this.program = program;
  }

  static load(
    mint: PublicKey,
    connection?: Connection,
  ): PumpAgentOffline {
    return new PumpAgentOffline(mint, getPumpProgramWithFallback(connection));
  }

  async create(params: CreateParams): Promise<TransactionInstruction> {
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

  async withdraw(params: WithdrawParams): Promise<TransactionInstruction> {
    const { authority, currencyMint, receiverAta, tokenProgram } = params;
    const tp = tokenProgram ?? TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);
    const withdrawVault = getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true,
      tp,
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
        tokenProgram: tp,
      })
      .instruction();
  }

  async updateBuybackBps(
    params: UpdateBuybackBpsParams,
    options: UpdateBuybackBpsOptions,
  ): Promise<TransactionInstruction> {
    const { authority, buybackBps } = params;
    const supportedCurrencies = options.supportedCurrencies;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();

    const remainingAccounts: {
      pubkey: PublicKey;
      isWritable: boolean;
      isSigner: boolean;
    }[] = [];

    for (const currency of supportedCurrencies) {
      if (currency.mint.equals(PublicKey.default)) continue;
      const ata = getAssociatedTokenAddressSync(
        currency.mint,
        tokenAgentPayments,
        true,
        currency.tokenProgram,
      );
      remainingAccounts.push({
        pubkey: ata,
        isWritable: false,
        isSigner: false,
      });
    }

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
    params: AcceptPaymentParams,
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
    const tp = tokenProgram ?? TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [paymentInCurrency] = getPaymentInCurrencyPDA(
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
      tp,
    );

    return this.program.methods
      .agentAcceptPayment(amount, memo, startTime, endTime)
      .accountsPartial({
        user,
        userTokenAccount,
        tokenAgentPayments,
        tokenAgentAssociatedAccount,
        tokenAgentPaymentInCurrency: paymentInCurrency,
        globalConfig,
        invoiceId,
        currencyMint,
        tokenProgram: tp,
      })
      .instruction();
  }

  async buildAcceptPaymentInstructions(
    params: BuildAcceptPaymentParams,
  ): Promise<TransactionInstruction[]> {
    const { user, currencyMint } = params;
    const computeUnitLimit =
      params.computeUnitLimit ??
      PumpAgentOffline.DEFAULT_COMPUTE_UNIT_LIMIT_FOR_AGENT_PAYMENTS;
    const tp = params.tokenProgram ?? TOKEN_PROGRAM_ID;

    const userTokenAccount = getAssociatedTokenAddressSync(
      currencyMint,
      user,
      false,
      tp,
    );

    const acceptIx = await this.acceptPayment({
      user,
      userTokenAccount,
      currencyMint,
      amount: toBN(params.amount),
      memo: toBN(params.memo),
      startTime: toBN(params.startTime),
      endTime: toBN(params.endTime),
      tokenProgram: params.tokenProgram,
    });

    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
    ];

    if (params.computeUnitPrice != null) {
      ixs.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: params.computeUnitPrice,
        }),
      );
    }

    if (currencyMint.equals(NATIVE_MINT)) {
      return [
        ...ixs,
        createAssociatedTokenAccountIdempotentInstruction(
          user,
          userTokenAccount,
          user,
          NATIVE_MINT,
        ),
        SystemProgram.transfer({
          fromPubkey: user,
          toPubkey: userTokenAccount,
          lamports: BigInt(params.amount.toString()),
        }),
        createSyncNativeInstruction(userTokenAccount),
        acceptIx,
        createCloseAccountInstruction(userTokenAccount, user, user),
      ];
    }

    return [...ixs, acceptIx];
  }

  async distributePayments(
    params: DistributePaymentsParams,
  ): Promise<TransactionInstruction[]> {
    const {
      user,
      currencyMint,
      tokenProgram,
      includeTransferExtraLamportsForNative = false,
    } = params;
    const tp = tokenProgram ?? TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [paymentInCurrency] = getPaymentInCurrencyPDA(
      this.mint,
      currencyMint,
    );
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);

    const tokenAgentAssociatedAccount = getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true,
      tp,
    );
    const buybackVault = getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true,
      tp,
    );
    const withdrawVault = getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true,
      tp,
    );

    const distributeIx = await this.program.methods
      .agentDistributePayments()
      .accountsPartial({
        user,
        globalConfig,
        currencyMint,
        tokenAgentPayments,
        tokenAgentPaymentInCurrency: paymentInCurrency,
        tokenAgentAssociatedAccount,
        buybackAuthority,
        withdrawAuthority,
        buybackVault,
        withdrawVault,
        tokenProgram: tp,
      })
      .instruction();

    if (includeTransferExtraLamportsForNative && currencyMint.equals(NATIVE_MINT)) {
      const transferIx = await this.program.methods
        .agentTransferExtraLamports()
        .accountsPartial({
          tokenAgentPayments,
          tokenAgentAssociatedAccount,
        })
        .instruction();
      return [transferIx, distributeIx];
    }

    return [distributeIx];
  }

  async buybackTrigger(
    params: BuybackTriggerParams,
  ): Promise<TransactionInstruction> {
    const {
      globalBuybackAuthority,
      currencyMint,
      swapProgramToInvoke,
      swapInstructionData,
      remainingAccounts,
      tokenProgramCurrency,
      tokenProgram,
    } = params;
    const tp = tokenProgram ?? TOKEN_PROGRAM_ID;
    const tpCurrency = tokenProgramCurrency ?? TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [paymentInCurrency] = getPaymentInCurrencyPDA(
      this.mint,
      currencyMint,
    );
    const burnMintVault = getAssociatedTokenAddressSync(
      this.mint,
      buybackAuthority,
      true,
      tp,
    );
    const burnCurrencyMintVault = getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true,
      tpCurrency,
    );

    return this.program.methods
      .agentBuybackTrigger(swapInstructionData)
      .accountsPartial({
        globalBuybackAuthority,
        mint: this.mint,
        tokenAgentPayments,
        tokenAgentPaymentInCurrency: paymentInCurrency,
        currencyMint,
        globalConfig,
        swapProgramToInvoke,
        burnAuthority: buybackAuthority,
        burnMintVault,
        burnCurrencyMintVault,
        tokenProgram: tp,
        tokenProgramCurrency: tpCurrency,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();
  }

  async extendAccount(
    params: ExtendAccountParams,
  ): Promise<TransactionInstruction> {
    const { account, user } = params;
    return this.program.methods
      .extendAccount()
      .accountsPartial({ account, user })
      .instruction();
  }

  async updateAuthority(
    params: UpdateAuthorityParams,
  ): Promise<TransactionInstruction> {
    const { authority, newAuthority } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);

    return this.program.methods
      .agentUpdateAuthority(newAuthority)
      .accountsPartial({
        authority,
        tokenAgentPayments,
      })
      .instruction();
  }

  /**
   * Returns the `close_account` instruction to close a program account
   * and reclaim its rent-exempt lamports.
   */
  async closeAccount(
    params: CloseAccountParams,
  ): Promise<TransactionInstruction> {
    const { account, user } = params;
    const [globalConfig] = getGlobalConfigPDA();

    return this.program.methods
      .closeAccount()
      .accountsPartial({
        account,
        user,
        globalConfig,
      })
      .instruction();
  }
}
