import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface TokenBalanceResult {
  mint: string;
  amount: string;
  decimals: number;
  uiAmount: string;
  ata: string;
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

export async function getTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey | string,
): Promise<TokenBalanceResult | null> {
  const mintPk = typeof mint === "string" ? new PublicKey(mint) : mint;
  const ata = getAssociatedTokenAddressSync(mintPk, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  try {
    const balance = await connection.getTokenAccountBalance(ata);
    const { amount, decimals } = balance.value;
    return {
      mint: mintPk.toBase58(),
      amount,
      decimals,
      uiAmount: formatUiAmount(amount, decimals),
      ata: ata.toBase58(),
    };
  } catch {
    return null;
  }
}
