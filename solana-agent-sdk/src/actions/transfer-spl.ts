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
import { buildAndSend, type BuildAndSendOptions } from "../tx/build.js";
import type { TransactionInstruction } from "@solana/web3.js";

export interface TransferSplParams {
  mint: PublicKey | string;
  to: PublicKey | string;
  /** Amount in token base units (not human-readable) */
  amount: bigint;
}

export async function transferSpl(
  wallet: WalletProvider,
  connection: Connection,
  params: TransferSplParams,
  opts?: BuildAndSendOptions,
): Promise<string> {
  const mint = typeof params.mint === "string" ? new PublicKey(params.mint) : params.mint;
  const to = typeof params.to === "string" ? new PublicKey(params.to) : params.to;

  const mintInfo = await getMint(connection, mint);
  const instructions: TransactionInstruction[] = [];

  const senderAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const receiverAta = getAssociatedTokenAddressSync(mint, to, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const receiverInfo = await connection.getAccountInfo(receiverAta);
  if (!receiverInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        receiverAta,
        to,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  instructions.push(
    createTransferCheckedInstruction(
      senderAta,
      mint,
      receiverAta,
      wallet.publicKey,
      params.amount,
      mintInfo.decimals,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  return buildAndSend(wallet, connection, instructions, opts);
}
