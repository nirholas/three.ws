// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import {
  type AccountMeta,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
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
import {
  CurrencyNotSupportedError,
  JupiterUnavailableError,
} from "./errors";

/**
 * USDC mainnet mint — recognised quote currency for pump-fun USDC coins.
 */
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

/** Anchor account discriminator length (8 bytes). */
const ANCHOR_DISCRIMINATOR_LEN = 8;

/**
 * Offset of `quote_mint` inside a pump bonding-curve account:
 *  - 8 bytes  Anchor discriminator
 *  - 5 * u64  reserves / supply  (40 bytes)
 *  - bool     complete           (1 byte)
 *  - pubkey   creator            (32 bytes)
 *  - bool     is_mayhem_mode     (1 byte)
 *  - bool     is_cashback_coin   (1 byte)
 *  → 83
 */
const BONDING_CURVE_QUOTE_MINT_OFFSET =
  ANCHOR_DISCRIMINATOR_LEN + 5 * 8 + 1 + 32 + 1 + 1;

/**
 * Decode the `quote_mint` field from a raw pump BondingCurve account
 * buffer. Returns NATIVE_MINT for legacy accounts shorter than the
 * post-multi-quote layout (those are SOL-only by definition).
 */
export function decodeBondingCurveQuoteMint(data: Buffer): PublicKey {
  if (data.length < BONDING_CURVE_QUOTE_MINT_OFFSET + 32) {
    return NATIVE_MINT;
  }
  const slice = data.subarray(
    BONDING_CURVE_QUOTE_MINT_OFFSET,
    BONDING_CURVE_QUOTE_MINT_OFFSET + 32,
  );
  const pk = new PublicKey(slice);
  return PublicKey.default.equals(pk) ? NATIVE_MINT : pk;
}

/**
 * Resolve the SPL token program (classic or Token-2022) for a mint.
 * Falls back to TOKEN_PROGRAM_ID for SOL/USDC and on RPC misses.
 */
