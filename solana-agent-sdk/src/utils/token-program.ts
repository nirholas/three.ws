import { PublicKey, type Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { MintNotFoundError, NotATokenMintError } from "../errors.js";

// A mint's owning program is fixed for the life of the mint, so caching by mint
// pubkey is always safe and turns a per-transfer RPC into a one-time lookup.
const programCache = new Map<string, PublicKey>();

/**
 * Resolve which SPL token program owns a mint: classic SPL Token or Token-2022.
 *
 * Any helper hardcoded to TOKEN_PROGRAM_ID derives the wrong associated-token
 * address and builds against the wrong program for a Token-2022 mint, so the
 * transfer fails (or a balance lookup misses) for tokens that genuinely exist in
 * the wallet, including $THREE, which is a Token-2022 mint. The mint account's
 * owner is the canonical, on-chain way to tell the two programs apart. The result
 * is memoized for the process, so repeated transfers of the same mint hit RPC once.
 *
 * @throws MintNotFoundError if the mint account doesn't exist (not cached, so a
 *   mint created later resolves on the next call).
 * @throws NotATokenMintError if the account isn't owned by either SPL program.
 */
export async function resolveTokenProgramId(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const key = mint.toBase58();
  const cached = programCache.get(key);
  if (cached) return cached;

  const info = await connection.getAccountInfo(mint);
  if (!info) throw new MintNotFoundError(key);

  let programId: PublicKey;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) programId = TOKEN_2022_PROGRAM_ID;
  else if (info.owner.equals(TOKEN_PROGRAM_ID)) programId = TOKEN_PROGRAM_ID;
  else throw new NotATokenMintError(key, info.owner.toBase58());

  programCache.set(key, programId);
  return programId;
}
