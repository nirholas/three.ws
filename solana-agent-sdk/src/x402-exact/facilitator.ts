/**
 * x402 "exact" scheme facilitator — server-side verify + settle.
 *
 * Verify: confirms the tx exists and contains a TransferChecked with the
 *         correct mint, amount, and recipient.
 * Settle: waits for the tx to reach "finalized" confirmation.
 *
 * Uses a short-lived in-memory cache to deduplicate replayed signatures.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type {
  ExactPaymentRequirements,
  ExactPaymentProof,
  VerifyResponse,
  SettleResponse,
} from "./types.js";

interface CacheEntry {
  result: SettleResponse;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

export class ExactFacilitator {
  private readonly connection: Connection;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  async verify(
    proof: ExactPaymentProof,
    requirements: ExactPaymentRequirements,
  ): Promise<VerifyResponse> {
    const { signature } = proof;

    const tx = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!tx) {
      return { isValid: false, invalidReason: "Transaction not found or not yet confirmed" };
    }

    if (tx.meta?.err) {
      return { isValid: false, invalidReason: "Transaction failed on-chain" };
    }

    const transfer = findTransferChecked(tx, requirements);
    if (!transfer.found) {
      return { isValid: false, invalidReason: transfer.reason };
    }

    return { isValid: true, payer: transfer.payer };
  }

  async settle(
    proof: ExactPaymentProof,
    requirements: ExactPaymentRequirements,
  ): Promise<SettleResponse> {
    const { signature } = proof;

    const cached = this.cache.get(signature);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const deadline = Date.now() + (requirements.maxTimeoutSeconds ?? 30) * 1000;

    while (Date.now() < deadline) {
      const status = await this.connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });

      const confirmations = status.value?.confirmationStatus;
      if (confirmations === "finalized" || confirmations === "confirmed") {
        if (status.value?.err) {
          return { success: false, errorReason: "Transaction failed on-chain" };
        }

        const verify = await this.verify(proof, requirements);
        if (!verify.isValid) {
          return { success: false, errorReason: verify.invalidReason };
        }

        const result: SettleResponse = {
          success: true,
          transaction: signature,
          network: requirements.network,
          payer: verify.payer,
        };

        this.cache.set(signature, { result, expiresAt: Date.now() + CACHE_TTL_MS });
        pruneCache(this.cache);
        return result;
      }

      await sleep(1_500);
    }

    return { success: false, errorReason: "Settlement timed out waiting for confirmation" };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ParsedInstruction {
  program: string;
  parsed?: {
    type: string;
    info?: {
      source?: string;
      destination?: string;
      mint?: string;
      authority?: string;
      tokenAmount?: { amount: string; decimals: number };
    };
  };
}

function findTransferChecked(
  tx: Awaited<ReturnType<Connection["getParsedTransaction"]>>,
  req: ExactPaymentRequirements,
): { found: true; payer: string } | { found: false; reason: string } {
  const instructions =
    tx?.transaction.message.instructions as ParsedInstruction[] | undefined;
  if (!instructions) return { found: false, reason: "No instructions in transaction" };

  const receiverAta = deriveAta(new PublicKey(req.payTo), new PublicKey(req.asset));

  for (const ix of instructions) {
    if (ix.program !== "spl-token") continue;
    const { type, info } = ix.parsed ?? {};
    if (type !== "transferChecked" || !info) continue;

    if (info.mint !== req.asset) continue;
    if (info.destination !== receiverAta.toBase58()) continue;
    if (info.tokenAmount?.amount !== req.amount) continue;

    return { found: true, payer: info.authority ?? info.source ?? "" };
  }

  return {
    found: false,
    reason: `No matching transferChecked to ${req.payTo} for ${req.amount} of ${req.asset}`,
  };
}

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

function pruneCache(cache: Map<string, CacheEntry>): void {
  if (cache.size < 1_000) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt < now) cache.delete(key);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
