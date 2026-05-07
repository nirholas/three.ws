import { z } from "zod";
import {
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import { NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { PumpAgent } from "../PumpAgent";
import { PumpAgentOffline } from "../PumpAgentOffline";
import type { Action, SolanaAgentKitLike } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pk(value: string): PublicKey {
  return new PublicKey(value);
}

function serializeIx(ix: TransactionInstruction) {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data).toString("base64"),
  };
}

function agent(kit: SolanaAgentKitLike, mint: string): PumpAgent {
  return new PumpAgent(pk(mint), "mainnet", kit.connection);
}

// ─── Action definitions ───────────────────────────────────────────────────────

export const createAgentPaymentsAction: Action = {
  name: "pump_agent_create",
  similes: [
    "initialize agent payments",
    "set up agent monetization",
    "create tokenized agent payment config",
    "enable payments for my agent",
  ],
  description:
    "Initialize the on-chain Agent Payments configuration for a Pump Fun token. " +
    "This must be called once by the token's bonding-curve creator before the agent " +
    "can accept payments. Sets the agent authority and buyback basis points.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          buybackBps: "500",
        },
        output: {
          status: "success",
          signature: "5K4b...txSig",
        },
        explanation:
          "Initialize agent payments for the given token with 5% buyback.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address"),
    agentAuthority: z
      .string()
      .optional()
      .describe(
        "Public key of the agent authority. Defaults to the agent wallet.",
      ),
    buybackBps: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .describe("Buyback basis points (0–10000, e.g. 500 = 5%)"),
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const authority = kit.wallet_address;
    const agentAuthority = input.agentAuthority
      ? pk(input.agentAuthority)
      : kit.wallet_address;

    const ix = await pumpAgent.create({
      authority,
      mint: pk(input.mint),
      agentAuthority,
      buybackBps: input.buybackBps,
    });

    return { instruction: serializeIx(ix) };
  },
};

export const buildPaymentInstructionsAction: Action = {
  name: "pump_agent_build_payment_instructions",
  similes: [
    "build payment instructions",
    "create payment transaction",
    "generate agent payment",
    "prepare agent payment",
    "build agent invoice",
  ],
  description:
    "Build the accept-payment instructions for a tokenized agent. Returns serialized " +
    "instructions that the payer must sign — does NOT auto-submit. Handles native SOL " +
    "wrapping automatically when paying in SOL.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          user: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          amount: "1000000",
          memo: "1",
        },
        output: {
          instructions: "[...serialized instructions]",
        },
        explanation:
          "Build payment instructions for 0.001 SOL to the agent with memo 1.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent to pay"),
    user: z.string().describe("Public key of the payer"),
    currencyMint: z
      .string()
      .optional()
      .describe("Currency mint to pay in. Defaults to native SOL (wrapped)."),
    amount: z.string().describe("Payment amount in the currency's smallest unit"),
    memo: z.string().default("0").describe("Invoice memo / identifier"),
    startTime: z
      .string()
      .default("0")
      .describe("Invoice start time (unix seconds). Defaults to 0."),
    endTime: z
      .string()
      .default("0")
      .describe("Invoice end time (unix seconds). Defaults to 0."),
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const currencyMint = input.currencyMint
      ? pk(input.currencyMint)
      : NATIVE_MINT;

    const ixs = await pumpAgent.buildAcceptPaymentInstructions({
      user: pk(input.user),
      currencyMint,
      amount: input.amount,
      memo: input.memo,
      startTime: input.startTime,
      endTime: input.endTime,
    });

    return { instructions: ixs.map(serializeIx) };
  },
};

