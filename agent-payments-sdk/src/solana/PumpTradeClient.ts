// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

/**
 * PumpTradeClient — v2 bonding-curve buy / sell / exact-quote / cashback.
 *
 * All build* methods batch Global + FeeConfig + bondingCurve (+ userAta for buy)
 * into a SINGLE getMultipleAccountsInfo call. No sequential RPC.
 *
 * Routing: reads bondingCurve.quoteMint on-chain → SOL-paired or USDC-paired
 * coins are handled identically. Zero changes needed when USDC coins go live.
 */

import { BN } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  GLOBAL_PDA,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  PUMP_EVENT_AUTHORITY_PDA,
  PUMP_FEE_CONFIG_PDA,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
  bondingCurveMarketCap,
  bondingCurvePda,
  creatorVaultPda,
  feeSharingConfigPda,
  getBuySolAmountFromTokenAmount,
  getBuyTokenAmountFromSolAmount,
  getPumpProgram,
  getSellSolAmountFromTokenAmount,
  userVolumeAccumulatorPda,
} from "@pump-fun/pump-sdk";
import { pickBuybackFeeRecipient, pickFeeRecipient } from "./constants.js";
import type {
  BuyQuote,
  BuyResult,
  ExactQuoteResult,
  SellQuote,
  SellResult,
} from "./types.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Coin has graduated (bondingCurve.complete === true). Use AMM. */
export class CoinGraduatedError extends Error {
  constructor(mint: PublicKey) {
    super(
      `Bonding curve for mint ${mint.toBase58()} is complete — use AMM instead.`,
    );
    this.name = "CoinGraduatedError";
  }
}

/** No bonding curve account exists for the mint. */
export class CoinNotFoundError extends Error {
  constructor(mint: PublicKey) {
    super(`Bonding curve account not found for mint ${mint.toBase58()}.`);
    this.name = "CoinNotFoundError";
  }
}

/** Requested amount exceeds available reserves. */
export class InsufficientLiquidityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientLiquidityError";
  }
}

