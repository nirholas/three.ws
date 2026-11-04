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
import { buildAndSend, type BuildAndSendOptions } from "../tx/build.js";
import { MissingTokenAccountError } from "../errors.js";
import { toUiAmount } from "../utils/format.js";
import { resolveTokenProgramId } from "../utils/token-program.js";

export interface TransferSplParams {
  mint: PublicKey | string;
  to: PublicKey | string;
  /** Amount in token base units (not human-readable) */
  amount: bigint;
  /** Optional symbol override for display (e.g. "USDC") */
  symbol?: string;
  memo?: string;
}

export async function transferSpl(
  wallet: WalletProvider,
  connection: Connection,
  params: TransferSplParams,
  opts?: BuildAndSendOptions,
): Promise<string> {
  const mint = typeof params.mint === "string" ? new PublicKey(params.mint) : params.mint;
  const to = typeof params.to === "string" ? new PublicKey(params.to) : params.to;

  // Resolve classic SPL vs Token-2022 from the mint owner so $THREE and other
  // Token-2022 mints get the correct ATA derivation and program, not the
  // classic-only default, which derives the wrong address and fails.
  const tokenProgramId = await resolveTokenProgramId(connection, mint);
  const mintInfo = await getMint(connection, mint, undefined, tokenProgramId);
  const instructions: TransactionInstruction[] = [];

  const senderAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
  // The recipient may be a program-derived address (an escrow, vault or
  // multisig), which is off-curve. Its ATA derives the same way; only the
  // on-curve guard has to be lifted.
  const receiverAta = getAssociatedTokenAddressSync(mint, to, true, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);

  const [senderInfo, receiverInfo] = await Promise.all([
    connection.getAccountInfo(senderAta),
    connection.getAccountInfo(receiverAta),
  ]);
  if (!senderInfo) {
    throw new MissingTokenAccountError(mint.toBase58(), wallet.publicKey.toBase58());
  }

  if (!receiverInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey, receiverAta, to, mint,
        tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  instructions.push(
    createTransferCheckedInstruction(
      senderAta, mint, receiverAta, wallet.publicKey,
      params.amount, mintInfo.decimals, [], tokenProgramId,
    ),
  );

  const uiAmount = toUiAmount(params.amount.toString(), mintInfo.decimals);
  const symbol = params.symbol ?? mint.toBase58().slice(0, 4) + "…";
  const shortRecipient = to.toBase58().slice(0, 4) + "…" + to.toBase58().slice(-4);

  return buildAndSend(wallet, connection, instructions, {
    ...opts,
    memo: params.memo ?? opts?.memo,
    meta: opts?.meta ?? {
      label: `Send ${uiAmount} ${symbol}`,
      description: `Transfer ${uiAmount} ${symbol} to ${shortRecipient}`,
      kind: "transfer",
      amountIn: { amount: params.amount.toString(), symbol, uiAmount },
      recipient: shortRecipient,
    },
  });
}
