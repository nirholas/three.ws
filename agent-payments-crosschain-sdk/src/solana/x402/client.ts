/**
 * x402 v2 Client – automatic 402 handling
 *
 * A fetch wrapper that intercepts HTTP 402 responses, builds and signs
 * a payment transaction matching the server's PaymentRequirements, and
 * retries the request with a PAYMENT-SIGNATURE header.
 *
 * Supports both "pump-agent" (Pump Agent invoice) and "exact" (SPL
 * TransferChecked) schemes.
 */

import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  getMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PumpAgentOffline } from "../PumpAgentOffline";
import {
  encodePaymentPayload,
  getPaymentRequiredFromResponse,
} from "./headers";
import type {
  X402ClientConfig,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  PumpAgentPaymentRequirements,
  ExactPaymentRequirements,
} from "./types";
import {
  X402_HEADER_PAYMENT_SIGNATURE,
  X402_VERSION,
  SOLANA_MAINNET,
} from "./types";

// ─── Client-side x402 fetch wrapper ─────────────────────────────────────────

/**
 * Create a fetch function that automatically handles HTTP 402 responses
 * by building a payment transaction, signing, sending, and retrying
 * the original request with payment proof in the PAYMENT-SIGNATURE header.
 *
 * @example
 * ```ts
 * import { createX402Fetch } from "@pump-fun/agent-payments-sdk/x402";
 *
 * const x402fetch = createX402Fetch({
 *   payer: wallet.publicKey.toBase58(),
 *   signTransaction: async (txBase64) => {
 *     const tx = Transaction.from(Buffer.from(txBase64, "base64"));
 *     const signed = await wallet.signTransaction(tx);
 *     return Buffer.from(signed.serialize()).toString("base64");
 *   },
 *   sendTransaction: async (signedTxBase64) => {
 *     const raw = Buffer.from(signedTxBase64, "base64");
 *     const sig = await connection.sendRawTransaction(raw);
 *     await connection.confirmTransaction(sig, "confirmed");
 *     return sig;
 *   },
 * });
 *
 * const res = await x402fetch("https://api.agent.example/inference", {
 *   method: "POST",
 *   body: JSON.stringify({ prompt: "Hello" }),
 * });
 * ```
 */
export function createX402Fetch(
  config: X402ClientConfig & { connection: Connection },
): typeof fetch {
  const {
    payer,
    signTransaction,
    sendTransaction,
    connection,
    network = SOLANA_MAINNET,
    confirmationTimeoutMs = 30_000,
  } = config;

  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = await fetch(input, init);

    if (response.status !== 402) return response;

    const paymentRequired = getPaymentRequiredFromResponse(response);
    if (!paymentRequired) return response;

    // Find a compatible requirement
    const accepted = selectRequirement(paymentRequired, network);
    if (!accepted) return response;

    // Build, sign, and send the payment
    const proof = await buildPaymentProof(
      accepted,
      payer,
      connection,
      signTransaction,
      sendTransaction,
      confirmationTimeoutMs,
    );

    // Build the PaymentPayload
    const paymentPayload: PaymentPayload = {
      x402Version: X402_VERSION,
      resource: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      accepted,
      payload: proof,
    };

    // Retry the original request with PAYMENT-SIGNATURE header
    const retryInit: RequestInit = { ...init };
    const headers = new Headers(retryInit.headers);
    headers.set(X402_HEADER_PAYMENT_SIGNATURE, encodePaymentPayload(paymentPayload));
    retryInit.headers = headers;

    return fetch(input, retryInit);
  };
}

// ─── Requirement Selection ──────────────────────────────────────────────────

function selectRequirement(
  paymentRequired: PaymentRequired,
  network: string,
): PaymentRequirements | null {
  // Prefer pump-agent scheme on the matching network, then fall back to exact
  return (
    paymentRequired.accepts.find(
      (r) => r.scheme === "pump-agent" && r.network === network,
    ) ??
    paymentRequired.accepts.find(
      (r) => r.scheme === "exact" && r.network === network,
    ) ??
    null
  );
}

// ─── Payment Proof Builder ──────────────────────────────────────────────────

