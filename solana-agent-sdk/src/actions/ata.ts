import {
  PublicKey,
  type Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { WalletProvider } from "../wallet/types.js";
import { buildAndSend, type BuildAndSendOptions } from "../tx/build.js";

export interface GetOrCreateAtaParams {
  mint: PublicKey | string;
  owner?: PublicKey | string;
}

export interface GetOrCreateAtaResult {
  ata: PublicKey;
  /** Defined if a create transaction was sent; undefined if ATA already existed */
  signature?: string;
}

export async function getOrCreateAta(
  wallet: WalletProvider,
  connection: Connection,
  params: GetOrCreateAtaParams,
  opts?: BuildAndSendOptions,
): Promise<GetOrCreateAtaResult> {
  const mint = typeof params.mint === "string" ? new PublicKey(params.mint) : params.mint;
  const owner = params.owner
    ? typeof params.owner === "string"
      ? new PublicKey(params.owner)
      : params.owner
    : wallet.publicKey;

  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const info = await connection.getAccountInfo(ata);
  if (info) return { ata };

  const ix = createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    ata,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const signature = await buildAndSend(wallet, connection, [ix], opts);
  return { ata, signature };
}
