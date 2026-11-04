/**
 * x402 "exact" scheme client: SPL TransferChecked payment.
 *
 * Builds a TransferChecked transaction, signs + sends it, and returns the
 * tx signature as the proof payload for the X-PAYMENT header.
 *
 * Compatible with the x402 v2 spec and the PaymentPayload/PaymentRequirements
 * types from @pump-fun/agent-payments-sdk/x402.
 */
import {
  PublicKey,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getMint,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { WalletProvider } from "../wallet/types.js";
import { buildAndSend } from "../tx/build.js";
import { memoInstruction } from "../utils/memo.js";
import { resolveTokenProgramId } from "../utils/token-program.js";
import { InvalidInputError, MissingTokenAccountError } from "../errors.js";
import type { ExactPaymentRequirements } from "./types.js";
import { x402NonceMemo } from "./types.js";

export interface ExactPaymentProof {
  /** Confirmed transaction signature (base58) */
  signature: string;
  /** CAIP-2 network identifier */
  network: string;
}

/**
 * Pay using the "exact" x402 scheme.
 * Returns the proof to include in the X-PAYMENT header payload.
 *
 * The asset may be a classic SPL Token or a Token-2022 mint (such as $THREE);
 * the owning program is read from the mint. The payee may be a wallet or a
 * program-derived vault. The payee's token account is opened when missing.
 *
 * @throws InvalidInputError when the requirements carry no challenge nonce or
 *   a non-integer amount (nothing is sent).
 * @throws MissingTokenAccountError when the wallet holds no account for the asset.
 */
export async function payExact(
  wallet: WalletProvider,
  connection: Connection,
  requirements: ExactPaymentRequirements,
): Promise<ExactPaymentProof> {
  // Bind the payment to the server-issued single-use challenge nonce by carrying
  // it as a memo. The facilitator matches this exact memo before settling, so
  // the payment cannot be replayed against any other request.
  const nonce = requirements.extra?.nonce;
  if (!nonce) {
    throw new InvalidInputError(
      "requirements.extra.nonce",
      "Exact payment requirements are missing the server-issued challenge nonce",
    );
  }
  if (!/^\d+$/.test(String(requirements.amount))) {
    throw new InvalidInputError(
      "requirements.amount",
      `Exact payment amount must be a non-negative integer in base units, got ${JSON.stringify(requirements.amount)}`,
    );
  }

  const mint = new PublicKey(requirements.asset);
  const payTo = new PublicKey(requirements.payTo);
  const amount = BigInt(requirements.amount);

  const tokenProgramId = await resolveTokenProgramId(connection, mint);
  const mintInfo = await getMint(connection, mint, undefined, tokenProgramId);
  const senderAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, true, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const receiverAta = getAssociatedTokenAddressSync(mint, payTo, true, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);

  const [senderInfo, receiverInfo] = await Promise.all([
    connection.getAccountInfo(senderAta),
    connection.getAccountInfo(receiverAta),
  ]);
  if (!senderInfo) {
    throw new MissingTokenAccountError(mint.toBase58(), wallet.publicKey.toBase58());
  }

  const ixs: TransactionInstruction[] = [];
  if (!receiverInfo) {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        receiverAta,
        payTo,
        mint,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  ixs.push(
    createTransferCheckedInstruction(
      senderAta,
      mint,
      receiverAta,
      wallet.publicKey,
      amount,
      mintInfo.decimals,
      [],
      tokenProgramId,
    ),
  );
  ixs.push(memoInstruction(x402NonceMemo(nonce)));

  const signature = await buildAndSend(wallet, connection, ixs);

  return { signature, network: requirements.network };
}

/**
 * Build an x402 PaymentPayload for the "exact" scheme.
 *
 * Pass the result to `encodePaymentPayload()` before attaching to the
 * `X-PAYMENT` request header on the retry. Top-level `scheme` and `network`
 * mirror the chosen `accepts[]` entry so the server's facilitator can route
 * the proof without re-walking the nested `accepted` object.
 */
export function buildExactPaymentPayload(
  requirements: ExactPaymentRequirements,
  proof: ExactPaymentProof,
  resourceUrl?: string,
) {
  return {
    x402Version: 2 as const,
    scheme: requirements.scheme,
    network: requirements.network,
    resource: resourceUrl,
    accepted: requirements,
    payload: proof,
  };
}
