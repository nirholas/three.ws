import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import type { WalletProvider } from "../wallet/types.js";
import { buildAndSend, type BuildAndSendOptions } from "../tx/build.js";

export interface TransferSolParams {
  to: PublicKey | string;
  /** Amount in SOL (not lamports) */
  amount: number;
  memo?: string;
}

export async function transferSol(
  wallet: WalletProvider,
  connection: Connection,
  params: TransferSolParams,
  opts?: BuildAndSendOptions,
): Promise<string> {
  const to = typeof params.to === "string" ? new PublicKey(params.to) : params.to;
  const lamports = Math.round(params.amount * LAMPORTS_PER_SOL);
  const shortRecipient = to.toBase58().slice(0, 4) + "…" + to.toBase58().slice(-4);

  const ix = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: to,
    lamports,
  });

  return buildAndSend(wallet, connection, [ix], {
    ...opts,
    memo: params.memo ?? opts?.memo,
    meta: opts?.meta ?? {
      label: `Send ${params.amount} SOL`,
      description: `Transfer ${params.amount} SOL to ${shortRecipient}`,
      kind: "transfer",
      amountIn: { amount: lamports.toString(), symbol: "SOL", uiAmount: params.amount.toString() },
      recipient: shortRecipient,
    },
  });
}
