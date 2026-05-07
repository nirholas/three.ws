import { Connection, PublicKey } from "@solana/web3.js";
import type { Address } from "viem";
import { PumpAgent } from "./solana/PumpAgent.js";
import type {
  CrossChainPaymentStatusResult,
  CrossChainQuote,
  EvmPaymentParams,
  EvmPaymentReceipt,
  EvmPaymentTransaction,
  SupportedEvmChainId,
} from "./types.js";
import { getChain, isSupported } from "./chains.js";
import { getQuote, type QuoteRequest } from "./evm/quote.js";
import { buildEvmPaymentTransaction } from "./evm/transaction.js";
import { getPaymentStatus, waitForSolanaArrival } from "./evm/validate.js";

export interface CrossChainPaymentClientConfig {
  /** Solana RPC endpoint */
  rpcEndpoint: string;
  /** Agent token mint (base58) */
  agentMint: string;
  /** "mainnet" | "devnet" — defaults to mainnet */
  environment?: "mainnet" | "devnet";
  /** Optional Pump.fun API key for higher rate limits */
  apiKey?: string;
}

/**
 * CrossChainPaymentClient — unified entry point for agent payments from any chain.
 *
 * Solana-native flow (existing):
 *   client.solana.buildAcceptPaymentInstructions(...)
 *
 * EVM cross-chain flow (new):
 *   const quote = await client.getEvmQuote(...)
 *   const txs   = await client.buildEvmPayment({ quote, ... })
 *   // user signs txs.approval then txs.bridge in their EVM wallet
 *   const receipt = await client.submitEvmPayment(bridgeTxHash, quote)
 *   const result  = await client.waitForArrival(receipt)
 */
export class CrossChainPaymentClient {
  readonly agentMint: string;
  readonly solana: PumpAgent;
  private readonly apiKey?: string;

  constructor(config: CrossChainPaymentClientConfig) {
    this.agentMint = config.agentMint;
    this.apiKey = config.apiKey;

    const connection = new Connection(config.rpcEndpoint, "confirmed");
    const mint = new PublicKey(config.agentMint);
    this.solana = new PumpAgent(mint, config.environment ?? "mainnet", connection);
  }

  // ---------------------------------------------------------------------------
  // EVM → Solana cross-chain flow
  // ---------------------------------------------------------------------------

  /**
   * Get a cross-chain payment quote.
   * Always fetch a fresh quote immediately before building the transaction.
   */
  async getEvmQuote(
    fromChainId: SupportedEvmChainId,
    fromToken: Address | "native",
    fromAmount: bigint
  ): Promise<CrossChainQuote> {
    if (!isSupported(fromChainId)) {
      throw new Error(`Chain ${fromChainId} is not supported`);
    }
    const req: QuoteRequest = {
      fromChainId,
      fromToken,
      fromAmount,
      agentMint: this.agentMint,
    };
    return getQuote(req, this.apiKey);
  }

  /**
   * Build the EVM transaction(s) for a cross-chain payment.
   * Send approval first (if present), then bridge.
   */
  async buildEvmPayment(
    quote: CrossChainQuote,
    sender: Address,
    destinationSolanaWallet: string,
    memo: string
  ): Promise<EvmPaymentTransaction> {
    const params: EvmPaymentParams = {
      quote,
      agentMint: this.agentMint,
      destinationSolanaWallet,
      memo,
      sender,
    };
    return buildEvmPaymentTransaction(params, this.apiKey);
  }

  /**
   * After the user submits the bridge transaction, create a receipt
   * to track the cross-chain payment through to Solana.
   */
  createReceipt(
    bridgeTxHash: `0x${string}`,
    quote: CrossChainQuote,
    depositId: string
  ): EvmPaymentReceipt {
    return {
      txHash: bridgeTxHash,
      chainId: quote.fromChainId,
      fromAmount: quote.fromAmount,
      fromToken: quote.fromToken,
      depositId,
      estimatedArrivalAt:
        Math.floor(Date.now() / 1000) + quote.estimatedTimeSeconds,
    };
  }

  /** Poll until the payment arrives on Solana or times out. */
  async waitForArrival(
    receipt: EvmPaymentReceipt,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<CrossChainPaymentStatusResult> {
    return waitForSolanaArrival(receipt, opts);
  }

  /** Single status check without blocking. */
  async getPaymentStatus(
    depositId: string
  ): Promise<CrossChainPaymentStatusResult> {
    return getPaymentStatus(depositId);
  }

  /** Chain metadata helper. */
  getChainConfig(chainId: SupportedEvmChainId) {
    return getChain(chainId);
  }
}
