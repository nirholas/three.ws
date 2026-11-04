import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { resolveTokenProgramId } from "../utils/token-program.js";
import { toUiAmount } from "../utils/format.js";
import { MintNotFoundError } from "../errors.js";

export interface TokenBalanceResult {
  mint: string;
  /** Raw balance in base units. */
  amount: string;
  decimals: number;
  /** Exact decimal string (no floating-point rounding). */
  uiAmount: string;
  /** The owner's associated token account the balance was read from. */
  ata: string;
  /** Owning token program: SPL Token or Token-2022. */
  programId: string;
}

/**
 * Read `owner`'s balance of `mint` from its associated token account.
 *
 * Works for SPL Token and Token-2022 mints (including $THREE) and for owners
 * that are PDAs. Returns null when the mint does not exist or the owner has no
 * associated token account for it. RPC failures (rate limits, outages) reject
 * rather than masquerading as "no balance".
 */
export async function getTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey | string,
): Promise<TokenBalanceResult | null> {
  const mintPk = typeof mint === "string" ? new PublicKey(mint) : mint;

  let programId: PublicKey;
  try {
    programId = await resolveTokenProgramId(connection, mintPk);
  } catch (err) {
    if (err instanceof MintNotFoundError) return null;
    throw err;
  }

  const ata = getAssociatedTokenAddressSync(mintPk, owner, true, programId, ASSOCIATED_TOKEN_PROGRAM_ID);

  let amount: string;
  let decimals: number;
  try {
    ({ amount, decimals } = (await connection.getTokenAccountBalance(ata)).value);
  } catch (err) {
    if (isMissingAccount(err)) return null;
    throw err;
  }

  return {
    mint: mintPk.toBase58(),
    amount,
    decimals,
    uiAmount: toUiAmount(amount, decimals),
    ata: ata.toBase58(),
    programId: programId.toBase58(),
  };
}

/** The RPC answers getTokenAccountBalance for a nonexistent account with "could not find account". */
function isMissingAccount(err: unknown): boolean {
  return err instanceof Error && /could not find account/i.test(err.message);
}
