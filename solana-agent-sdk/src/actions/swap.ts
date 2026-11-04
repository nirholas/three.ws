import {
  PublicKey,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { isMetaAware, type WalletProvider } from "../wallet/types.js";
import { SwapError } from "../errors.js";
import { toUiAmount } from "../utils/format.js";
import { assertSwapMatchesQuote } from "./swap-guard.js";
import { resolveTokenProgramId } from "../utils/token-program.js";

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
  /** Last block height at which the swap transaction's blockhash is valid. */
  lastValidBlockHeight?: number;
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
    const [inDecimals, outDecimals] = await Promise.all([
      fetchDecimals(connection, inputMint),
      fetchDecimals(connection, outputMint),
    ]);
    const inSymbol = params.inputSymbol ?? shortMint(inputMint);
    const outSymbol = params.outputSymbol ?? shortMint(outputMint);
    const inUi = toUiAmount(quote.inAmount, inDecimals);
    const outUi = toUiAmount(quote.outAmount, outDecimals);

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
    throw new SwapError(`Jupiter swap failed: ${await swapRes.text()}`, inputMint, outputMint);
  }

  const { swapTransaction, lastValidBlockHeight } = (await swapRes.json()) as JupiterSwapResponse;
  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapTransaction, "base64"),
  );

  // The quote is what the user approved; the returned tx is what actually gets
  // broadcast. Verify the tx spends no more than the quoted input from the
  // wallet and credits the output mint back to the wallet before signing.
  await assertSwapMatchesQuote(connection, tx, {
    inputMint,
    outputMint,
    maxInAmount: BigInt(quote.inAmount),
    owner: wallet.publicKey,
  });

  // A versioned transaction carries no expiry height of its own, so Jupiter's
  // is what lets confirmation stop at blockhash expiry instead of the timeout.
  return wallet.signAndSendTransaction(
    tx,
    connection,
    typeof lastValidBlockHeight === "number" ? { lastValidBlockHeight } : {},
  );
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
  if (!res.ok) throw new SwapError(`Jupiter quote failed: ${await res.text()}`, inputMint, outputMint);
  return res.json() as Promise<JupiterQuote>;
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function shortMint(mint: string): string {
  if (mint === SOL_MINT) return "SOL";
  return mint.slice(0, 4) + "…";
}

const decimalsCache = new Map<string, number>();

/**
 * Read a mint's decimals from chain under whichever token program owns it.
 *
 * There is deliberately no guessed fallback: the result sizes the amounts shown
 * in the wallet's approval prompt, and a wrong guess (6 for a 9-decimal mint)
 * misstates the swap by orders of magnitude. If the mint cannot be read, the
 * swap's own RPC calls moments later would not succeed either, so failing here
 * costs nothing and keeps a wrong figure out of the signing prompt.
 *
 * @throws MintNotFoundError / NotATokenMintError from resolveTokenProgramId.
 */
async function fetchDecimals(connection: Connection, mint: string): Promise<number> {
  if (mint === SOL_MINT) return 9;
  const cached = decimalsCache.get(mint);
  if (cached !== undefined) return cached;
  const key = new PublicKey(mint);
  const programId = await resolveTokenProgramId(connection, key);
  const info = await getMint(connection, key, "confirmed", programId);
  decimalsCache.set(mint, info.decimals);
  return info.decimals;
}
