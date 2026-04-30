import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface TokenAccount {
  mint: string;
  ata: string;
  amount: string;
  decimals: number;
  uiAmount: string;
}

function formatUiAmount(rawAmount: string, decimals: number): string {
  const big = BigInt(rawAmount);
  const divisor = BigInt(10 ** decimals);
  const whole = big / divisor;
  const frac = big % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export async function getTokenAccounts(
  connection: Connection,
  owner: PublicKey,
): Promise<TokenAccount[]> {
  const { value } = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID });

  return value
    .map((acc) => {
      const info = acc.account.data.parsed.info;
      const { mint, tokenAmount } = info;
      const { amount, decimals } = tokenAmount as { amount: string; decimals: number };
      return {
        mint: mint as string,
        ata: acc.pubkey.toBase58(),
        amount,
        decimals,
        uiAmount: formatUiAmount(amount, decimals),
      };
    })
    .filter((acc) => acc.amount !== "0");
}
