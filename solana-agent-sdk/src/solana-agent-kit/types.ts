import type { Connection, PublicKey } from "@solana/web3.js";
import type { WalletProvider } from "../wallet/types.js";
import type { z } from "zod";

export interface SolanaAgentLike {
  connection: Connection;
  wallet: WalletProvider;
  readonly publicKey: PublicKey;
}

export type ActionHandler = (
  agent: SolanaAgentLike,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface ActionExample {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  explanation: string;
}

export interface Action {
  name: string;
  similes: string[];
  description: string;
  examples: ActionExample[][];
  schema: z.ZodType<unknown>;
  handler: ActionHandler;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Plugin {
  name: string;
  methods: Record<string, (...args: any[]) => unknown>;
  actions: Action[];
}
