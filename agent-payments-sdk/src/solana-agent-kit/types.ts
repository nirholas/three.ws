import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { z } from "zod";

/**
 * Minimal structural interface compatible with solana-agent-kit's SolanaAgentKit.
 * Uses structural typing so consumers don't need to import SolanaAgentKit directly.
 */
export interface SolanaAgentKitLike {
  connection: Connection;
  wallet: Keypair;
  wallet_address: PublicKey;
}

export type ActionHandler = (
  agent: SolanaAgentKitLike,
  input: Record<string, any>,
) => Promise<Record<string, any>>;

export interface ActionExample {
  input: Record<string, string>;
  output: Record<string, string>;
  explanation: string;
}

export interface Action {
  name: string;
  similes: string[];
  description: string;
  examples: ActionExample[][];
  schema: z.ZodType<any>;
  handler: ActionHandler;
}

export interface Plugin {
  name: string;
  methods: Record<string, Function>;
  actions: Action[];
}
