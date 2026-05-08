// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

/**
 * listen-pump-events.ts
 *
 * Subscribes to the pump.fun bonding-curve program and pretty-prints each
 * event for 60 seconds, then exits 0.
 *
 * Usage:
 *   SOLANA_RPC_URL=https://... npx tsx src/solana/examples/listen-pump-events.ts
 *   SOLANA_RPC_URL=https://... MINT=<base58> npx tsx src/solana/examples/listen-pump-events.ts
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  subscribeToPumpEvents,
  type ParsedPumpEvent,
  type PumpEventName,
} from "../pump-events.js";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const MINT_STR = process.env.MINT;
const DURATION_MS = 60_000;

function formatValue(v: unknown): string {
  if (v instanceof BN) return (v as BN).toString();
  if (v instanceof PublicKey) return (v as PublicKey).toBase58();
  if (Array.isArray(v)) return `[${(v as unknown[]).map(formatValue).join(", ")}]`;
  if (v !== null && typeof v === "object" && !ArrayBuffer.isView(v)) {
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${formatValue(val)}`)
      .join(", ")}}`;
  }
  return String(v);
}

function printEvent(ev: ParsedPumpEvent): void {
  const sig = ev.signature ?? "unknown";
  const slot = ev.slot ?? 0;
  const solscan = `https://solscan.io/tx/${sig}`;

  // Pull out the most interesting fields per event type
  const data = ev.data as unknown as Record<string, unknown>;
  const keyFields: Record<PumpEventName, string[]> = {
    TradeEvent: ["mint", "sol_amount", "token_amount", "is_buy", "user"],
    CreateEvent: ["mint", "name", "symbol", "user"],
    ClaimCashbackEvent: ["mint", "user", "amount"],
    CompleteEvent: ["mint", "user"],
    CompletePumpAmmMigrationEvent: ["mint", "sol_amount", "pool"],
    AdminSetCreatorEvent: ["mint", "new_creator"],
    AdminSetIdlAuthorityEvent: ["idl_authority"],
    AdminUpdateTokenIncentivesEvent: ["mint", "day_number", "token_supply_per_day"],
    ClaimTokenIncentivesEvent: ["mint", "user", "amount"],
    CloseUserVolumeAccumulatorEvent: ["user"],
    CollectCreatorFeeEvent: ["creator", "creator_fee"],
    DistributeCreatorFeesEvent: ["creator", "total_amount"],
    ExtendAccountEvent: ["account", "current_size", "new_size"],
    InitUserVolumeAccumulatorEvent: ["user"],
    MigrateBondingCurveCreatorEvent: ["mint", "user"],
    MinimumDistributableFeeEvent: ["new_minimum_distributable_fee"],
    ReservedFeeRecipientsEvent: ["new_reserved_fee_recipients"],
    SetCreatorEvent: ["mint", "new_creator"],
    SetMetaplexCreatorEvent: ["mint", "creator"],
    SetParamsEvent: ["fee_basis_points", "withdraw_authority"],
    SyncUserVolumeAccumulatorEvent: ["user"],
    UpdateGlobalAuthorityEvent: ["authority"],
    UpdateMayhemVirtualParamsEvent: ["initial_virtual_sol_reserves"],
  };

  const fields = keyFields[ev.name] ?? Object.keys(data).slice(0, 4);
  const summary = fields
    .filter((f) => f in data)
    .map((f) => `${f}=${formatValue(data[f])}`)
    .join(" | ");

  console.log(`\n[slot ${slot}] ${ev.name}`);
  console.log(`  ${summary}`);
  console.log(`  sig: ${sig}`);
  console.log(`  ${solscan}`);
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const mint = MINT_STR ? new PublicKey(MINT_STR) : undefined;

  console.log(`Listening to pump events${mint ? ` for mint ${mint.toBase58()}` : ""}…`);
  console.log(`RPC: ${RPC}`);
  console.log(`Duration: ${DURATION_MS / 1000}s\n`);

  const sub = subscribeToPumpEvents(connection, { mint }, printEvent);

  await new Promise((r) => setTimeout(r, DURATION_MS));
  await sub.unsubscribe();
  console.log("\nDone. Exiting.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