export const getBalancesAction: Action = {
  name: "pump_agent_get_balances",
  similes: [
    "check agent balances",
    "get agent earnings",
    "view agent vault balances",
    "how much has the agent earned",
  ],
  description:
    "Fetch the current balances across all three agent vaults (payment, buyback, " +
    "withdraw) for a given currency. Returns vault addresses and token balances.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
        },
        output: {
          paymentVault: '{"address":"...","balance":"500000"}',
          buybackVault: '{"address":"...","balance":"100000"}',
          withdrawVault: '{"address":"...","balance":"400000"}',
        },
        explanation: "Check SOL balances across all vaults for the agent.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    currencyMint: z
      .string()
      .optional()
      .describe("Currency mint to check balances for. Defaults to native SOL."),
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);
    const currencyMint = input.currencyMint
      ? pk(input.currencyMint)
      : NATIVE_MINT;

    const balances = await pumpAgent.getBalances(currencyMint);

    return {
      paymentVault: {
        address: balances.paymentVault.address.toBase58(),
        balance: balances.paymentVault.balance.toString(),
      },
      buybackVault: {
        address: balances.buybackVault.address.toBase58(),
        balance: balances.buybackVault.balance.toString(),
      },
      withdrawVault: {
        address: balances.withdrawVault.address.toBase58(),
        balance: balances.withdrawVault.balance.toString(),
      },
    };
  },
};

export const validateInvoiceAction: Action = {
  name: "pump_agent_validate_invoice",
  similes: [
    "verify payment",
    "check if user paid",
    "validate invoice",
    "confirm agent payment",
    "did the user pay",
  ],
  description:
    "Validate that a specific payment was made to an agent. Checks on-chain records " +
    "to confirm the invoice parameters match. Returns true if the payment is valid.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          user: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          currencyMint: "So11111111111111111111111111111111111111112",
          amount: "1000000",
          memo: "42",
          startTime: "0",
          endTime: "0",
        },
        output: {
          valid: "true",
        },
        explanation: "Validate that the user paid 0.001 SOL with memo 42.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    user: z.string().describe("Public key of the payer to validate"),
    currencyMint: z.string().describe("Currency mint used for payment"),
    amount: z.string().describe("Expected payment amount"),
    memo: z.string().describe("Expected invoice memo"),
    startTime: z.string().describe("Expected invoice start time (unix seconds)"),
    endTime: z.string().describe("Expected invoice end time (unix seconds)"),
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);

    const valid = await pumpAgent.validateInvoicePayment({
      user: pk(input.user),
      currencyMint: pk(input.currencyMint),
      amount: Number(input.amount),
      memo: Number(input.memo),
      startTime: Number(input.startTime),
      endTime: Number(input.endTime),
    });

    return { valid };
  },
};

export const distributePaymentsAction: Action = {
  name: "pump_agent_distribute_payments",
  similes: [
    "distribute agent payments",
    "split agent revenue",
    "process agent payments",
    "trigger payment distribution",
  ],
  description:
    "Distribute accumulated payments between the buyback and withdraw vaults " +
    "according to the configured buyback basis points. This is permissionless — " +
    "anyone can trigger it.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
        },
        output: {
          status: "success",
          signature: "3Yp7...txSig",
        },
        explanation: "Distribute accumulated SOL payments for the agent.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    currencyMint: z
      .string()
      .optional()
      .describe("Currency mint to distribute. Defaults to native SOL."),
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const currencyMint = input.currencyMint
      ? pk(input.currencyMint)
      : NATIVE_MINT;

    const ixs = await pumpAgent.distributePayments({
      user: kit.wallet_address,
      currencyMint,
      includeTransferExtraLamportsForNative: currencyMint.equals(NATIVE_MINT),
    });

    return { instructions: ixs.map(serializeIx) };
  },
};