async function buildPaymentProof(
  requirements: PaymentRequirements,
  payer: string,
  connection: Connection,
  signTransaction: (txBase64: string) => Promise<string>,
  sendTransaction: (signedTxBase64: string) => Promise<string>,
  confirmationTimeoutMs: number,
): Promise<Record<string, unknown>> {
  const scheme = requirements.scheme;
  if (scheme === "pump-agent") {
    return buildPumpAgentProof(
      requirements as PumpAgentPaymentRequirements,
      payer,
      connection,
      signTransaction,
      sendTransaction,
      confirmationTimeoutMs,
    );
  }

  if (scheme === "exact") {
    return buildExactProof(
      requirements as ExactPaymentRequirements,
      payer,
      connection,
      signTransaction,
      sendTransaction,
      confirmationTimeoutMs,
    );
  }

  throw new Error(`Unsupported scheme: ${scheme}`);
}

async function buildPumpAgentProof(
  requirements: PumpAgentPaymentRequirements,
  payer: string,
  connection: Connection,
  signTransaction: (txBase64: string) => Promise<string>,
  sendTransaction: (signedTxBase64: string) => Promise<string>,
  confirmationTimeoutMs: number,
): Promise<Record<string, unknown>> {
  const { extra } = requirements;

  const agent = new PumpAgentOffline(new PublicKey(extra.agentMint));
  const instructions = await agent.buildAcceptPaymentInstructions({
    user: new PublicKey(payer),
    currencyMint: new PublicKey(requirements.asset),
    amount: requirements.amount,
    memo: extra.memo,
    startTime: extra.startTime,
    endTime: extra.endTime,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = new PublicKey(payer);
  tx.add(...instructions);

  const txBase64 = Buffer.from(
    tx.serialize({ requireAllSignatures: false }),
  ).toString("base64");

  const signedTxBase64 = await signTransaction(txBase64);
  const signature = await sendTransaction(signedTxBase64);

  await waitForConfirmation(
    connection,
    signature,
    lastValidBlockHeight,
    confirmationTimeoutMs,
  );

  return {
    signature,
    payer,
    agentMint: extra.agentMint,
    asset: requirements.asset,
    amount: requirements.amount,
    memo: extra.memo,
    startTime: extra.startTime,
    endTime: extra.endTime,
  };
}

async function buildExactProof(
  requirements: ExactPaymentRequirements,
  payer: string,
  connection: Connection,
  signTransaction: (txBase64: string) => Promise<string>,
  sendTransaction: (signedTxBase64: string) => Promise<string>,
  confirmationTimeoutMs: number,
): Promise<Record<string, unknown>> {
  const payerPk = new PublicKey(payer);
  const mint = new PublicKey(requirements.asset);
  const payTo = new PublicKey(requirements.payTo);
  const amount = BigInt(requirements.amount);

  const mintInfo = await getMint(connection, mint);
  const senderAta = getAssociatedTokenAddressSync(mint, payerPk, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const receiverAta = getAssociatedTokenAddressSync(mint, payTo, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payerPk;

  const receiverInfo = await connection.getAccountInfo(receiverAta);
  if (!receiverInfo) {
    tx.add(createAssociatedTokenAccountInstruction(
      payerPk, receiverAta, payTo, mint,
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    ));
  }

  tx.add(createTransferCheckedInstruction(
    senderAta, mint, receiverAta, payerPk,
    amount, mintInfo.decimals, [], TOKEN_PROGRAM_ID,
  ));

  const txBase64 = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64");
  const signedTxBase64 = await signTransaction(txBase64);
  const signature = await sendTransaction(signedTxBase64);

  await waitForConfirmation(connection, signature, lastValidBlockHeight, confirmationTimeoutMs);

  return { signature, network: requirements.network };
}

// ─── Confirmation Helper ────────────────────────────────────────────────────

async function waitForConfirmation(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await connection.getSignatureStatus(signature);
    const value = status?.value;
    if (
      value?.confirmationStatus === "confirmed" ||
      value?.confirmationStatus === "finalized"
    ) {
      if (value.err)
        throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);
      return;
    }
    const blockHeight = await connection.getBlockHeight();
    if (blockHeight > lastValidBlockHeight) {
      throw new Error("Transaction expired (blockhash no longer valid)");
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error("Transaction confirmation timed out");
}
