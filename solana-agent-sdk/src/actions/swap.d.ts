import { PublicKey, type Connection } from "@solana/web3.js";
import { type WalletProvider } from "../wallet/types.js";
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
export declare const SOL_MINT = "So11111111111111111111111111111111111111112";
export interface JupiterQuote {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: string;
    [key: string]: unknown;
}
export declare function jupiterSwap(wallet: WalletProvider, connection: Connection, params: SwapParams): Promise<string>;
export declare function getSwapQuote(params: SwapParams): Promise<JupiterQuote>;
//# sourceMappingURL=swap.d.ts.map