import {
  PublicKey,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import type { WalletProvider } from "../wallet/types.js";

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

  const quoteUrl = new URL(`${JUPITER_QUOTE_API}/quote`);
  quoteUrl.searchParams.set("inputMint", inputMint);
  quoteUrl.searchParams.set("outputMint", outputMint);
  quoteUrl.searchParams.set("amount", params.amount.toString());
  quoteUrl.searchParams.set("slippageBps", slippageBps.toString());

  const quoteRes = await fetch(quoteUrl.toString());
  if (!quoteRes.ok) {
    throw new Error(`Jupiter quote failed: ${await quoteRes.text()}`);
  }
  const quote = (await quoteRes.json()) as JupiterQuote;

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
