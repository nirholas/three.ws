// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import {
  type Connection,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { EventParser } from "@coral-xyz/anchor";

import { PumpAgentOffline, resolveTokenProgramForMint } from "./PumpAgentOffline";
import { getPumpProgramWithFallback } from "./program";
import {
  getBuybackAuthorityPDA,
  getGlobalConfigPDA,
  getInvoiceIdPDA,
  getPaymentInCurrencyPDA,
  getTokenAgentPaymentsPDA,
  getWithdrawAuthorityPDA,
} from "./pdas";
import type {
  AgentBalances,
  GlobalConfig,
  PumpEnvironment,
  TokenAgentPaymentInCurrency,
  TokenAgentPayments,
  UpdateBuybackBpsParams,
} from "./types";
import {
  parseAgentEvents,
  type AgentAcceptPaymentEvent,
  type ParsedAgentEvent,
} from "./events";

/**
 * Bounded-concurrency map: runs `fn` over `items` in chunks of at most `size`
 * so we parallelise RPC round-trips without firing an unbounded fan-out that
 * would trip RPC provider rate limits. Order of results matches input order.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  for (let start = 0; start < items.length; start += size) {
    const slice = items.slice(start, start + size);
    const settled = await Promise.all(
      slice.map((item, offset) => fn(item, start + offset)),
    );
    // settled[i] is in-bounds by construction; the `!` satisfies
    // noUncheckedIndexedAccess (Awaited<R> | undefined → R).
    for (let i = 0; i < settled.length; i++) results[start + i] = settled[i]!;
  }
  return results;
}

/** Max concurrent getTransaction round-trips per chunk (RPC-friendly). */
const TX_FETCH_CONCURRENCY = 10;

export class PumpAgent extends PumpAgentOffline {
  private connection?: Connection;
  private environment: PumpEnvironment;

  constructor(
    mint: PublicKey,
    environment: PumpEnvironment = "mainnet",
    connection?: Connection,
  ) {
    super(mint, getPumpProgramWithFallback(connection));
    this.connection = connection;
    this.environment = environment;
  }

  private get blockchainClientBaseUrl(): string {
    return this.environment === "devnet"
      ? "https://blockchain-client.internal.pump.fun"
      : "https://fun-block.pump.fun";
  }

  /**
   * Fetches the current balances for all three vaults for a given currency.
   * Returns the vault address and its token balance.
   * If a vault ATA does not exist yet the balance is reported as 0n.
   */
  async getBalances(
    currencyMint: PublicKey,
    currencyTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<AgentBalances> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);