/** Quote mint is not in the pump.fun whitelist. */
export class UnsupportedQuoteMintError extends Error {
  constructor(quoteMint: PublicKey) {
    super(
      `Quote mint ${quoteMint.toBase58()} is not owned by TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID.`,
    );
    this.name = "UnsupportedQuoteMintError";
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const KNOWN_TOKEN_PROGRAMS = new Set([
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
]);

function resolveQuoteMintFromCurve(quoteMintOnChain: PublicKey): PublicKey {
  if (!quoteMintOnChain || quoteMintOnChain.equals(PublicKey.default)) {
    return NATIVE_MINT;
  }
  return quoteMintOnChain;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computePriceImpactPct(quoteAmount: BN, marketCap: BN): number {
  if (marketCap.isZero()) return 0;
  return clamp((quoteAmount.toNumber() / marketCap.toNumber()) * 100, 0, 100);
}

// ─── PumpTradeClient ──────────────────────────────────────────────────────────

export class PumpTradeClient {
  /** quoteMint never changes once a coin is created — safe to cache forever. */
  private readonly quoteMintCache = new Map<string, PublicKey>();
  /** Token program for a quote mint (also stable after mint creation). */
  private readonly tokenProgramCache = new Map<string, PublicKey>();

  constructor(private readonly connection: Connection) {}

  // ── resolveQuoteMint ────────────────────────────────────────────────────────

  /** Read bondingCurve.quoteMint from chain, normalize default → NATIVE_MINT. Caches. */
  async resolveQuoteMint(mint: PublicKey): Promise<PublicKey> {
    const key = mint.toBase58();
    const cached = this.quoteMintCache.get(key);
    if (cached) return cached;

    const info = await this.connection.getAccountInfo(bondingCurvePda(mint));
    if (!info) throw new CoinNotFoundError(mint);

    const curve = PUMP_SDK.decodeBondingCurve(info);
    const resolved = resolveQuoteMintFromCurve(curve.quoteMint);
    this.quoteMintCache.set(key, resolved);
    return resolved;
  }

  // ── quoteForBuy ─────────────────────────────────────────────────────────────

  async quoteForBuy(params: {
    mint: PublicKey;
    quoteAmount: BN;
    slippagePct?: number;
  }): Promise<BuyQuote> {
    const { mint, quoteAmount } = params;
    const slippage = params.slippagePct ?? 5;

    const {
      global,
      feeConfig,
      bondingCurve,
      quoteMint,
      quoteTokenProgram,
    } = await this._fetchAndDecode(mint);

    const mintSupply = bondingCurve.tokenTotalSupply;

    const expectedBaseTokens = getBuyTokenAmountFromSolAmount({
      global, feeConfig, mintSupply, bondingCurve, amount: quoteAmount,
    });

    const preciseQuoteAmount = getBuySolAmountFromTokenAmount({
      global, feeConfig, mintSupply, bondingCurve, amount: expectedBaseTokens,
    });

    const maxQuoteCost = new BN(
      Math.ceil(preciseQuoteAmount.toNumber() * (1 + slippage / 100)),
    );

    const marketCap = bondingCurveMarketCap({
      mintSupply,
      virtualQuoteReserves: bondingCurve.virtualQuoteReserves,
      virtualTokenReserves: bondingCurve.virtualTokenReserves,
    });

    return {
      quoteMint,
      quoteTokenProgram,
      quoteAmount,
      expectedBaseTokens,
      preciseQuoteAmount,
      maxQuoteCost,
      slippagePct: slippage,
      priceImpactPct: computePriceImpactPct(quoteAmount, marketCap),
    };
  }

  // ── quoteForSell ────────────────────────────────────────────────────────────

  async quoteForSell(params: {
    mint: PublicKey;
    baseAmount: BN;
    slippagePct?: number;
  }): Promise<SellQuote> {
    const { mint, baseAmount } = params;
    const slippage = params.slippagePct ?? 5;

    const {
      global,
      feeConfig,
      bondingCurve,
      quoteMint,
      quoteTokenProgram,
    } = await this._fetchAndDecode(mint);

    const mintSupply = bondingCurve.tokenTotalSupply;

    const expectedQuoteOut = getSellSolAmountFromTokenAmount({
      global, feeConfig, mintSupply, bondingCurve, amount: baseAmount,
    });

    const minQuoteOut = new BN(
      Math.max(0, Math.floor(expectedQuoteOut.toNumber() * (1 - slippage / 100))),
    );

    const marketCap = bondingCurveMarketCap({
      mintSupply,
      virtualQuoteReserves: bondingCurve.virtualQuoteReserves,
      virtualTokenReserves: bondingCurve.virtualTokenReserves,
    });

    return {
      quoteMint,
      quoteTokenProgram,
      baseAmount,
      expectedQuoteOut,
      minQuoteOut,
      slippagePct: slippage,
      priceImpactPct: computePriceImpactPct(expectedQuoteOut, marketCap),
    };
  }

  // ── buildBuyInstructions ────────────────────────────────────────────────────

  async buildBuyInstructions(params: {
    mint: PublicKey;
    user: PublicKey;
    quoteAmount: BN;
    slippagePct?: number;
  }): Promise<BuyResult> {
    const { mint, user, quoteAmount } = params;
    const slippage = params.slippagePct ?? 5;

    const baseTokenProgram = await this._baseTokenProgram(mint);
    const userAta = getAssociatedTokenAddressSync(mint, user, true, baseTokenProgram);

    // Single batch RPC: Global + FeeConfig + bondingCurve + userAta
    const bcAddr = bondingCurvePda(mint);
    const [globalInfo, feeConfigInfo, bcInfo, userAtaInfo] =
      await this.connection.getMultipleAccountsInfo([
        GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, bcAddr, userAta,
      ]);

    if (!globalInfo) throw new Error("Global account not found — wrong network?");
    if (!bcInfo) throw new CoinNotFoundError(mint);

    const global = PUMP_SDK.decodeGlobal(globalInfo);
    const feeConfig = feeConfigInfo ? PUMP_SDK.decodeFeeConfig(feeConfigInfo) : null;
    const bondingCurve = PUMP_SDK.decodeBondingCurve(bcInfo);

    if (bondingCurve.complete) throw new CoinGraduatedError(mint);

    const quoteMint = resolveQuoteMintFromCurve(bondingCurve.quoteMint);
    this.quoteMintCache.set(mint.toBase58(), quoteMint);
    const quoteTokenProgram = await this._quoteTokenProgram(quoteMint);

    const mintSupply = bondingCurve.tokenTotalSupply;

    const expectedBaseTokens = getBuyTokenAmountFromSolAmount({
      global, feeConfig, mintSupply, bondingCurve, amount: quoteAmount,
    });

    if (expectedBaseTokens.lte(new BN(0))) {
      throw new InsufficientLiquidityError(
        "Computed token amount is zero — amount too small or reserves exhausted.",
      );
    }

    const preciseQuoteAmount = getBuySolAmountFromTokenAmount({
      global, feeConfig, mintSupply, bondingCurve, amount: expectedBaseTokens,
    });

    const mayhemMode = bondingCurve.isMayhemMode ?? false;
    const feeRecipient = pickFeeRecipient(global, mayhemMode);
    const buybackFeeRecipient = pickBuybackFeeRecipient();

    const instructions = await PUMP_SDK.buyV2Instructions({
      global,
      bondingCurveAccountInfo: bcInfo,
      bondingCurve,
      associatedUserAccountInfo: userAtaInfo ?? null,
      mint,
      user,
      amount: expectedBaseTokens,
      quoteAmount: preciseQuoteAmount,
      slippage,
      tokenProgram: baseTokenProgram,
      quoteTokenProgram,
    });

    return {
      instructions,
      quoteMint,
      quoteTokenProgram,
      expectedBaseTokens,
      preciseQuoteAmount,
      feeRecipient,
      buybackFeeRecipient,
    };
  }

  // ── buildSellInstructions ───────────────────────────────────────────────────

  async buildSellInstructions(params: {
    mint: PublicKey;
    user: PublicKey;
    baseAmount: BN;
    slippagePct?: number;
  }): Promise<SellResult> {
    const { mint, user, baseAmount } = params;
    const slippage = params.slippagePct ?? 5;

    const baseTokenProgram = await this._baseTokenProgram(mint);

    // Single batch RPC: Global + FeeConfig + bondingCurve
    const bcAddr = bondingCurvePda(mint);
    const [globalInfo, feeConfigInfo, bcInfo] =
      await this.connection.getMultipleAccountsInfo([
        GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, bcAddr,
      ]);

    if (!globalInfo) throw new Error("Global account not found — wrong network?");
    if (!bcInfo) throw new CoinNotFoundError(mint);

    const global = PUMP_SDK.decodeGlobal(globalInfo);
    const feeConfig = feeConfigInfo ? PUMP_SDK.decodeFeeConfig(feeConfigInfo) : null;
    const bondingCurve = PUMP_SDK.decodeBondingCurve(bcInfo);

    if (bondingCurve.complete) throw new CoinGraduatedError(mint);

    const quoteMint = resolveQuoteMintFromCurve(bondingCurve.quoteMint);
    this.quoteMintCache.set(mint.toBase58(), quoteMint);
    const quoteTokenProgram = await this._quoteTokenProgram(quoteMint);

    const mintSupply = bondingCurve.tokenTotalSupply;

    const expectedQuoteOut = getSellSolAmountFromTokenAmount({
      global, feeConfig, mintSupply, bondingCurve, amount: baseAmount,
    });

    const instructions = await PUMP_SDK.sellV2Instructions({
      global,
      bondingCurveAccountInfo: bcInfo,
      bondingCurve,
      mint,
      user,
      amount: baseAmount,
      quoteAmount: expectedQuoteOut,
      slippage,
      tokenProgram: baseTokenProgram,
      quoteTokenProgram,
    });

    return { instructions, quoteMint, quoteTokenProgram, expectedQuoteOut };
  }

  // ── buildBuyExactQuoteInInstructions ────────────────────────────────────────

  /**
   * Build buy_exact_quote_in_v2. Drives the Anchor program directly because
   * the SDK has no JS helper for this instruction. Mirrors
   * swap/scripts/build-buy-exact-quote-in-v2-tx.mjs exactly.
   */
  async buildBuyExactQuoteInInstructions(params: {
    mint: PublicKey;
    user: PublicKey;
    spendableQuoteIn: BN;
    minBaseOut: BN;
  }): Promise<ExactQuoteResult> {
    const { mint, user, spendableQuoteIn, minBaseOut } = params;

    const baseTokenProgram = await this._baseTokenProgram(mint);

    // Single batch RPC: Global + FeeConfig + bondingCurve
    const bcAddr = bondingCurvePda(mint);
    const [globalInfo, feeConfigInfo, bcInfo] =
      await this.connection.getMultipleAccountsInfo([
        GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, bcAddr,
      ]);

    if (!globalInfo) throw new Error("Global account not found — wrong network?");
    if (!bcInfo) throw new CoinNotFoundError(mint);

    const global = PUMP_SDK.decodeGlobal(globalInfo);
    const bondingCurve = PUMP_SDK.decodeBondingCurve(bcInfo);

    if (bondingCurve.complete) throw new CoinGraduatedError(mint);

    const quoteMint = resolveQuoteMintFromCurve(bondingCurve.quoteMint);
    this.quoteMintCache.set(mint.toBase58(), quoteMint);
    const quoteTokenProgram = await this._quoteTokenProgram(quoteMint);

    const creator = bondingCurve.creator;
    const mayhemMode = bondingCurve.isMayhemMode ?? false;

    const feeRecipient = pickFeeRecipient(global, mayhemMode);
    const buybackFeeRecipient = pickBuybackFeeRecipient();

    const ata = (owner: PublicKey, tkProg: PublicKey) =>
      getAssociatedTokenAddressSync(quoteMint, owner, true, tkProg);

    const associatedQuoteFeeRecipient = ata(feeRecipient, quoteTokenProgram);
    const associatedQuoteBuybackFeeRecipient = ata(buybackFeeRecipient, quoteTokenProgram);
    const associatedBaseBondingCurve = getAssociatedTokenAddressSync(
      mint, bcAddr, true, baseTokenProgram,
    );
    const associatedQuoteBondingCurve = ata(bcAddr, quoteTokenProgram);
    const associatedBaseUser = getAssociatedTokenAddressSync(
      mint, user, true, baseTokenProgram,
    );
    const associatedQuoteUser = ata(user, quoteTokenProgram);
    const creatorVault = creatorVaultPda(creator);
    const associatedCreatorVault = ata(creatorVault, quoteTokenProgram);
    const userVolAcc = userVolumeAccumulatorPda(user);
    const associatedUserVolumeAccumulator = ata(userVolAcc, quoteTokenProgram);

    const program = getPumpProgram(this.connection);
    const buyExactIx = await program.methods
      .buyExactQuoteInV2(spendableQuoteIn, minBaseOut)
      .accountsPartial({
        global: GLOBAL_PDA,
        baseMint: mint,
        quoteMint,
        baseTokenProgram,
        quoteTokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        feeRecipient,
        associatedQuoteFeeRecipient,
        buybackFeeRecipient,
        associatedQuoteBuybackFeeRecipient,
        bondingCurve: bcAddr,
        associatedBaseBondingCurve,
        associatedQuoteBondingCurve,
        user,
        associatedBaseUser,
        associatedQuoteUser,
        creatorVault,
        associatedCreatorVault,
        sharingConfig: feeSharingConfigPda(mint),
        globalVolumeAccumulator: GLOBAL_VOLUME_ACCUMULATOR_PDA,
        userVolumeAccumulator: userVolAcc,
        associatedUserVolumeAccumulator,
        feeConfig: PUMP_FEE_CONFIG_PDA,
        feeProgram: PUMP_FEE_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: PUMP_EVENT_AUTHORITY_PDA,
        program: PUMP_PROGRAM_ID,
      })
      .instruction();

    const isNative = quoteMint.equals(NATIVE_MINT);
    const ataIxs: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(
        user, associatedBaseUser, user, mint, baseTokenProgram,
      ),
      ...(isNative
        ? []
        : [
            createAssociatedTokenAccountIdempotentInstruction(
              user, associatedQuoteUser, user, quoteMint, quoteTokenProgram,
            ),
          ]),
    ];

    return {
      instructions: [...ataIxs, buyExactIx],
      quoteMint,
      quoteTokenProgram,
    };
  }

  // ── buildClaimCashbackInstructions ──────────────────────────────────────────

  /**
   * Auto-discovers claimable quote mints by calling getTokenAccountsByOwner on
   * the UserVolumeAccumulator PDA. Any non-zero ATA → claimable cashback.
   * Pass quoteMints to skip discovery.
   */
  async buildClaimCashbackInstructions(params: {
    user: PublicKey;
    quoteMints?: PublicKey[];
  }): Promise<TransactionInstruction[]> {
    const { user } = params;
    let quoteMints = params.quoteMints;

    if (!quoteMints) {
      quoteMints = await this._discoverCashbackMints(user);
    }

    const ixs: TransactionInstruction[] = [];
    for (const quoteMint of quoteMints) {
      const quoteTokenProgram = await this._quoteTokenProgram(quoteMint);
      ixs.push(
        await PUMP_SDK.claimCashbackV2Instruction({
          user,
          quoteMint,
          quoteTokenProgram,
        }),
      );
    }
    return ixs;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _discoverCashbackMints(user: PublicKey): Promise<PublicKey[]> {
    const userVolAcc = userVolumeAccumulatorPda(user);
    const [splResult, t22Result] = await Promise.all([
      this.connection.getTokenAccountsByOwner(userVolAcc, {
        programId: TOKEN_PROGRAM_ID,
      }),
      this.connection.getTokenAccountsByOwner(userVolAcc, {
        programId: TOKEN_2022_PROGRAM_ID,
      }),
    ]);

    const mints: PublicKey[] = [];
    for (const { account } of [...splResult.value, ...t22Result.value]) {
      // SPL token account layout: mint = bytes 0–31, amount = bytes 64–71 (LE u64)
      const mintPk = new PublicKey(account.data.slice(0, 32));
      const amount = account.data.readBigUInt64LE(64);
      if (amount > 0n) mints.push(mintPk);
    }
    return mints;
  }

  private async _baseTokenProgram(mint: PublicKey): Promise<PublicKey> {
    const cacheKey = `base:${mint.toBase58()}`;
    const cached = this.tokenProgramCache.get(cacheKey);
    if (cached) return cached;
    const info = await this.connection.getAccountInfo(mint);
    if (!info) throw new Error(`Mint account not found: ${mint.toBase58()}`);
    const program = KNOWN_TOKEN_PROGRAMS.has(info.owner.toBase58())
      ? info.owner
      : TOKEN_PROGRAM_ID;
    this.tokenProgramCache.set(cacheKey, program);
    return program;
  }

  private async _quoteTokenProgram(quoteMint: PublicKey): Promise<PublicKey> {
    if (quoteMint.equals(NATIVE_MINT)) return TOKEN_PROGRAM_ID;
    const key = quoteMint.toBase58();
    const cached = this.tokenProgramCache.get(key);
    if (cached) return cached;
    const info = await this.connection.getAccountInfo(quoteMint, "confirmed");
    if (!info) throw new Error(`Quote mint not found: ${quoteMint.toBase58()}`);
    if (!KNOWN_TOKEN_PROGRAMS.has(info.owner.toBase58())) {
      throw new UnsupportedQuoteMintError(quoteMint);
    }
    this.tokenProgramCache.set(key, info.owner);
    return info.owner;
  }

  /**
   * Convenience: fetch + decode + throw in one call for quote methods.
   * Does NOT batch with userAta (quote methods don't need it).
   */
  private async _fetchAndDecode(mint: PublicKey) {
    const bcAddr = bondingCurvePda(mint);
    const [globalInfo, feeConfigInfo, bcInfo] =
      await this.connection.getMultipleAccountsInfo([
        GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, bcAddr,
      ]);

    if (!globalInfo) throw new Error("Global account not found — wrong network?");
    if (!bcInfo) throw new CoinNotFoundError(mint);

    const global = PUMP_SDK.decodeGlobal(globalInfo);
    const feeConfig = feeConfigInfo ? PUMP_SDK.decodeFeeConfig(feeConfigInfo) : null;
    const bondingCurve = PUMP_SDK.decodeBondingCurve(bcInfo);

    if (bondingCurve.complete) throw new CoinGraduatedError(mint);

    const quoteMint = resolveQuoteMintFromCurve(bondingCurve.quoteMint);
    this.quoteMintCache.set(mint.toBase58(), quoteMint);
    const quoteTokenProgram = await this._quoteTokenProgram(quoteMint);

    return { global, feeConfig, bondingCurve, quoteMint, quoteTokenProgram };
  }

  /** Exported for convenience; USDC mainnet address. */
  static readonly USDC_MINT = USDC_MINT;
}
