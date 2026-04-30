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
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { WalletProvider } from "../wallet/types.js";
import { buildAndSend, type BuildAndSendOptions } from "../tx/build.js";

export interface TransferSplParams {
  mint: PublicKey | string;
  to: PublicKey | string;
  /** Amount in token base units (not human-readable) */
  amount: bigint;
  /** Optional symbol override for display (e.g. "USDC") */
  symbol?: string;
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
        wallet.publicKey, receiverAta, to, mint,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  instructions.push(
    createTransferCheckedInstruction(
      senderAta, mint, receiverAta, wallet.publicKey,
      params.amount, mintInfo.decimals, [], TOKEN_PROGRAM_ID,
    ),
  );

  const uiAmount = (Number(params.amount) / 10 ** mintInfo.decimals).toString();
  const symbol = params.symbol ?? mint.toBase58().slice(0, 4) + "…";
  const shortRecipient = to.toBase58().slice(0, 4) + "…" + to.toBase58().slice(-4);

  return buildAndSend(wallet, connection, instructions, {
    ...opts,
    meta: opts?.meta ?? {
      label: `Send ${uiAmount} ${symbol}`,
      description: `Transfer ${uiAmount} ${symbol} to ${shortRecipient}`,
      kind: "transfer",
      amountIn: { amount: params.amount.toString(), symbol, uiAmount },
      recipient: shortRecipient,
    },
  });
}