export const withdrawAction: Action = {
  name: "pump_agent_withdraw",
  similes: [
    "withdraw agent earnings",
    "withdraw agent payments",
    "claim agent revenue",
    "withdraw from agent vault",
  ],
  description:
    "Withdraw accumulated earnings from the agent withdraw vault. " +
    "Must be called by the agent authority. Transfers tokens from the " +
    "withdraw vault to the specified receiver token account.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          currencyMint: "So11111111111111111111111111111111111111112",
        },
        output: {
          status: "success",
          signature: "4Rz8...txSig",
        },
        explanation: "Withdraw accumulated SOL earnings from the agent.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    currencyMint: z.string().describe("Currency mint to withdraw"),
    receiverAta: z
      .string()
      .optional()
      .describe(
        "Receiver token account. Defaults to the agent wallet's ATA for the currency.",
      ),
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const currencyMint = pk(input.currencyMint);

    const receiverAta = input.receiverAta
      ? pk(input.receiverAta)
      : getAssociatedTokenAddressSync(currencyMint, kit.wallet_address);

    const ix = await pumpAgent.withdraw({
      authority: kit.wallet_address,
      currencyMint,
      receiverAta,
    });

    return { instruction: serializeIx(ix) };
  },
};

export const getConfigAction: Action = {
  name: "pump_agent_get_config",
  similes: [
    "get agent config",
    "check agent settings",
    "view agent payment config",
    "agent payment configuration",
  ],
  description:
    "Fetch the on-chain Agent Payments configuration for a token. " +
    "Returns the agent authority, buyback basis points, and token mint.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
        },
        output: {
          authority: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          buybackBps: "500",
          mint: "So11111111111111111111111111111111111111112",
        },
        explanation: "Fetch the agent payment configuration.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);
    const config = await pumpAgent.getAgentConfig();

    return {
      authority: config.authority.toBase58(),
      buybackBps: config.buybackBps,
      mint: config.mint.toBase58(),
    };
  },
};

export const getPaymentStatsAction: Action = {
  name: "pump_agent_get_payment_stats",
  similes: [
    "get payment stats",
    "agent payment statistics",
    "how much has the agent earned",
    "payment analytics",
  ],
  description:
    "Fetch per-currency payment statistics for an agent. Returns total payments " +
    "received, total distributed to buyback, total distributed to withdraw, and " +
    "tokens burned.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          currencyMint: "So11111111111111111111111111111111111111112",
        },
        output: {
          totalPayments: "10000000",
          totalBuyback: "2000000",
          totalWithdraw: "8000000",
        },
        explanation: "Get SOL payment statistics for the agent.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    currencyMint: z.string().describe("Currency mint to get stats for"),
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);
    const stats = await pumpAgent.getPaymentStats(pk(input.currencyMint));

    // Convert all BN / bigint fields to strings for JSON serialization
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(stats as Record<string, unknown>)) {
      if (value instanceof PublicKey) {
        result[key] = value.toBase58();
      } else if (typeof value === "bigint") {
        result[key] = value.toString();
      } else if (value != null && typeof value === "object" && "toString" in value) {
        result[key] = String(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  },
};

export const updateBuybackBpsAction: Action = {
  name: "pump_agent_update_buyback_bps",
  similes: [
    "update buyback percentage",
    "change buyback bps",
    "set buyback rate",
    "modify agent buyback",
  ],
  description:
    "Update the buyback basis points for an agent's payment configuration. " +
    "Must be called by the agent authority. The new bps value determines what " +
    "percentage of future payments are allocated to token buyback and burn.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          buybackBps: "1000",
        },
        output: {
          status: "success",
          signature: "5Tz9...txSig",
        },
        explanation: "Update buyback to 10% (1000 bps) for the agent.",
      },
    ],
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    buybackBps: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .describe("New buyback basis points (0–10000, e.g. 1000 = 10%)"),
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);

    const ix = await pumpAgent.updateBuybackBps({
      authority: kit.wallet_address,
      buybackBps: input.buybackBps,
    });

    return { instruction: serializeIx(ix) };
  },
};

export const allActions: Action[] = [
  createAgentPaymentsAction,
  buildPaymentInstructionsAction,
  getBalancesAction,
  validateInvoiceAction,
  distributePaymentsAction,
  withdrawAction,
  getConfigAction,
  getPaymentStatsAction,
  updateBuybackBpsAction,
];
