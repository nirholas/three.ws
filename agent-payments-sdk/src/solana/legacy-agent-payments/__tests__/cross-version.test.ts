// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";

import {
  LEGACY_AGENT_PAYMENTS_PROGRAM_ID,
  getTokenAgentPaymentsPDA as legacyTokenAgentPaymentsPDA,
} from "../pdas.js";
import { LegacyPumpAgentOffline } from "../PumpAgentOffline.js";
import legacyIdl from "../idl.json" with { type: "json" };

import {
  PROGRAM_ID,
  getTokenAgentPaymentsPDA as modernTokenAgentPaymentsPDA,
} from "../../pdas.js";
import { PumpAgentOffline } from "../../PumpAgentOffline.js";
import modernIdl from "../../idl/pump_agent_payments.json" with {
  type: "json",
};

const MINT = new PublicKey("11111111111111111111111111111112");
const AUTHORITY = new PublicKey("11111111111111111111111111111113");
const AGENT_AUTHORITY = new PublicKey("11111111111111111111111111111114");

interface IdlIx {
  name: string;
  discriminator: number[];
}

describe("cross-version disjointness (1.0.7 legacy vs 3.0.x modern)", () => {
  it("program IDs differ", () => {
    expect(LEGACY_AGENT_PAYMENTS_PROGRAM_ID.equals(PROGRAM_ID)).toBe(false);
    expect(LEGACY_AGENT_PAYMENTS_PROGRAM_ID.toBase58()).toBe(
      "pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4",
    );
    expect(PROGRAM_ID.toBase58()).toBe(
      "AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7",
    );
  });

  it("tokenAgentPayments PDAs differ for the same mint", () => {
    const [legacyPda] = legacyTokenAgentPaymentsPDA(MINT);
    const [modernPda] = modernTokenAgentPaymentsPDA(MINT);
    expect(legacyPda.equals(modernPda)).toBe(false);
  });

  it("create() instructions target different programIds", async () => {
    const legacy = new LegacyPumpAgentOffline(MINT);
    const modern = new PumpAgentOffline(MINT);
    const legacyIx = await legacy.create({
      authority: AUTHORITY,
      mint: MINT,
      agentAuthority: AGENT_AUTHORITY,
      buybackBps: 1000,
    });
    const modernIx = await modern.create({
      authority: AUTHORITY,
      mint: MINT,
      agentAuthority: AGENT_AUTHORITY,
      buybackBps: 1000,
    });
    expect(legacyIx.programId.equals(LEGACY_AGENT_PAYMENTS_PROGRAM_ID)).toBe(
      true,
    );
    expect(modernIx.programId.equals(PROGRAM_ID)).toBe(true);
    expect(legacyIx.programId.equals(modernIx.programId)).toBe(false);
  });

  it("create() instructions reference the disjoint tokenAgentPayments PDAs", async () => {
    const legacy = new LegacyPumpAgentOffline(MINT);
    const modern = new PumpAgentOffline(MINT);
    const legacyIx = await legacy.create({
      authority: AUTHORITY,
      mint: MINT,
      agentAuthority: AGENT_AUTHORITY,
      buybackBps: 1000,
    });
    const modernIx = await modern.create({
      authority: AUTHORITY,
      mint: MINT,
      agentAuthority: AGENT_AUTHORITY,
      buybackBps: 1000,
    });
    const [legacyTap] = legacyTokenAgentPaymentsPDA(MINT);
    const [modernTap] = modernTokenAgentPaymentsPDA(MINT);
    // tokenAgentPayments is a known account in both IDLs; find it among keys.
    const legacyHasLegacyTap = legacyIx.keys.some((k) =>
      k.pubkey.equals(legacyTap),
    );
    const modernHasModernTap = modernIx.keys.some((k) =>
      k.pubkey.equals(modernTap),
    );
    expect(legacyHasLegacyTap).toBe(true);
    expect(modernHasModernTap).toBe(true);
    // Cross-mismatch: legacy ix should not contain the modern PDA.
    const legacyHasModernTap = legacyIx.keys.some((k) =>
      k.pubkey.equals(modernTap),
    );
    expect(legacyHasModernTap).toBe(false);
  });

  it("IDL addresses (declared programId) are disjoint", () => {
    const legacyAddr = (legacyIdl as { address: string }).address;
    const modernAddr = (modernIdl as { address: string }).address;
    expect(legacyAddr).toBe("pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4");
    expect(modernAddr).not.toBe(legacyAddr);
  });

  it("IDL instruction sets are not identical (modern has extra ix names)", () => {
    const legacyNames = (
      legacyIdl as { instructions: IdlIx[] }
    ).instructions.map((i) => i.name);
    const modernNames = (
      modernIdl as { instructions: IdlIx[] }
    ).instructions.map((i) => i.name);
    // Modern has agent_transfer_extra_lamports + global_remove_currency that
    // legacy does not. Just verify the sets are not equal.
    expect(modernNames.sort()).not.toEqual(legacyNames.sort());
  });
});