export async function resolveTokenProgramForMint(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  if (mint.equals(NATIVE_MINT) || mint.equals(USDC_MINT)) {
    return TOKEN_PROGRAM_ID;
  }
  const info = await connection.getAccountInfo(mint);
  if (!info) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

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

  // ─── Multi-currency / USDC-aware helpers ────────────────────────────────

  private static readonly _coinQuoteMintCache = new Map<string, PublicKey>();

  static async getCoinQuoteMint(
    connection: Connection,
    baseMint: PublicKey,
  ): Promise<PublicKey> {
    const key = baseMint.toBase58();
    const cached = PumpAgentOffline._coinQuoteMintCache.get(key);
    if (cached) return cached;

    const [bondingCurve] = getBondingCurvePDA(baseMint);
    const info = await connection.getAccountInfo(bondingCurve);
    if (!info) {
      throw new Error(
        `Bonding curve account not found for mint ${key} (PDA ${bondingCurve.toBase58()})`,
      );
    }

    const quoteMint = decodeBondingCurveQuoteMint(info.data);
    PumpAgentOffline._coinQuoteMintCache.set(key, quoteMint);
    return quoteMint;
  }

  static _clearCoinQuoteMintCache(): void {
    PumpAgentOffline._coinQuoteMintCache.clear();
  }

  async acceptPaymentForCoin(params: {
    connection: Connection;
    user: PublicKey;
    userTokenAccount: PublicKey;
    baseMint: PublicKey;
    amount: BN;
    memo: BN;
    startTime: BN;
    endTime: BN;
  }): Promise<TransactionInstruction> {
    const { connection, user, userTokenAccount, baseMint, amount, memo, startTime, endTime } =
      params;

    const quoteMint = await PumpAgentOffline.getCoinQuoteMint(connection, baseMint);
    const tokenProgram = await resolveTokenProgramForMint(connection, quoteMint);

    return this.acceptPayment({
      user,
      userTokenAccount,
      currencyMint: quoteMint,
      amount,
      memo,
      startTime,
      endTime,
      tokenProgram,
    });
  }

  async distributeAndBuybackForCoin(params: {
    connection: Connection;
    user: PublicKey;
    globalBuybackAuthority: PublicKey;
    baseMint: PublicKey;
    swapProgramToInvoke: PublicKey;
    swapInstructionData: Buffer;
    remainingAccounts: AccountMeta[];
  }): Promise<[TransactionInstruction, TransactionInstruction]> {
    const {
      connection,
      user,
      globalBuybackAuthority,
      baseMint,
      swapProgramToInvoke,
      swapInstructionData,
      remainingAccounts,
    } = params;

    const quoteMint = await PumpAgentOffline.getCoinQuoteMint(connection, baseMint);
    const tpCurrency = await resolveTokenProgramForMint(connection, quoteMint);

    const [distributeIx] = await this.distributePayments({
      user,
      currencyMint: quoteMint,
      tokenProgram: tpCurrency,
    });

    const buybackIx = await this.buybackTrigger({
      globalBuybackAuthority,
      currencyMint: quoteMint,
      swapProgramToInvoke,
      swapInstructionData,
      remainingAccounts,
      tokenProgramCurrency: tpCurrency,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

    return [distributeIx, buybackIx];
  }

  static async buildJupiterSwapData(params: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: BN;
    slippageBps?: number;
    jupiterApiBase?: string;
  }): Promise<Buffer> {
    const {
      inputMint,
      outputMint,
      amount,
      slippageBps = 50,
      jupiterApiBase = "https://quote-api.jup.ag/v6",
    } = params;

    const baseUrl = jupiterApiBase.replace(/\/+$/, "");
    const amountStr = amount.toString();

    const retryFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      let lastErr: unknown;
      for (let i = 0; i < 3; i++) {
        if (i > 0) {
          await new Promise<void>((r) => setTimeout(r, 200 * 2 ** (i - 1)));
        }
        try {
          const resp = await fetch(url, init);
          if (resp.ok) return resp;
          lastErr = new JupiterUnavailableError(
            `HTTP ${resp.status} from Jupiter API`,
            url,
            resp.status,
          );
        } catch (err) {
          lastErr = err;
        }
      }
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new JupiterUnavailableError(
        `Jupiter unavailable after 3 attempts: ${msg}`,
        url,
      );
    };

    const quoteUrl =
      `${baseUrl}/quote` +
      `?inputMint=${inputMint.toBase58()}` +
      `&outputMint=${outputMint.toBase58()}` +
      `&amount=${amountStr}` +
      `&slippageBps=${slippageBps}`;

    const quoteResp = await retryFetch(quoteUrl);
    const quoteResponse = (await quoteResp.json()) as unknown;

    const swapUrl = `${baseUrl}/swap-instructions`;
    const swapResp = await retryFetch(swapUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteResponse, wrapAndUnwrapSol: false }),
    });

    const swapJson = (await swapResp.json()) as { swapInstruction?: { data?: string } };
    const dataB64 = swapJson.swapInstruction?.data;
    if (!dataB64) {
      throw new JupiterUnavailableError(
        "Jupiter swap-instructions response missing swapInstruction.data",
        swapUrl,
      );
    }
    return Buffer.from(dataB64, "base64");
  }

  async validateCurrencySupport(params: {
    connection: Connection;
    baseMint: PublicKey;
  }): Promise<{ supported: boolean; quoteMint: PublicKey; registeredCurrencies: PublicKey[] }> {
    const { connection, baseMint } = params;

    const quoteMint = await PumpAgentOffline.getCoinQuoteMint(connection, baseMint);

    const [globalConfigPda] = getGlobalConfigPDA();
    const cfg = await this.program.account.GlobalConfig.fetch(globalConfigPda);

    const registeredCurrencies = (cfg.supportedCurrenciesMint as PublicKey[]).filter(
      (m) => !PublicKey.default.equals(m),
    );

    const supported =
      quoteMint.equals(NATIVE_MINT) ||
      registeredCurrencies.some((m) => m.equals(quoteMint));

    return { supported, quoteMint, registeredCurrencies };
  }
}
