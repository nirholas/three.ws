/**
 * x402 "exact" scheme facilitator: server-side challenge + verify + settle.
 *
 * Challenge: mint a single-use, server-issued nonce bound to one resource and
 *            its (asset, amount, payTo). The client must carry the nonce in the
 *            paid transaction as a memo so the payment cannot be reused for any
 *            other request.
 * Verify:    confirm the tx exists, runs on the configured cluster, carries the
 *            issued nonce memo, and contains a TransferChecked with the correct
 *            mint, amount, and recipient. Classic SPL Token and Token-2022
 *            assets (such as $THREE) are both accepted, and the payee may be
 *            a program-derived vault.
 * Settle:    wait for finalization, then atomically consume the signature in a
 *            durable store so the same on-chain payment can never settle twice.
 *
 * Replay protection is enforced by a ConsumedSignatureStore (durable in
 * multi-instance deployments), not by a TTL'd success cache.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import type {
  ExactPaymentRequirements,
  ExactPaymentProof,
  VerifyResponse,
  SettleResponse,
} from "./types.js";
import { CAIP2_BY_GENESIS_HASH, X402_NONCE_MEMO_PREFIX } from "./types.js";
import {
  InMemoryChallengeStore,
  InMemoryConsumedSignatureStore,
  type ChallengeStore,
  type ConsumedSignatureStore,
  type PaymentChallenge,
} from "./store.js";

export interface ExactFacilitatorOptions {
  /** Durable store for issued single-use challenges. Defaults to in-memory. */
  challengeStore?: ChallengeStore;
  /** Durable store for consumed signatures. Defaults to in-memory. */
  consumedStore?: ConsumedSignatureStore;
  /** Default challenge validity window in seconds (default 300). */
  challengeTtlSeconds?: number;
}

export interface IssueChallengeParams {
  resource: string;
  asset: string;
  amount: string;
  payTo: string;
  /** Override the default TTL for this challenge. */
  ttlSeconds?: number;
}

export class ExactFacilitator {
  private readonly connection: Connection;
  private readonly challengeStore: ChallengeStore;
  private readonly consumedStore: ConsumedSignatureStore;
  private readonly challengeTtlSeconds: number;
  /** Resolved once: the CAIP-2 id of the cluster this RPC serves. */
  private clusterCaip2Promise: Promise<string | null> | null = null;

