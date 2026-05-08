// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import idlJson from "./idl.json" with { type: "json" };
import type { LegacyPumpAgentPayments } from "./idl.js";

const IDL = idlJson as unknown as LegacyPumpAgentPayments;

const NOOP_WALLET = {
  publicKey: PublicKey.default,
  signTransaction: () => Promise.reject(new Error("read-only wallet")),
  signAllTransactions: () => Promise.reject(new Error("read-only wallet")),
};

/**
 * Anchor program client for the **1.0.7** pump_agent_payments deployment
 * (`pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4`). Use this when you need
 * to interact with coins whose tokenized-agent record lives on the legacy
 * program — most commonly when @pump-fun/pump-sdk's `isTokenizedAgent: true`
 * created the agent.
 */
export function getLegacyPumpProgram(
  connection: Connection,
): Program<LegacyPumpAgentPayments> {
  return new Program<LegacyPumpAgentPayments>(
    IDL,
    new AnchorProvider(connection, NOOP_WALLET, {}),
  );
}

/**
 * Offline program client (no `Connection`) for instruction-only flows. The
 * underlying provider uses `PublicKey.default` as its identity and refuses
 * to sign — every method must end with `.instruction()`, not `.rpc()`.
 */
export function getLegacyOfflineProgram(): Program<LegacyPumpAgentPayments> {
  return new Program<LegacyPumpAgentPayments>(
    IDL,
    new AnchorProvider(
      { commitment: "processed" } as unknown as Connection,
      NOOP_WALLET,
      {},
    ),
  );
}

const OFFLINE_PUMP_PROGRAM = getLegacyOfflineProgram();

/** Pick `online` when a connection is available, fall back to offline. */
export function getLegacyPumpProgramWithFallback(
  connection?: Connection,
): Program<LegacyPumpAgentPayments> {
  return connection ? getLegacyPumpProgram(connection) : OFFLINE_PUMP_PROGRAM;
}

/** Decode helpers using the offline coder (no chain calls). */
export function decodeLegacyGlobalConfig(data: Buffer) {
  return OFFLINE_PUMP_PROGRAM.coder.accounts.decode("globalConfig", data);
}

export function decodeLegacyTokenAgentPaymentInCurrency(data: Buffer) {
  return OFFLINE_PUMP_PROGRAM.coder.accounts.decode(
    "tokenAgentPaymentInCurrency",
    data,
  );
}

export function decodeLegacyTokenAgentPayments(data: Buffer) {
  return OFFLINE_PUMP_PROGRAM.coder.accounts.decode("tokenAgentPayments", data);
}

export { OFFLINE_PUMP_PROGRAM };
