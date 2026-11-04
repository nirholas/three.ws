import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { toUiAmount } from "../utils/format.js";

export interface TokenAccount {
  mint: string;
  ata: string;
  /** Raw balance in base units. */
  amount: string;
  decimals: number;
  /** Exact decimal string (no floating-point rounding). */
  uiAmount: string;
  /** Owning token program: SPL Token or Token-2022. */
  programId: string;
}

/**
 * List every non-empty token account `owner` holds, across both SPL Token and
 * Token-2022 (where $THREE lives). Classic accounts come first, then
 * Token-2022, each in RPC order. Rejects if either program query fails, so a
 * partial list is never mistaken for the full portfolio.
 */
export async function getTokenAccounts(
  connection: Connection,
  owner: PublicKey,
): Promise<TokenAccount[]> {
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  const responses = await Promise.all(
    programs.map((programId) => connection.getParsedTokenAccountsByOwner(owner, { programId })),
  );

  return responses.flatMap(({ value }, i) =>
    value
      .map((acc) => {
        const { mint, tokenAmount } = acc.account.data.parsed.info as {
          mint: string;
          tokenAmount: { amount: string; decimals: number };
        };
        return {
          mint,
          ata: acc.pubkey.toBase58(),
          amount: tokenAmount.amount,
          decimals: tokenAmount.decimals,
          uiAmount: toUiAmount(tokenAmount.amount, tokenAmount.decimals),
          programId: programs[i]!.toBase58(),
        };
      })
      .filter((acc) => acc.amount !== "0"),
  );
}