  constructor(rpcUrl: string, options: ExactFacilitatorOptions = {}) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.challengeStore = options.challengeStore ?? new InMemoryChallengeStore();
    this.consumedStore = options.consumedStore ?? new InMemoryConsumedSignatureStore();
    this.challengeTtlSeconds = options.challengeTtlSeconds ?? 300;
  }

  /**
   * Mint a fresh single-use challenge for a request. Embed the returned nonce
   * in `requirements.extra.nonce`; the client must echo it back inside the tx
   * memo (see `x402NonceMemo`). Every paid request must get its own challenge.
   */
  async issueChallenge(params: IssueChallengeParams): Promise<PaymentChallenge> {
    const ttl = (params.ttlSeconds ?? this.challengeTtlSeconds) * 1000;
    const challenge: PaymentChallenge = {
      nonce: randomBytes(24).toString("base64url"),
      resource: params.resource,
      asset: params.asset,
      amount: params.amount,
      payTo: params.payTo,
      expiresAt: Date.now() + ttl,
    };
    await this.challengeStore.put(challenge);
    return challenge;
  }

  async verify(
    proof: ExactPaymentProof,
    requirements: ExactPaymentRequirements,
  ): Promise<VerifyResponse> {
    const { signature } = proof;

    // The challenge nonce binds this proof to one specific, unconsumed request.
    const nonce = extractNonce(requirements);
    if (!nonce) {
      return { isValid: false, invalidReason: "Missing challenge nonce in requirements" };
    }
    const challenge = await this.challengeStore.get(nonce);
    if (!challenge) {
      return { isValid: false, invalidReason: "Unknown or expired challenge" };
    }
    if (challenge.expiresAt < Date.now()) {
      return { isValid: false, invalidReason: "Challenge expired" };
    }
    if (
      challenge.asset !== requirements.asset ||
      challenge.amount !== requirements.amount ||
      challenge.payTo !== requirements.payTo
    ) {
      return { isValid: false, invalidReason: "Challenge does not match requirements" };
    }

    // The declared network must match the cluster this facilitator's RPC serves.
    const networkCheck = await this.assertNetworkMatches(proof, requirements);
    if (networkCheck) return networkCheck;

    // Reject any signature already consumed by a prior settle (cheap pre-check;
    // the authoritative single-use claim happens atomically in settle()).
    if (await this.consumedStore.has(signature)) {
      return { isValid: false, invalidReason: "Payment signature already consumed" };
    }

    const tx = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 1,
      commitment: "confirmed",
    });

    if (!tx) {
      return { isValid: false, invalidReason: "Transaction not found or not yet confirmed" };
    }

    if (tx.meta?.err) {
      return { isValid: false, invalidReason: "Transaction failed on-chain" };
    }

    // The tx must carry the issued nonce as a memo, proving the payer paid for
    // THIS request and not some other equivalently-priced resource.
    if (!txCarriesNonceMemo(tx, nonce)) {
      return { isValid: false, invalidReason: "Transaction does not carry the issued challenge nonce" };
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

    if (await this.consumedStore.has(signature)) {
      return { success: false, errorReason: "Payment signature already consumed" };
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

        // Atomically consume both the per-request challenge and the signature.
        // Either failing means a concurrent/prior settle already claimed it, so
        // reject rather than grant duplicate access.
        const nonce = extractNonce(requirements);
        if (!nonce || !(await this.challengeStore.consume(nonce))) {
          return { success: false, errorReason: "Challenge already consumed" };
        }
        if (!(await this.consumedStore.claim(signature, requirements.resource ?? nonce))) {
          return { success: false, errorReason: "Payment signature already consumed" };
        }

        return {
          success: true,
          transaction: signature,
          network: requirements.network,
          payer: verify.payer,
        };
      }

      await sleep(1_500);
    }

    return { success: false, errorReason: "Settlement timed out waiting for confirmation" };
  }

  /**
   * Reject when the declared requirements/proof network does not match the
   * cluster the configured RPC actually serves. Prevents satisfying a
   * mainnet-priced resource with a free devnet transfer.
   */
  private async assertNetworkMatches(
    proof: ExactPaymentProof,
    requirements: ExactPaymentRequirements,
  ): Promise<VerifyResponse | null> {
    if (proof.network !== requirements.network) {
      return { isValid: false, invalidReason: "Proof network does not match requirements network" };
    }
    const clusterCaip2 = await this.resolveClusterCaip2();
    if (!clusterCaip2) {
      return { isValid: false, invalidReason: "Unable to resolve RPC cluster identity" };
    }
    if (requirements.network !== clusterCaip2) {
      return {
        isValid: false,
        invalidReason: `Network mismatch: requirements declare ${requirements.network} but RPC serves ${clusterCaip2}`,
      };
    }
    return null;
  }

  private resolveClusterCaip2(): Promise<string | null> {
    if (!this.clusterCaip2Promise) {
      this.clusterCaip2Promise = this.connection
        .getGenesisHash()
        .then((hash) => CAIP2_BY_GENESIS_HASH[hash] ?? null)
        .catch(() => {
          // Allow a later retry rather than caching a transient RPC failure.
          this.clusterCaip2Promise = null;
          return null;
        });
    }
    return this.clusterCaip2Promise;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ParsedInstruction {
  program: string;
  programId?: { toBase58?: () => string } | string;
  parsed?:
    | {
        type: string;
        info?: {
          source?: string;
          destination?: string;
          mint?: string;
          authority?: string;
          tokenAmount?: { amount: string; decimals: number };
        };
      }
    | string;
}

function extractNonce(req: ExactPaymentRequirements): string | null {
  const nonce = req.extra?.nonce;
  return typeof nonce === "string" && nonce.length > 0 ? nonce : null;
}

function txCarriesNonceMemo(
  tx: Awaited<ReturnType<Connection["getParsedTransaction"]>>,
  nonce: string,
): boolean {
  const expected = `${X402_NONCE_MEMO_PREFIX}${nonce}`;
  const instructions = collectInstructions(tx);
  for (const ix of instructions) {
    if (ix.program !== "spl-memo") continue;
    // Parsed memo instructions expose the UTF-8 string in `parsed`.
    if (typeof ix.parsed === "string" && ix.parsed === expected) return true;
  }
  return false;
}

function collectInstructions(
  tx: Awaited<ReturnType<Connection["getParsedTransaction"]>>,
): ParsedInstruction[] {
  const top = (tx?.transaction.message.instructions as ParsedInstruction[] | undefined) ?? [];
  const inner =
    tx?.meta?.innerInstructions?.flatMap(
      (i) => i.instructions as unknown as ParsedInstruction[],
    ) ?? [];
  return [...top, ...inner];
}

interface TransferMatch {
  found: boolean;
  payer: string;
  reason: string;
}

function findTransferChecked(
  tx: Awaited<ReturnType<Connection["getParsedTransaction"]>>,
  req: ExactPaymentRequirements,
): TransferMatch {
  const instructions = collectInstructions(tx);
  if (!instructions.length) {
    return { found: false, payer: "", reason: "No instructions in transaction" };
  }

  const payTo = new PublicKey(req.payTo);
  const mint = new PublicKey(req.asset);

  for (const ix of instructions) {
    const tokenProgram = TOKEN_PROGRAMS[ix.program];
    if (!tokenProgram) continue;
    if (typeof ix.parsed !== "object" || !ix.parsed) continue;
    const { type, info } = ix.parsed;
    if (type !== "transferChecked" || !info) continue;

    if (info.mint !== req.asset) continue;
    // The payee's account under the program that actually executed the
    // transfer. A mint belongs to exactly one program, so a transfer through
    // the other one cannot have succeeded for this mint.
    if (info.destination !== deriveAta(payTo, mint, tokenProgram).toBase58()) continue;
    if (info.tokenAmount?.amount !== req.amount) continue;

    return { found: true, payer: info.authority ?? info.source ?? "", reason: "" };
  }

  return {
    found: false,
    payer: "",
    reason: `No matching transferChecked to ${req.payTo} for ${req.amount} of ${req.asset}`,
  };
}

/** Parsed-instruction program names of the two SPL token programs. */
const TOKEN_PROGRAMS: Record<string, PublicKey> = {
  "spl-token": TOKEN_PROGRAM_ID,
  "spl-token-2022": TOKEN_2022_PROGRAM_ID,
};

/** The payee's associated token account; off-curve owners (program vaults) are allowed. */
function deriveAta(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
