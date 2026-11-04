import { describe, it, expect, jest } from "@jest/globals";
import {
  ComputeBudgetInstruction,
  Keypair,
  SystemProgram,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { computeUnitIx, estimateComputeUnits, estimatePriorityFee, priorityFeeIx } from "../../src/tx/fees.js";
import { SimulationError } from "../../src/errors.js";

const payer = Keypair.fromSeed(new Uint8Array(32).fill(71)).publicKey;
const to = Keypair.fromSeed(new Uint8Array(32).fill(72)).publicKey;
const transfer = SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports: 1 });
const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";

describe("estimatePriorityFee", () => {
  const withFees = (fees: number[]) =>
    ({
      getRecentPrioritizationFees: jest.fn(async () => fees.map((prioritizationFee, slot) => ({ slot, prioritizationFee }))),
    }) as unknown as Connection;

  it("falls back to 1000 micro-lamports when the cluster reports no recent fees", async () => {
    await expect(estimatePriorityFee(withFees([]))).resolves.toBe(1_000);
  });

  it("returns the 75th percentile of recent fees", async () => {
    await expect(estimatePriorityFee(withFees([400, 100, 300, 200]))).resolves.toBe(400);
    await expect(estimatePriorityFee(withFees([10, 20, 30, 40, 50, 60, 70, 80]))).resolves.toBe(70);
  });

  it("works with a single sample", async () => {
    await expect(estimatePriorityFee(withFees([2_500]))).resolves.toBe(2_500);
  });
});

describe("estimateComputeUnits", () => {
  function simulating(value: { err: unknown; unitsConsumed?: number }) {
    const simulateTransaction = jest.fn(async () => ({ context: { slot: 1 }, value: { logs: [], ...value } }));
    const connection = {
      getLatestBlockhash: jest.fn(async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 10 })),
      simulateTransaction,
    } as unknown as Connection;
    return { connection, simulateTransaction };
  }

  it("adds a 10% margin to the simulated units", async () => {
    const { connection, simulateTransaction } = simulating({ err: null, unitsConsumed: 1_000 });
    await expect(estimateComputeUnits(connection, [transfer], payer)).resolves.toBe(1_100);
    const [tx, opts] = simulateTransaction.mock.calls[0]! as unknown as [VersionedTransaction, { sigVerify: boolean }];
    expect(tx).toBeInstanceOf(VersionedTransaction);
    expect(tx.message.recentBlockhash).toBe(BLOCKHASH);
    expect(opts).toEqual({ sigVerify: false });
  });

  it("rounds the margin up", async () => {
    const { connection } = simulating({ err: null, unitsConsumed: 151 });
    await expect(estimateComputeUnits(connection, [transfer], payer)).resolves.toBe(167);
  });

  it("falls back to a per-instruction budget when the RPC omits unitsConsumed", async () => {
    const { connection } = simulating({ err: null });
    await expect(estimateComputeUnits(connection, [transfer, transfer], payer)).resolves.toBe(50_000);
    const many = Array.from({ length: 20 }, () => transfer);
    await expect(estimateComputeUnits(connection, many, payer)).resolves.toBe(200_000);
  });

  it("throws SimulationError carrying the simulation failure", async () => {
    const simErr = { InstructionError: [0, { Custom: 1 }] };
    const { connection } = simulating({ err: simErr, unitsConsumed: 300 });
    const err = await estimateComputeUnits(connection, [transfer], payer).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimulationError);
    expect((err as SimulationError).simulationError).toEqual(simErr);
  });
});

describe("compute budget instructions", () => {
  it("builds a SetComputeUnitPrice instruction", () => {
    expect(ComputeBudgetInstruction.decodeSetComputeUnitPrice(priorityFeeIx(12_345)).microLamports).toBe(12_345n);
  });

  it("builds a SetComputeUnitLimit instruction", () => {
    expect(ComputeBudgetInstruction.decodeSetComputeUnitLimit(computeUnitIx(250_000)).units).toBe(250_000);
  });
});
