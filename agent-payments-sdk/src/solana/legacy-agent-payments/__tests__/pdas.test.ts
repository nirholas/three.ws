// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import {
  BONDING_CURVE_SEED,
  BUYBACK_AUTHORITY_SEED,
  GLOBAL_CONFIG_SEED,
  INVOICE_ID_SEED,
  LEGACY_AGENT_PAYMENTS_PROGRAM_ID,
  PAYMENT_IN_CURRENCY_SEED,
  PUMP_PROGRAM_ID,
  TOKEN_AGENT_PAYMENTS_SEED,
  WITHDRAW_AUTHORITY_SEED,
  getBondingCurvePDA,
  getBuybackAuthorityPDA,
  getGlobalConfigPDA,
  getInvoiceIdPDA,
  getPaymentInCurrencyPDA,
  getTokenAgentPaymentsPDA,
  getWithdrawAuthorityPDA,
} from "../pdas.js";

// 1.0.7 reference bundle (CommonJS).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as ref from "@pump-fun/agent-payments-sdk";

const TEST_MINT = new PublicKey("11111111111111111111111111111112");
const TEST_CURRENCY = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

describe("legacy-agent-payments / pdas / constants", () => {
  it("LEGACY_AGENT_PAYMENTS_PROGRAM_ID matches the 1.0.7 deployed address", () => {
    expect(LEGACY_AGENT_PAYMENTS_PROGRAM_ID.toBase58()).toBe(
      "pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4",
    );
    // Reference bundle exposes it as PUMP_AGENT_PAYMENTS_PROGRAM_ID and PROGRAM_ID.
    expect(LEGACY_AGENT_PAYMENTS_PROGRAM_ID.toBase58()).toBe(
      ref.PUMP_AGENT_PAYMENTS_PROGRAM_ID.toBase58(),
    );
    expect(LEGACY_AGENT_PAYMENTS_PROGRAM_ID.toBase58()).toBe(
      ref.PROGRAM_ID.toBase58(),
    );
  });

  it("PUMP_PROGRAM_ID matches the canonical pump bonding curve program", () => {
    expect(PUMP_PROGRAM_ID.toBase58()).toBe(
      "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    );
    expect(PUMP_PROGRAM_ID.toBase58()).toBe(ref.PUMP_PROGRAM_ID.toBase58());
  });

  it.each([
    ["GLOBAL_CONFIG_SEED", GLOBAL_CONFIG_SEED, "global-config"],
    [
      "TOKEN_AGENT_PAYMENTS_SEED",
      TOKEN_AGENT_PAYMENTS_SEED,
      "token-agent-payments",
    ],
    [
      "PAYMENT_IN_CURRENCY_SEED",
      PAYMENT_IN_CURRENCY_SEED,
      "payment-in-currency",
    ],
    ["INVOICE_ID_SEED", INVOICE_ID_SEED, "invoice-id"],
    ["BUYBACK_AUTHORITY_SEED", BUYBACK_AUTHORITY_SEED, "buyback-authority"],
    ["WITHDRAW_AUTHORITY_SEED", WITHDRAW_AUTHORITY_SEED, "withdraw-authority"],
    ["BONDING_CURVE_SEED", BONDING_CURVE_SEED, "bonding-curve"],
  ])("%s matches expected utf-8 bytes", (_name, seed, utf8) => {
    expect(Buffer.from(seed).equals(Buffer.from(utf8))).toBe(true);
  });

  it.each([
    ["GLOBAL_CONFIG_SEED", GLOBAL_CONFIG_SEED, ref.GLOBAL_CONFIG_SEED],
    [
      "TOKEN_AGENT_PAYMENTS_SEED",
      TOKEN_AGENT_PAYMENTS_SEED,
      ref.TOKEN_AGENT_PAYMENTS_SEED,
    ],
    [
      "PAYMENT_IN_CURRENCY_SEED",
      PAYMENT_IN_CURRENCY_SEED,
      ref.PAYMENT_IN_CURRENCY_SEED,
    ],
    ["INVOICE_ID_SEED", INVOICE_ID_SEED, ref.INVOICE_ID_SEED],
    [
      "BUYBACK_AUTHORITY_SEED",
      BUYBACK_AUTHORITY_SEED,
      ref.BUYBACK_AUTHORITY_SEED,
    ],
    [
      "WITHDRAW_AUTHORITY_SEED",
      WITHDRAW_AUTHORITY_SEED,
      ref.WITHDRAW_AUTHORITY_SEED,
    ],
    ["BONDING_CURVE_SEED", BONDING_CURVE_SEED, ref.BONDING_CURVE_SEED],
  ])("%s byte-identical to 1.0.7 reference bundle", (_n, ours, theirs) => {
    expect(Buffer.from(ours).equals(Buffer.from(theirs))).toBe(true);
  });
});

describe("legacy-agent-payments / pdas / derivation parity with 1.0.7", () => {
  it("getGlobalConfigPDA matches reference bundle", () => {
    const [oursPk, oursBump] = getGlobalConfigPDA();
    const [refPk, refBump] = ref.getGlobalConfigPDA();
    expect(oursPk.toBase58()).toBe(refPk.toBase58());
    expect(oursBump).toBe(refBump);
  });

  it("getTokenAgentPaymentsPDA matches reference bundle", () => {
    const [oursPk, oursBump] = getTokenAgentPaymentsPDA(TEST_MINT);
    const [refPk, refBump] = ref.getTokenAgentPaymentsPDA(TEST_MINT);
    expect(oursPk.toBase58()).toBe(refPk.toBase58());
    expect(oursBump).toBe(refBump);
  });

  it("getPaymentInCurrencyPDA matches reference bundle", () => {
    const [oursPk, oursBump] = getPaymentInCurrencyPDA(
      TEST_MINT,
      TEST_CURRENCY,
    );
    const [refPk, refBump] = ref.getPaymentInCurrencyPDA(
      TEST_MINT,
      TEST_CURRENCY,
    );
    expect(oursPk.toBase58()).toBe(refPk.toBase58());
    expect(oursBump).toBe(refBump);
  });

  it("getInvoiceIdPDA matches reference bundle for fixed BNs", () => {
    const amount = new BN(100);
    const memo = new BN(200);
    const startTime = new BN(0);
    const endTime = new BN(9999);
    const [oursPk, oursBump] = getInvoiceIdPDA(
      TEST_MINT,
      TEST_CURRENCY,
      amount,
      memo,
      startTime,
      endTime,
    );
    const [refPk, refBump] = ref.getInvoiceIdPDA(
      TEST_MINT,
      TEST_CURRENCY,
      amount,
      memo,
      startTime,
      endTime,
    );
    expect(oursPk.toBase58()).toBe(refPk.toBase58());
    expect(oursBump).toBe(refBump);
  });

  it("getBuybackAuthorityPDA matches reference bundle", () => {
    const [oursPk, oursBump] = getBuybackAuthorityPDA(TEST_MINT);
    const [refPk, refBump] = ref.getBuybackAuthorityPDA(TEST_MINT);
    expect(oursPk.toBase58()).toBe(refPk.toBase58());
    expect(oursBump).toBe(refBump);
  });

  it("getWithdrawAuthorityPDA matches reference bundle", () => {
    const [oursPk, oursBump] = getWithdrawAuthorityPDA(TEST_MINT);
    const [refPk, refBump] = ref.getWithdrawAuthorityPDA(TEST_MINT);
    expect(oursPk.toBase58()).toBe(refPk.toBase58());
    expect(oursBump).toBe(refBump);
  });

  it("getBondingCurvePDA matches reference bundle (pump program)", () => {
    const [oursPk, oursBump] = getBondingCurvePDA(TEST_MINT);
    const [refPk, refBump] = ref.getBondingCurvePDA(TEST_MINT);
    expect(oursPk.toBase58()).toBe(refPk.toBase58());
    expect(oursBump).toBe(refBump);
  });
});
