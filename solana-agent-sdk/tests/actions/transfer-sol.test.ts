import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemInstruction,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import { transferSol } from "../../src/actions/transfer-sol.js";
import { buildAndSend } from "../../src/tx/build.js";
import type { TxMetadata, WalletProvider } from "../../src/wallet/types.js";

jest.mock("../../src/tx/build.js", () => ({ buildAndSend: jest.fn() }));

const mockBuildAndSend = jest.mocked(buildAndSend);

const WALLET_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const RECIPIENT_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;

const wallet = {
  publicKey: WALLET_PUBKEY,
  signTransaction: jest.fn(),
  signAndSendTransaction: jest.fn(),
} as unknown as WalletProvider;

const connection = {} as unknown as Connection;

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildAndSend.mockResolvedValue("mockSig");
});

describe("transferSol", () => {
  it("converts amount to correct lamports (0.5 SOL → 500_000_000)", async () => {
    await transferSol(wallet, connection, { to: RECIPIENT_PUBKEY, amount: 0.5 });

    const [, , instructions] = mockBuildAndSend.mock.calls[0]!;
    const decoded = SystemInstruction.decodeTransfer(instructions[0]!);
    expect(Number(decoded.lamports)).toBe(0.5 * LAMPORTS_PER_SOL);
  });

  it("builds SystemProgram.transfer with correct pubkeys", async () => {
    await transferSol(wallet, connection, { to: RECIPIENT_PUBKEY, amount: 1 });

    const [, , instructions] = mockBuildAndSend.mock.calls[0]!;
    const ix = instructions[0]!;
    expect(ix.programId.equals(SystemProgram.programId)).toBe(true);

    const decoded = SystemInstruction.decodeTransfer(ix);
    expect(decoded.fromPubkey.equals(WALLET_PUBKEY)).toBe(true);
    expect(decoded.toPubkey.equals(RECIPIENT_PUBKEY)).toBe(true);
  });

  it("auto-generates meta label containing amount and 'SOL'", async () => {
    await transferSol(wallet, connection, { to: RECIPIENT_PUBKEY, amount: 2.5 });

    const [, , , opts] = mockBuildAndSend.mock.calls[0]!;
    expect(opts?.meta?.label).toContain("2.5");
    expect(opts?.meta?.label).toContain("SOL");
  });

  it("auto-generated meta has kind 'transfer'", async () => {
    await transferSol(wallet, connection, { to: RECIPIENT_PUBKEY, amount: 1 });

    const [, , , opts] = mockBuildAndSend.mock.calls[0]!;
    expect(opts?.meta?.kind).toBe("transfer");
  });

  it("accepts to as a base58 string", async () => {
    await transferSol(wallet, connection, { to: RECIPIENT_PUBKEY.toBase58(), amount: 1 });

    const [, , instructions] = mockBuildAndSend.mock.calls[0]!;
    const decoded = SystemInstruction.decodeTransfer(instructions[0]!);
    expect(decoded.toPubkey.equals(RECIPIENT_PUBKEY)).toBe(true);
  });

  it("uses provided opts.meta instead of auto-generating", async () => {
    const customMeta: TxMetadata = { label: "Custom label", kind: "custom" };
    await transferSol(wallet, connection, { to: RECIPIENT_PUBKEY, amount: 1 }, { meta: customMeta });

    const [, , , opts] = mockBuildAndSend.mock.calls[0]!;
    expect(opts?.meta).toBe(customMeta);
  });
});
