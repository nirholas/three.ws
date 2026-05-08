// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

/**
 * Typed event parser and live subscriber for the pump.fun bonding-curve
 * program (`6EF8rrec...`).
 *
 * Intentionally separate from `./events.ts` which targets the
 * `agent-payments` program. Both programs emit Anchor `emit_cpi!` events
 * but their IDLs are completely different.
 *
 * NOTE: BorshEventCoder returns field names in the snake_case form that
 * appears in the IDL (e.g. `is_buy`, `sol_amount`). Interfaces here mirror
 * that casing so TypeScript types match the runtime values exactly.
 *
 * IDL source: swap/node_modules/@pump-fun/pump-sdk/src/idl/pump.json
 * (the runtime IDL has more fields than pump-public-docs/idl/pump.json).
 */

import {
  PublicKey,
  type Commitment,
  type Connection,
  type Logs,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { BorshEventCoder } from "@coral-xyz/anchor/dist/cjs/coder/borsh/event.js";
import type { Idl } from "@coral-xyz/anchor";

import IDL_JSON from "./idl/pump.json";

// ─── Program constant ────────────────────────────────────────────────────────

/** The pump.fun bonding-curve program id. */
export const PUMP_BONDING_CURVE_PROGRAM_ID = new PublicKey(IDL_JSON.address);

// ─── Typed event data interfaces ─────────────────────────────────────────────
// Field names and types are derived from the runtime IDL (pump.json).
// Pubkey fields: PublicKey; u64/i64: BN; bool: boolean; string: string.

export interface Shareholder {
  address: PublicKey;
  share_bps: number;
}

export interface AdminSetCreatorEventData {
  timestamp: BN;
  admin_set_creator_authority: PublicKey;
  mint: PublicKey;
  bonding_curve: PublicKey;
  old_creator: PublicKey;
  new_creator: PublicKey;
}

export interface AdminSetIdlAuthorityEventData {
  idl_authority: PublicKey;
}

export interface AdminUpdateTokenIncentivesEventData {
  start_time: BN;
  end_time: BN;
  day_number: BN;
  token_supply_per_day: BN;
  mint: PublicKey;
  seconds_in_a_day: BN;
  timestamp: BN;
}

export interface ClaimCashbackEventData {
  user: PublicKey;
  amount: BN;
  timestamp: BN;
  total_claimed: BN;
  total_cashback_earned: BN;
}

export interface ClaimTokenIncentivesEventData {
  user: PublicKey;
  mint: PublicKey;
  amount: BN;
  timestamp: BN;
  total_claimed_tokens: BN;
  current_sol_volume: BN;
}

export interface CloseUserVolumeAccumulatorEventData {
  user: PublicKey;
  timestamp: BN;
  total_unclaimed_tokens: BN;
  total_claimed_tokens: BN;
  current_sol_volume: BN;
  last_update_timestamp: BN;
}

export interface CollectCreatorFeeEventData {
  timestamp: BN;
  creator: PublicKey;
  creator_fee: BN;
}

export interface CompleteEventData {
  user: PublicKey;
  mint: PublicKey;
  bonding_curve: PublicKey;
  timestamp: BN;
  quote_mint: PublicKey;
}

export interface CompletePumpAmmMigrationEventData {
  user: PublicKey;
  mint: PublicKey;
  mint_amount: BN;
  sol_amount: BN;
  pool_migration_fee: BN;
  bonding_curve: PublicKey;
  timestamp: BN;
  pool: PublicKey;
}

export interface CreateEventData {
  name: string;
  symbol: string;
  uri: string;
  mint: PublicKey;
  bonding_curve: PublicKey;
  user: PublicKey;
  creator: PublicKey;
  timestamp: BN;
  virtual_token_reserves: BN;
  virtual_sol_reserves: BN;
  real_token_reserves: BN;
  token_total_supply: BN;
  token_program: PublicKey;
  is_mayhem_mode: boolean;
  is_cashback_enabled: boolean;
  quote_mint: PublicKey;
  virtual_quote_reserves: BN;
}

export interface DistributeCreatorFeesEventData {
  timestamp: BN;
  mint: PublicKey;
  bonding_curve: PublicKey;
  sharing_config: PublicKey;
  admin: PublicKey;
  shareholders: Shareholder[];
  distributed: BN;
}

export interface ExtendAccountEventData {
  account: PublicKey;
  user: PublicKey;
  current_size: BN;
  new_size: BN;
  timestamp: BN;
}

export interface InitUserVolumeAccumulatorEventData {
  payer: PublicKey;
  user: PublicKey;
  timestamp: BN;
}

export interface MigrateBondingCurveCreatorEventData {
  timestamp: BN;
  mint: PublicKey;
  bonding_curve: PublicKey;
  sharing_config: PublicKey;
  old_creator: PublicKey;
  new_creator: PublicKey;
}

export interface MinimumDistributableFeeEventData {
  minimum_required: BN;
  distributable_fees: BN;
  can_distribute: boolean;
}

export interface ReservedFeeRecipientsEventData {
  timestamp: BN;
  reserved_fee_recipient: PublicKey;
  reserved_fee_recipients: PublicKey[];
}

export interface SetCreatorEventData {
  timestamp: BN;
  mint: PublicKey;
  bonding_curve: PublicKey;
  creator: PublicKey;
}

export interface SetMetaplexCreatorEventData {
  timestamp: BN;
  mint: PublicKey;
  bonding_curve: PublicKey;
  metadata: PublicKey;
  creator: PublicKey;
}

export interface SetParamsEventData {
  initial_virtual_token_reserves: BN;
  initial_virtual_sol_reserves: BN;
  initial_real_token_reserves: BN;
  final_real_sol_reserves: BN;
  token_total_supply: BN;
  fee_basis_points: BN;
  withdraw_authority: PublicKey;
  enable_migrate: boolean;
  pool_migration_fee: BN;
  creator_fee_basis_points: BN;
  fee_recipients: PublicKey[];
  timestamp: BN;
  set_creator_authority: PublicKey;
  admin_set_creator_authority: PublicKey;
}

export interface SyncUserVolumeAccumulatorEventData {
  user: PublicKey;
  total_claimed_tokens_before: BN;
  total_claimed_tokens_after: BN;
  timestamp: BN;
}

export interface TradeEventData {
  mint: PublicKey;
  sol_amount: BN;
  token_amount: BN;
  is_buy: boolean;
  user: PublicKey;
  timestamp: BN;
  virtual_sol_reserves: BN;
  virtual_token_reserves: BN;
  real_sol_reserves: BN;
  real_token_reserves: BN;
  fee_recipient: PublicKey;
  fee_basis_points: BN;
  fee: BN;
  creator: PublicKey;
  creator_fee_basis_points: BN;
  creator_fee: BN;
  track_volume: boolean;
  total_unclaimed_tokens: BN;
  total_claimed_tokens: BN;
  current_sol_volume: BN;
  last_update_timestamp: BN;
  ix_name: string;
  mayhem_mode: boolean;
  cashback_fee_basis_points: BN;
  cashback: BN;
  buyback_fee_basis_points: BN;
  buyback_fee: BN;
  shareholders: Shareholder[];
  quote_mint: PublicKey;
  quote_amount: BN;
  virtual_quote_reserves: BN;
  real_quote_reserves: BN;
}

export interface UpdateGlobalAuthorityEventData {
  global: PublicKey;
  authority: PublicKey;
  new_authority: PublicKey;
  timestamp: BN;
}

export interface UpdateMayhemVirtualParamsEventData {
  timestamp: BN;
  mint: PublicKey;
  virtual_token_reserves: BN;
  virtual_sol_reserves: BN;
  new_virtual_token_reserves: BN;
  new_virtual_sol_reserves: BN;
  real_token_reserves: BN;
  real_sol_reserves: BN;
}

// ─── Discriminated map ───────────────────────────────────────────────────────

export interface PumpEventDataMap {
  AdminSetCreatorEvent: AdminSetCreatorEventData;
  AdminSetIdlAuthorityEvent: AdminSetIdlAuthorityEventData;
  AdminUpdateTokenIncentivesEvent: AdminUpdateTokenIncentivesEventData;
  ClaimCashbackEvent: ClaimCashbackEventData;
  ClaimTokenIncentivesEvent: ClaimTokenIncentivesEventData;
  CloseUserVolumeAccumulatorEvent: CloseUserVolumeAccumulatorEventData;
  CollectCreatorFeeEvent: CollectCreatorFeeEventData;
  CompleteEvent: CompleteEventData;
  CompletePumpAmmMigrationEvent: CompletePumpAmmMigrationEventData;
  CreateEvent: CreateEventData;
  DistributeCreatorFeesEvent: DistributeCreatorFeesEventData;
  ExtendAccountEvent: ExtendAccountEventData;
  InitUserVolumeAccumulatorEvent: InitUserVolumeAccumulatorEventData;
  MigrateBondingCurveCreatorEvent: MigrateBondingCurveCreatorEventData;
  MinimumDistributableFeeEvent: MinimumDistributableFeeEventData;
  ReservedFeeRecipientsEvent: ReservedFeeRecipientsEventData;
  SetCreatorEvent: SetCreatorEventData;
  SetMetaplexCreatorEvent: SetMetaplexCreatorEventData;
  SetParamsEvent: SetParamsEventData;
  SyncUserVolumeAccumulatorEvent: SyncUserVolumeAccumulatorEventData;
  TradeEvent: TradeEventData;
  UpdateGlobalAuthorityEvent: UpdateGlobalAuthorityEventData;
  UpdateMayhemVirtualParamsEvent: UpdateMayhemVirtualParamsEventData;
}

export type PumpEventName = keyof PumpEventDataMap;

export interface ParsedPumpEvent<E extends PumpEventName = PumpEventName> {
  name: E;
  data: PumpEventDataMap[E];
  signature?: string;
  slot?: number;
}

// ─── Discriminator map ───────────────────────────────────────────────────────

/** Maps each IDL event name to its 8-byte discriminator Buffer. */
export const eventDiscriminatorMap: Map<PumpEventName, Buffer> = new Map(
  IDL_JSON.events.map((ev) => [
    ev.name as PumpEventName,
    Buffer.from(ev.discriminator),
  ]),
);

// Invariant: every IDL event must be in the map — fires at module load.
if (eventDiscriminatorMap.size !== IDL_JSON.events.length) {
  throw new Error(
    `pump-events: discriminator map size (${eventDiscriminatorMap.size}) ` +
      `!= IDL events length (${IDL_JSON.events.length})`,
  );
}

// ─── Parser ──────────────────────────────────────────────────────────────────

const PROGRAM_DATA_PREFIX = "Program data: ";

export interface PumpEventParser {
  /**
   * Decode transaction log messages into typed pump events.
   * Lines not starting with `Program data: `, or with an unknown
   * discriminator, are silently ignored.
   */
  parseLogs(logs: string[]): ParsedPumpEvent[];
}

export function createPumpEventParser(): PumpEventParser {
  const coder = new BorshEventCoder(IDL_JSON as unknown as Idl);

  return {
    parseLogs(logs: string[]): ParsedPumpEvent[] {
      const out: ParsedPumpEvent[] = [];
      for (const line of logs) {
        if (!line.startsWith(PROGRAM_DATA_PREFIX)) continue;
        const b64 = line.slice(PROGRAM_DATA_PREFIX.length);
        const decoded = coder.decode(b64);
        if (!decoded) continue;
        out.push({
          name: decoded.name as PumpEventName,
          data: decoded.data as PumpEventDataMap[PumpEventName],
        });
      }
      return out;
    },
  };
}

// ─── Subscription ────────────────────────────────────────────────────────────

export interface SubscribePumpEventsOptions {
  /** Filter events that carry a `mint` field matching this key. */
  mint?: PublicKey;
  /** Override the bonding-curve program id. */
  programId?: PublicKey;
  /** Commitment level (default: `confirmed`). */
  commitment?: Commitment;
}

export interface PumpEventSubscription {
  /** Stop listening. Idempotent — safe to call multiple times. */
  unsubscribe: () => Promise<void>;
}

/** Narrow subset of `Connection` used here; makes unit-testing easy. */
export type LogsSubscriber = Pick<Connection, "onLogs" | "removeOnLogsListener">;

/**
 * Subscribe to real-time pump bonding-curve program events via WebSocket.
 *
 * @example
 * ```ts
 * const sub = subscribeToPumpEvents(connection, { mint }, (ev) => {
 *   if (ev.name === "TradeEvent") console.log(ev.data.sol_amount.toString());
 * });
 * await sub.unsubscribe();
 * ```
 */
export function subscribeToPumpEvents(
  connection: LogsSubscriber,
  options: SubscribePumpEventsOptions,
  onEvent: (event: ParsedPumpEvent) => void,
): PumpEventSubscription {
  const programId = options.programId ?? PUMP_BONDING_CURVE_PROGRAM_ID;
  const commitment = options.commitment ?? "confirmed";
  const parser = createPumpEventParser();

  const subId = connection.onLogs(
    programId,
    (logsCb: Logs, ctx: { slot: number }) => {
      if (logsCb.err) return;
      for (const ev of parser.parseLogs(logsCb.logs)) {
        if (options.mint) {
          const m = (ev.data as { mint?: PublicKey }).mint;
          if (!(m instanceof PublicKey) || !m.equals(options.mint)) continue;
        }
        ev.signature = logsCb.signature;
        ev.slot = ctx.slot;
        onEvent(ev);
      }
    },
    commitment,
  );

  let unsubscribed = false;
  return {
    async unsubscribe() {
      if (unsubscribed) return;
      unsubscribed = true;
      const id = await Promise.resolve(subId);
      await connection.removeOnLogsListener(id);
    },
  };
}
