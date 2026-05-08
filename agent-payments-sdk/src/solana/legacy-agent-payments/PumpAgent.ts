// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  PublicKey,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  getBuybackAuthorityPDA,
  getGlobalConfigPDA,
  getTokenAgentPaymentsPDA,
  getWithdrawAuthorityPDA,
} from "./pdas.js";
import { LegacyPumpAgentOffline } from "./PumpAgentOffline.js";
import { getLegacyPumpProgramWithFallback } from "./program.js";
import type {
  LegacyAgentBalances,
  LegacyUpdateBuybackBpsOptions,
  LegacyUpdateBuybackBpsParams,
} from "./types.js";

/**
 * Connection-bound client for the legacy 1.0.7 program. Adds methods that
 * need RPC: balance fetches, automatic supported-currencies discovery for
 * `updateBuybackBps`. Inherits all instruction-only methods from
 * `LegacyPumpAgentOffline`.
 */
export class LegacyPumpAgent extends LegacyPumpAgentOffline {
  readonly connection: Connection;

  constructor(mint: PublicKey, connection: Connection) {
    super(mint, getLegacyPumpProgramWithFallback(connection));
    this.connection = connection;
  }

  async getBalances(currencyMint: PublicKey): Promise<LegacyAgentBalances> {
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);

    const paymentAta = getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true,
    );
    const buybackAta = getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true,
    );
    const withdrawAta = getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true,
    );

    const fetchBalance = async (ata: PublicKey): Promise<bigint> => {
      try {
        const res = await this.connection.getTokenAccountBalance(ata);
        return BigInt(res.value.amount);
      } catch {
        return 0n;
      }
    };

    const [paymentBal, buybackBal, withdrawBal] = await Promise.all([
      fetchBalance(paymentAta),
      fetchBalance(buybackAta),
      fetchBalance(withdrawAta),
    ]);

    return {
      paymentVault: { address: paymentAta, balance: paymentBal },
      buybackVault: { address: buybackAta, balance: buybackBal },
      withdrawVault: { address: withdrawAta, balance: withdrawBal },
    };
  }

  /**
   * Override of `LegacyPumpAgentOffline.updateBuybackBps` that auto-fetches
   * the supported currencies list from the on-chain `globalConfig` when not
   * provided. Mirrors the 1.0.7 SDK's connection-bound behavior.
   */
  override async updateBuybackBps(
    params: LegacyUpdateBuybackBpsParams,
    options?: LegacyUpdateBuybackBpsOptions,
  ): Promise<TransactionInstruction> {
    let supportedCurrenciesMint = options?.supportedCurrenciesMint;
    if (!supportedCurrenciesMint) {
      const [globalConfigPda] = getGlobalConfigPDA();
      const account = await (this.program as unknown as {
        account: { globalConfig: { fetch: (k: PublicKey) => Promise<{ supportedCurrenciesMint: PublicKey[] }> } };
      }).account.globalConfig.fetch(globalConfigPda);
      supportedCurrenciesMint = account.supportedCurrenciesMint;
    }
    return super.updateBuybackBps(params, { supportedCurrenciesMint });
  }
}
