import {
  PublicKey,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { isMetaAware, type WalletProvider } from "../wallet/types.js";

const JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6";

export interface SwapParams {
  /** Input token mint (use SOL_MINT for native SOL) */
  inputMint: PublicKey | string;
  /** Output token mint */
  outputMint: PublicKey | string;
  /** Amount in input token base units */
  amount: bigint;
  /** Slippage in basis points (default 50 = 0.5%) */
  slippageBps?: number;
  /** Symbol overrides for metadata display */
  inputSymbol?: string;
  outputSymbol?: string;
}

/** Native SOL wrapped mint address */
export const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  [key: string]: unknown;
}

interface JupiterSwapResponse {
  swapTransaction: string;
}

export async function jupiterSwap(
  wallet: WalletProvider,
  connection: Connection,
  params: SwapParams,
): Promise<string> {
  const inputMint =
    typeof params.inputMint === "string" ? params.inputMint : params.inputMint.toBase58();
  const outputMint =
    typeof params.outputMint === "string" ? params.outputMint : params.outputMint.toBase58();
  const slippageBps = params.slippageBps ?? 50;

  const quote = await getSwapQuote({ ...params, inputMint, outputMint });

  // Build human-readable metadata from the quote
  if (isMetaAware(wallet)) {
    const inDecimals = guessDecimals(inputMint);
    const outDecimals = guessDecimals(outputMint);
    const inSymbol = params.inputSymbol ?? shortMint(inputMint);
    const outSymbol = params.outputSymbol ?? shortMint(outputMint);
    const inUi = (Number(quote.inAmount) / 10 ** inDecimals).toFixed(4);
    const outUi = (Number(quote.outAmount) / 10 ** outDecimals).toFixed(4);

    wallet.setNextMeta({
      label: `Swap ${inSymbol} → ${outSymbol}`,
      description: `Swap ${inUi} ${inSymbol} for ~${outUi} ${outSymbol} via Jupiter (${slippageBps / 100}% slippage)`,
      kind: "swap",
      amountIn: { amount: quote.inAmount, symbol: inSymbol, uiAmount: inUi },
      amountOut: { amount: quote.outAmount, symbol: outSymbol, uiAmount: outUi },
    });
  }

  const swapRes = await fetch(`${JUPITER_QUOTE_API}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!swapRes.ok) {
    throw new Error(`Jupiter swap failed: ${await swapRes.text()}`);
  }

  const { swapTransaction } = (await swapRes.json()) as JupiterSwapResponse;
  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapTransaction, "base64"),
  );

  return wallet.signAndSendTransaction(tx, connection);
}

export async function getSwapQuote(params: SwapParams): Promise<JupiterQuote> {
  const inputMint =
    typeof params.inputMint === "string" ? params.inputMint : params.inputMint.toBase58();
  const outputMint =
    typeof params.outputMint === "string" ? params.outputMint : params.outputMint.toBase58();

  const url = new URL(`${JUPITER_QUOTE_API}/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("slippageBps", (params.slippageBps ?? 50).toString());

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Jupiter quote failed: ${await res.text()}`);
  return res.json() as Promise<JupiterQuote>;
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function shortMint(mint: string): string {
  if (mint === SOL_MINT) return "SOL";
  return mint.slice(0, 4) + "…";
}

/** Best-effort decimal guess for well-known mints; falls back to 9 (SOL default). */
function guessDecimals(mint: string): number {
  const KNOWN: Record<string, number> = {
    [SOL_MINT]: 9,
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 6, // USDC mainnet
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": 6, // USDC devnet
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": 6, // USDT mainnet
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": 9, // mSOL
  };
  return KNOWN[mint] ?? 9;
}
