import {
  type Connection,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN, EventParser } from "@coral-xyz/anchor";

import { PumpAgentOffline } from "./PumpAgentOffline";
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
      paymentVault: { address: paymentAta, balance: paymentBal },
      buybackVault: { address: buybackAta, balance: buybackBal },
      withdrawVault: { address: withdrawAta, balance: withdrawBal },
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
      await this.program.account.GlobalConfig.fetch(globalConfigPda);

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
    return this.program.account.TokenAgentPayments.fetch(pda);
  }

  /**
   * Fetch the protocol-wide GlobalConfig account.
   * Returns authorities and the list of supported currency mints.
   */
  async getGlobalConfig(): Promise<GlobalConfig> {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");

    const [pda] = getGlobalConfigPDA();
    return this.program.account.GlobalConfig.fetch(pda);
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
    return this.program.account.TokenAgentPaymentInCurrency.fetch(pda);
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

    const payments: AgentAcceptPaymentEvent[] = [];

    for (const sig of signatures) {
      if (sig.err) continue;
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });
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

    const allEvents: ParsedAgentEvent[] = [];

    for (const sig of signatures) {
      if (sig.err) continue;
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });
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
    amount: number;
    memo: number;
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

    for (const sig of signatures) {
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || tx.meta?.err) continue;

      const logs = tx.meta?.logMessages;
      if (!logs) continue;

      const parser = new EventParser(
        this.program.programId,
        this.program.coder,
      );

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
    }

    return false;
  }
}
