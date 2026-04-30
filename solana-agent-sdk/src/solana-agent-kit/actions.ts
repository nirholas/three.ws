import { z } from "zod";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { transferSol } from "../actions/transfer-sol.js";
import { transferSpl } from "../actions/transfer-spl.js";
import { jupiterSwap, getSwapQuote } from "../actions/swap.js";
import { getOrCreateAta } from "../actions/ata.js";
import type { Action } from "./types.js";

// ─── Transfer SOL ─────────────────────────────────────────────────────────────

export const transferSolAction: Action = {
  name: "transfer_sol",
  similes: [
    "send SOL",
    "transfer SOL",
    "pay in SOL",
    "send native SOL",
    "move SOL to address",
  ],
  description:
    "Transfer native SOL to a recipient wallet. Amount is specified in SOL (not lamports). " +
    "Automatically estimates priority fees and compute units for fast confirmation.",
  examples: [
    [
      {
        input: { to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "0.5" },
        output: { signature: "5K4b...txSig" },
        explanation: "Send 0.5 SOL to the given address.",
      },
    ],
  ],
  schema: z.object({
    to: z.string().describe("Recipient wallet address (base58)"),
    amount: z.number().positive().describe("Amount in SOL (e.g. 0.5 for 0.5 SOL)"),
  }),
  handler: async (agent, input) => {
    const signature = await transferSol(agent.wallet, agent.connection, {
      to: new PublicKey(input.to as string),
      amount: input.amount as number,
    });
    return { signature };
  },
};

// ─── Transfer SPL ─────────────────────────────────────────────────────────────

export const transferSplAction: Action = {
  name: "transfer_spl",
  similes: [
    "send tokens",
    "transfer SPL token",
    "send USDC",
    "send token to wallet",
    "transfer fungible token",
  ],
  description:
    "Transfer SPL tokens to a recipient. Amount is in base units (smallest denomination). " +
    "Creates the recipient's associated token account if it does not exist.",
  examples: [
    [
      {
        input: {
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          amount: "1000000",
        },
        output: { signature: "5K4b...txSig" },
        explanation: "Send 1 USDC (6 decimals → 1000000 base units) to the address.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("SPL token mint address (base58)"),
    to: z.string().describe("Recipient wallet address (base58)"),
    amount: z.string().describe("Amount in token base units (e.g. '1000000' for 1 USDC)"),
  }),
  handler: async (agent, input) => {
    const signature = await transferSpl(agent.wallet, agent.connection, {
      mint: new PublicKey(input.mint as string),
      to: new PublicKey(input.to as string),
      amount: BigInt(input.amount as string),
    });
    return { signature };
  },
};

// ─── Swap ─────────────────────────────────────────────────────────────────────

export const swapAction: Action = {
  name: "swap_tokens",
  similes: [
    "swap tokens",
    "exchange tokens",
    "buy token",
    "sell token",
    "trade on Jupiter",
    "swap SOL for USDC",
    "convert token",
  ],
  description:
    "Swap one SPL token for another using Jupiter aggregator. Finds the best route across " +
    "all major Solana DEXes. Use So11111111111111111111111111111111111111112 for native SOL.",
  examples: [
    [
      {
        input: {
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: "100000000",
          slippageBps: "50",
        },
        output: { signature: "3Yp7...txSig" },
        explanation: "Swap 0.1 SOL for USDC with 0.5% slippage.",
      },
    ],
  ],
  schema: z.object({
    inputMint: z.string().describe("Input token mint address. Use So11111111111111111111111111111111111111112 for SOL."),
    outputMint: z.string().describe("Output token mint address"),
    amount: z.string().describe("Input amount in base units"),
    slippageBps: z.number().int().min(0).max(10000).optional().describe("Slippage tolerance in basis points (default 50 = 0.5%)"),
  }),
  handler: async (agent, input) => {
    const signature = await jupiterSwap(agent.wallet, agent.connection, {
      inputMint: input.inputMint as string,
      outputMint: input.outputMint as string,
      amount: BigInt(input.amount as string),
      slippageBps: input.slippageBps as number | undefined,
    });
    return { signature };
  },
};

// ─── Get Quote ────────────────────────────────────────────────────────────────

export const getSwapQuoteAction: Action = {
  name: "get_swap_quote",
  similes: [
    "get swap quote",
    "check token price",
    "how much will I get",
    "quote swap",
    "estimate swap output",
  ],
  description:
    "Get a Jupiter swap quote without executing. Returns the expected output amount, " +
    "price impact, and best route. Useful before committing to a swap.",
  examples: [
    [
      {
        input: {
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: "1000000000",
        },
        output: { inAmount: "1000000000", outAmount: "145230000", priceImpactPct: "0.01" },
        explanation: "Get a quote for swapping 1 SOL to USDC.",
      },
    ],
  ],
  schema: z.object({
    inputMint: z.string().describe("Input token mint address"),
    outputMint: z.string().describe("Output token mint address"),
    amount: z.string().describe("Input amount in base units"),
    slippageBps: z.number().int().optional().describe("Slippage in basis points"),
  }),
  handler: async (_agent, input) => {
    const quote = await getSwapQuote({
      inputMint: input.inputMint as string,
      outputMint: input.outputMint as string,
      amount: BigInt(input.amount as string),
      slippageBps: input.slippageBps as number | undefined,
    });
    return {
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      priceImpactPct: quote.priceImpactPct,
    };
  },
};

// ─── Get Balance ──────────────────────────────────────────────────────────────

export const getBalanceAction: Action = {
  name: "get_sol_balance",
  similes: [
    "get balance",
    "check wallet balance",
    "how much SOL do I have",
    "wallet SOL amount",
  ],
  description: "Get the current native SOL balance of the agent wallet in both lamports and SOL.",
  examples: [
    [
      {
        input: {},
        output: { lamports: "2500000000", sol: "2.5" },
        explanation: "Fetch the agent's SOL balance.",
      },
    ],
  ],
  schema: z.object({
    address: z.string().optional().describe("Address to check. Defaults to agent wallet."),
  }),
  handler: async (agent, input) => {
    const pk = input.address ? new PublicKey(input.address as string) : agent.publicKey;
    const lamports = await agent.connection.getBalance(pk);
    return { lamports: lamports.toString(), sol: (lamports / LAMPORTS_PER_SOL).toString() };
  },
};

// ─── Create ATA ───────────────────────────────────────────────────────────────

export const createAtaAction: Action = {
  name: "create_token_account",
  similes: [
    "create token account",
    "create ATA",
    "initialize token account",
    "create associated token account",
  ],
  description:
    "Create an associated token account (ATA) for a given mint and owner. " +
    "No-ops if the account already exists. Returns the ATA address.",
  examples: [
    [
      {
        input: {
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        },
        output: { ata: "HN7c...ata", created: "true" },
        explanation: "Create a USDC token account for the agent wallet.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address"),
    owner: z.string().optional().describe("Owner address. Defaults to agent wallet."),
  }),
  handler: async (agent, input) => {
    const result = await getOrCreateAta(agent.wallet, agent.connection, {
      mint: input.mint as string,
      owner: input.owner as string | undefined,
    });
    return {
      ata: result.ata.toBase58(),
      created: result.signature !== undefined,
      signature: result.signature ?? null,
    };
  },
};

export const allActions: Action[] = [
  transferSolAction,
  transferSplAction,
  swapAction,
  getSwapQuoteAction,
  getBalanceAction,
  createAtaAction,
];