    const paymentAta = getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true,
      currencyTokenProgram,
    );
    const buybackAta = getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true,
      currencyTokenProgram,
    );
    const withdrawAta = getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true,
      currencyTokenProgram,
    );

    const fetchBalance = async (ata: PublicKey): Promise<bigint> => {
      try {
        const resp = await connection.getTokenAccountBalance(ata);
        return BigInt(resp.value.amount);
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
      quoteMint: currencyMint,
      paymentVault: { address: paymentAta, balance: paymentBal },
      buybackVault: { address: buybackAta, balance: buybackBal },
      withdrawVault: { address: withdrawAta, balance: withdrawBal },
    };
  }

  /**
   * Fetch balances for every currency this agent could receive — i.e. SOL
   * (always) plus every non-default mint in `GlobalConfig.supportedCurrenciesMint`.
   *
   * Returned map is keyed by `mint.toBase58()`. Lookups happen concurrently.
   */
  async getAllCurrencyBalances(): Promise<Map<string, AgentBalances>> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const cfg = await this.getGlobalConfig();

    const splMints = cfg.supportedCurrenciesMint.filter(
      (m: PublicKey) => !PublicKey.default.equals(m),
    );

    // Resolve token programs for SPL mints in one batched RPC.
    const accountInfos = splMints.length
      ? await connection.getMultipleAccountsInfo(splMints)
      : [];

    type MintTp = { mint: PublicKey; tokenProgram: PublicKey };
    const queries: MintTp[] = [
      { mint: NATIVE_MINT, tokenProgram: TOKEN_PROGRAM_ID },
    ];
    for (const [idx, mint] of splMints.entries()) {
      // Skip NATIVE_MINT if it somehow appears in the SPL list — already added.
      if (mint.equals(NATIVE_MINT)) continue;
      const info = accountInfos[idx];
      if (!info) continue;
      queries.push({ mint, tokenProgram: info.owner });
    }

    const results = await Promise.all(
      queries.map(async ({ mint, tokenProgram }) => {
        const balances = await this.getBalances(mint, tokenProgram);
        return [mint.toBase58(), balances] as const;
      }),
    );

    return new Map(results);
  }

  async getCoinQuoteMint(baseMint: PublicKey): Promise<PublicKey> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    return PumpAgentOffline.getCoinQuoteMint(connection, baseMint);
  }

  async getCoinPaymentSummary(baseMint: PublicKey): Promise<{
    quoteMint: PublicKey;
    totalPaymentsReceived: BN;
    pendingBuyback: BN;
    pendingWithdrawal: BN;
    readyToDistribute: boolean;
  }> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const quoteMint = await PumpAgentOffline.getCoinQuoteMint(connection, baseMint);
    const tp = await resolveTokenProgramForMint(connection, quoteMint);

    const [balances, stats] = await Promise.all([
      this.getBalances(quoteMint, tp),
      this.getPaymentStats(quoteMint).catch(() => null),
    ]);

    const totalPaymentsReceived = stats
      ? new BN(stats.totalInvoicePaymentsMade.toString())
      : new BN(0);

    return {
      quoteMint,
      totalPaymentsReceived,
      pendingBuyback: new BN(balances.buybackVault.balance.toString()),
      pendingWithdrawal: new BN(balances.withdrawVault.balance.toString()),
      readyToDistribute: balances.paymentVault.balance > 0n,
    };
  }

  /**
   * Returns the `agent_update_buyback_bps` instruction and auto-fetches
   * supported currencies from GlobalConfig when options are omitted.
   */
  async updateBuybackBps(
    params: UpdateBuybackBpsParams,
  ): Promise<TransactionInstruction> {
    const { authority, buybackBps } = params;
    const [globalConfigPda] = getGlobalConfigPDA();

    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const globalConfigAccount =
      await this.program.account.globalConfig.fetch(globalConfigPda);

    const mints = globalConfigAccount.supportedCurrenciesMint.filter(
      (m: PublicKey) => !PublicKey.default.equals(m),
    );

    const accountInfos = await connection.getMultipleAccountsInfo(mints);

    const supportedCurrencies: { mint: PublicKey; tokenProgram: PublicKey }[] =
      [];
    for (const [idx, mint] of mints.entries()) {
      const info = accountInfos[idx];
      if (info) {
        supportedCurrencies.push({ mint, tokenProgram: info.owner });
      }
    }

    return super.updateBuybackBps(
      { authority, buybackBps },
      { supportedCurrencies },
    );
  }

  // ─── Account Fetch Helpers ──────────────────────────────────────────────

  /**
   * Fetch the on-chain TokenAgentPayments config for this agent's mint.
   * Returns the authority, buyback bps, and mint.
   */
  async getAgentConfig(): Promise<TokenAgentPayments> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const [pda] = getTokenAgentPaymentsPDA(this.mint);
    return this.program.account.tokenAgentPayments.fetch(pda);
  }

  /**
   * Fetch the protocol-wide GlobalConfig account.
   * Returns authorities and the list of supported currency mints.
   */
  async getGlobalConfig(): Promise<GlobalConfig> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const [pda] = getGlobalConfigPDA();
    return this.program.account.globalConfig.fetch(pda);
  }

  /**
   * Fetch the per-currency accounting stats for this agent.
   * Returns total payments, buybacks, withdrawals, and tokens burned.
   */
  async getPaymentStats(
    currencyMint: PublicKey,
  ): Promise<TokenAgentPaymentInCurrency> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const [pda] = getPaymentInCurrencyPDA(this.mint, currencyMint);
    return this.program.account.tokenAgentPaymentInCurrency.fetch(pda);
  }

  /**
   * Fetch the list of supported currency mints from GlobalConfig,
   * filtered to only non-default (non-zero) entries.
   */
  async getSupportedCurrencies(): Promise<PublicKey[]> {
    const config = await this.getGlobalConfig();
    return config.supportedCurrenciesMint.filter(
      (m: PublicKey) => !PublicKey.default.equals(m),
    );
  }

  /**
   * Check whether the TokenAgentPayments account exists on-chain
   * (i.e. whether this agent has been initialized).
   */
  async isInitialized(): Promise<boolean> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const [pda] = getTokenAgentPaymentsPDA(this.mint);
    const info = await connection.getAccountInfo(pda);
    return info !== null;
  }

  // ─── Payment History ────────────────────────────────────────────────────

  /**
   * Fetch recent payment events for this agent by scanning on-chain
   * transaction logs on the TokenAgentPayments PDA.
   *
   * @param limit - Maximum number of transactions to scan (default: 50)
   * @returns Parsed `AgentAcceptPaymentEvent`s in reverse chronological order
   */
  async getPaymentHistory(
    limit = 50,
  ): Promise<AgentAcceptPaymentEvent[]> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const signatures = await connection.getSignaturesForAddress(
      tokenAgentPayments,
      { limit },
    );

    // Fetch transactions concurrently (chunked) rather than one serial
    // round-trip per signature — up to `limit` (default 50) RPC calls.
    const okSignatures = signatures.filter((sig) => !sig.err);
    const txs = await mapWithConcurrency(
      okSignatures,
      TX_FETCH_CONCURRENCY,
      (sig) =>
        connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        }),
    );

    const payments: AgentAcceptPaymentEvent[] = [];
    for (const tx of txs) {
      if (!tx?.meta?.logMessages) continue;
      const events = parseAgentEvents(tx.meta.logMessages, connection);
      for (const event of events) {
        if (event.name === "agentAcceptPaymentEvent") {
          payments.push(event.data as AgentAcceptPaymentEvent);
        }
      }
    }

    return payments;
  }

  /**
   * Fetch all recent events for this agent (payments, distributions,
   * buybacks, withdrawals, etc.) from on-chain transaction logs.
   *
   * @param limit - Maximum number of transactions to scan (default: 50)
   */
  async getEventHistory(
    limit = 50,
  ): Promise<ParsedAgentEvent[]> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const signatures = await connection.getSignaturesForAddress(
      tokenAgentPayments,
      { limit },
    );

    // Fetch transactions concurrently (chunked) instead of serially.
    const okSignatures = signatures.filter((sig) => !sig.err);
    const txs = await mapWithConcurrency(
      okSignatures,
      TX_FETCH_CONCURRENCY,
      (sig) =>
        connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        }),
    );

    const allEvents: ParsedAgentEvent[] = [];
    for (const tx of txs) {
      if (!tx?.meta?.logMessages) continue;
      const events = parseAgentEvents(tx.meta.logMessages, connection);
      allEvents.push(...events);
    }

    return allEvents;
  }

  // ─── Invoice Validation ─────────────────────────────────────────────────

  async validateInvoicePayment(params: {
    user: PublicKey;
    currencyMint: PublicKey;
    // Accept string/BN as well as number: USDC atomic amounts and the
    // timestamp-derived memo both routinely exceed 2^53, so a `number` here
    // silently loses precision and the invoice PDA fails to match. BN() takes
    // a decimal string losslessly — pass the raw requirement string through.
    amount: number | string | BN;
    memo: number | string | BN;
    startTime: number;
    endTime: number;
  }): Promise<boolean> {
    const { user, currencyMint } = params;
    const amount = new BN(params.amount);
    const memo = new BN(params.memo);
    const startTime = new BN(params.startTime);
    const endTime = new BN(params.endTime);

    const [invoiceId] = getInvoiceIdPDA(
      this.mint,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime,
    );

    try {
      const url = new URL(
        "/agents/invoice-id",
        this.blockchainClientBaseUrl,
      );
      url.searchParams.set("invoice-id", invoiceId.toBase58());
      url.searchParams.set("mint", this.mint.toBase58());

      const response = await fetch(url.toString());
      if (response.ok) {
        const data = await response.json();
        return (
          data.user === user.toBase58() &&
          data.tokenized_agent_mint === this.mint.toBase58() &&
          data.currency_mint === currencyMint.toBase58() &&
          new BN(data.amount).eq(amount) &&
          new BN(data.memo).eq(memo) &&
          new BN(data.start_time).eq(startTime) &&
          new BN(data.end_time).eq(endTime)
        );
      }
    } catch {
      // Fall through to RPC validation
    }

    return this.validateInvoicePaymentViaRpc({
      user,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime,
    });
  }

  /** RPC-based fallback: scans on-chain transaction logs for the payment event. */
  private async validateInvoicePaymentViaRpc(params: {
    user: PublicKey;
    currencyMint: PublicKey;
    amount: BN;
    memo: BN;
    startTime: BN;
    endTime: BN;
  }): Promise<boolean> {
    const { user, currencyMint, amount, memo, startTime, endTime } = params;
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const [invoiceId] = getInvoiceIdPDA(
      this.mint,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime,
    );

    const signatures = await connection.getSignaturesForAddress(invoiceId);

    const parser = new EventParser(
      this.program.programId,
      this.program.coder,
    );

    const matchesInvoice = (logs: string[]): boolean => {
      for (const event of parser.parseLogs(logs)) {
        if (event.name !== "agentAcceptPaymentEvent") continue;

        const data = event.data as {
          user: PublicKey;
          tokenizedAgentMint: PublicKey;
          currencyMint: PublicKey;
          amount: BN;
          memo: BN;
          startTime: BN;
          endTime: BN;
        };

        if (
          data.user.equals(user) &&
          data.tokenizedAgentMint.equals(this.mint) &&
          data.currencyMint.equals(currencyMint) &&
          data.amount.eq(amount) &&
          data.memo.eq(memo) &&
          data.startTime.eq(startTime) &&
          data.endTime.eq(endTime)
        ) {
          return true;
        }
      }
      return false;
    };

    // Fetch the invoice PDA's transactions concurrently (chunked) and
    // short-circuit as soon as a chunk yields a matching payment event.
    for (let start = 0; start < signatures.length; start += TX_FETCH_CONCURRENCY) {
      const slice = signatures.slice(start, start + TX_FETCH_CONCURRENCY);
      const txs = await Promise.all(
        slice.map((sig) =>
          connection.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          }),
        ),
      );

      for (const tx of txs) {
        if (!tx || tx.meta?.err) continue;
        const logs = tx.meta?.logMessages;
        if (!logs) continue;
        if (matchesInvoice(logs)) return true;
      }
    }

    return false;
  }
}
