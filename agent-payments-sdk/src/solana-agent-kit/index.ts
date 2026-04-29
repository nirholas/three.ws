/**
 * solana-agent-kit plugin for @pump-fun/agent-payments-sdk
 *
 * Usage with solana-agent-kit v2:
 * ```ts
 * import { SolanaAgentKit } from "solana-agent-kit";
 * import { PumpAgentPaymentsPlugin } from "@pump-fun/agent-payments-sdk/solana-agent-kit";
 *
 * const agent = new SolanaAgentKit(privateKey, rpcUrl, {});
 * agent.use(PumpAgentPaymentsPlugin);
 * ```
 */

import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { PumpAgent } from "../PumpAgent";
import { PumpAgentOffline } from "../PumpAgentOffline";
import type { Plugin, SolanaAgentKitLike } from "./types";
import { allActions } from "./actions";

// ─── Typed helper methods (programmatic API) ─────────────────────────────────

async function createAgentPayments(
  agent: SolanaAgentKitLike,
  mint: PublicKey,
  buybackBps: number,
  agentAuthority?: PublicKey,
) {
  const pump = PumpAgentOffline.load(mint, agent.connection);
  return pump.create({
    authority: agent.wallet_address,
    mint,
    agentAuthority: agentAuthority ?? agent.wallet_address,
    buybackBps,
  });
}

async function buildPayAgentInstructions(
  agent: SolanaAgentKitLike,
  mint: PublicKey,
  currencyMint: PublicKey,
  amount: string,
  memo = "0",
  startTime = "0",
  endTime = "0",
) {
  const pump = PumpAgentOffline.load(mint, agent.connection);
  return pump.buildAcceptPaymentInstructions({
    user: agent.wallet_address,
    currencyMint,
    amount,
    memo,
    startTime,
    endTime,
  });
}

async function getAgentBalances(
  agent: SolanaAgentKitLike,
  mint: PublicKey,
  currencyMint: PublicKey = NATIVE_MINT,
) {
  const pump = new PumpAgent(mint, "mainnet", agent.connection);
  return pump.getBalances(currencyMint);
}

async function validateInvoicePayment(
  agent: SolanaAgentKitLike,
  mint: PublicKey,
  user: PublicKey,
  currencyMint: PublicKey,
  amount: number,
  memo: number,
  startTime: number,
  endTime: number,
) {
  const pump = new PumpAgent(mint, "mainnet", agent.connection);
  return pump.validateInvoicePayment({
    user,
    currencyMint,
    amount,
    memo,
    startTime,
    endTime,
  });
}

async function distributeAgentPayments(
  agent: SolanaAgentKitLike,
  mint: PublicKey,
  currencyMint: PublicKey = NATIVE_MINT,
) {
  const pump = PumpAgentOffline.load(mint, agent.connection);
  return pump.distributePayments({
    user: agent.wallet_address,
    currencyMint,
    includeTransferExtraLamportsForNative: currencyMint.equals(NATIVE_MINT),
  });
}

async function withdrawAgentPayments(
  agent: SolanaAgentKitLike,
  mint: PublicKey,
  currencyMint: PublicKey,
  receiverAta?: PublicKey,
) {
  const pump = PumpAgentOffline.load(mint, agent.connection);
  return pump.withdraw({
    authority: agent.wallet_address,
    currencyMint,
    receiverAta:
      receiverAta ??
      getAssociatedTokenAddressSync(currencyMint, agent.wallet_address),
  });
}

async function getAgentConfig(agent: SolanaAgentKitLike, mint: PublicKey) {
  const pump = new PumpAgent(mint, "mainnet", agent.connection);
  return pump.getAgentConfig();
}

async function getPaymentStats(
  agent: SolanaAgentKitLike,
  mint: PublicKey,
  currencyMint: PublicKey,
) {
  const pump = new PumpAgent(mint, "mainnet", agent.connection);
  return pump.getPaymentStats(currencyMint);
}

async function updateBuybackBps(
  agent: SolanaAgentKitLike,
  mint: PublicKey,
  buybackBps: number,
) {
  const pump = new PumpAgent(mint, "mainnet", agent.connection);
  return pump.updateBuybackBps({
    authority: agent.wallet_address,
    buybackBps,
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const PumpAgentPaymentsPlugin: Plugin = {
  name: "pump-agent-payments",

  methods: {
    createAgentPayments,
    buildPayAgentInstructions,
    getAgentBalances,
    validateInvoicePayment,
    distributeAgentPayments,
    withdrawAgentPayments,
    getAgentConfig,
    getPaymentStats,
    updateBuybackBps,
  },

  actions: allActions,
};

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type {
  Action,
  ActionExample,
  ActionHandler,
  Plugin,
  SolanaAgentKitLike,
} from "./types";

export {
  createAgentPaymentsAction,
  buildPaymentInstructionsAction,
  getBalancesAction,
  validateInvoiceAction,
  distributePaymentsAction,
  withdrawAction,
  getConfigAction,
  getPaymentStatsAction,
  updateBuybackBpsAction,
  allActions,
} from "./actions";
