/**
 * x402 "exact" scheme client — SPL TransferChecked payment.
 *
 * Builds a TransferChecked transaction, signs + sends it, and returns the
 * tx signature as the proof payload for the PAYMENT-SIGNATURE header.
 *
 * Compatible with the x402 v2 spec and the PaymentPayload/PaymentRequirements
 * types from @pump-fun/agent-payments-sdk/x402.
 */
import {
  PublicKey,
  type Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { WalletProvider } from "../wallet/types.js";
import { buildAndSend } from "../tx/build.js";
import type { ExactPaymentRequirements } from "./types.js";

export interface ExactPaymentProof {
  signature: string;
  network: string;
}

/**
 * Pay using the "exact" x402 scheme.
 * Returns the proof to include in the PAYMENT-SIGNATURE header payload.
 */
export async function payExact(
  wallet: WalletProvider,
  connection: Connection,
  requirements: ExactPaymentRequirements,
): Promise<ExactPaymentProof> {
  const mint = new PublicKey(requirements.asset);
  const payTo = new PublicKey(requirements.payTo);
  const amount = BigInt(requirements.amount);

  const mintInfo = await getMint(connection, mint);
  const senderAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const receiverAta = getAssociatedTokenAddressSync(mint, payTo, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const ixs = [];

  const receiverInfo = await connection.getAccountInfo(receiverAta);
  if (!receiverInfo) {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        receiverAta,
        payTo,
        mint,
        TOKEN_PROGRAM_ID,
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
      TOKEN_PROGRAM_ID,
    ),
  );

  const signature = await buildAndSend(wallet, connection, ixs);

  return { signature, network: requirements.network };
}

/**
 * Build an x402 PaymentPayload for the "exact" scheme.
 * Pass the result to encodePaymentPayload() before attaching to PAYMENT-SIGNATURE header.
 */
export function buildExactPaymentPayload(
  requirements: ExactPaymentRequirements,
  proof: ExactPaymentProof,
  resourceUrl?: string,
) {
  return {
    x402Version: 2 as const,
    resource: resourceUrl,
    accepted: requirements,
    payload: proof,
  };
}
