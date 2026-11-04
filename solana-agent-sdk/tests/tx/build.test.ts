import { describe, it, expect, jest } from "@jest/globals";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { buildAndSend, fetchLookupTables } from "../../src/tx/build.js";
import { LookupTableNotFoundError, RetriesExhaustedError } from "../../src/errors.js";
import { MEMO_PROGRAM_ID } from "../../src/utils/memo.js";
import type { WalletProvider } from "../../src/wallet/types.js";
import type { ConfirmOptions } from "../../src/tx/confirm.js";

const payer = Keypair.fromSeed(new Uint8Array(32).fill(11));
const recipient = Keypair.fromSeed(new Uint8Array(32).fill(12)).publicKey;
const transferIx = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 5_000 });

const BLOCKHASHES = [
  "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM",
  "8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKh",
  "CiDwVBFgWV9E5MvXWoLgnEgn2hK7rJikbvfWavzAQz3",
  "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi",
];

/** Connection stub: each getLatestBlockhash call hands out the next blockhash. */
function stubConnection(opts: { blockHeight?: number } = {}) {
  let i = 0;
  const getLatestBlockhash = jest.fn(async () => ({
    blockhash: BLOCKHASHES[Math.min(i, BLOCKHASHES.length - 1)]!,
    lastValidBlockHeight: 1_000 + 10 * i++,
  }));
  const getBlockHeight = jest.fn(async () => opts.blockHeight ?? 5_000);
  return { connection: { getLatestBlockhash, getBlockHeight } as unknown as Connection, getLatestBlockhash, getBlockHeight };
}

type Sent = { tx: Transaction | VersionedTransaction; confirm?: ConfirmOptions };

/** Wallet stub that records every transaction handed to it and replays `results`. */
function stubWallet(results: Array<string | Error>) {
  const sent: Sent[] = [];
  let call = 0;
  const wallet: WalletProvider = {
    publicKey: payer.publicKey,
    signTransaction: async (tx) => tx,
    signAndSendTransaction: async (tx, _connection, confirm) => {
      sent.push({ tx, confirm });
      const r = results[Math.min(call++, results.length - 1)]!;
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { wallet, sent };
}

const fixedFees = { priorityFee: 5_000, cuLimit: 50_000 };
const expired = () => new Error("Signature x has expired: block height exceeded.");

describe("buildAndSend", () => {
  it("prepends the compute-budget instructions and appends the memo", async () => {
    const { connection } = stubConnection();
    const { wallet, sent } = stubWallet(["sig1"]);
    await expect(buildAndSend(wallet, connection, [transferIx], { ...fixedFees, memo: "three.ws" })).resolves.toBe("sig1");

    const tx = sent[0]!.tx as Transaction;
    expect(tx).toBeInstanceOf(Transaction);
    expect(tx.feePayer!.equals(payer.publicKey)).toBe(true);
    expect(tx.recentBlockhash).toBe(BLOCKHASHES[0]);
    const programs = tx.instructions.map((ix) => ix.programId.toBase58());
    expect(programs).toEqual([
      ComputeBudgetProgram.programId.toBase58(),
      ComputeBudgetProgram.programId.toBase58(),
      SystemProgram.programId.toBase58(),
      MEMO_PROGRAM_ID.toBase58(),
    ]);
    expect(Buffer.from(tx.instructions[3]!.data).toString("utf8")).toBe("three.ws");
  });

  it("hands the blockhash expiry and confirm options to the wallet", async () => {
    const { connection } = stubConnection();
    const { wallet, sent } = stubWallet(["sig1"]);
    await buildAndSend(wallet, connection, [transferIx], {
      ...fixedFees,
      commitment: "finalized",
      confirmTimeoutMs: 45_000,
    });
    expect(sent[0]!.confirm).toEqual({ commitment: "finalized", timeoutMs: 45_000, lastValidBlockHeight: 1_000 });
  });

  it("builds a v0 VersionedTransaction when lookup tables are given", async () => {
    const { connection } = stubConnection();
    const { wallet, sent } = stubWallet(["sig1"]);
    const table = new AddressLookupTableAccount({
      key: Keypair.fromSeed(new Uint8Array(32).fill(13)).publicKey,
      state: {
        deactivationSlot: BigInt("18446744073709551615"),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: [recipient],
      },
    });
    await buildAndSend(wallet, connection, [transferIx], { ...fixedFees, lookupTables: [table] });
    const tx = sent[0]!.tx as VersionedTransaction;
    expect(tx).toBeInstanceOf(VersionedTransaction);
    expect(tx.message.version).toBe(0);
    expect(tx.message.addressTableLookups).toHaveLength(1);
  });

  it("partially signs with the extra signers on every attempt", async () => {
    const extra = Keypair.fromSeed(new Uint8Array(32).fill(14));
    const ix = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: extra.publicKey,
      lamports: 1_000_000,
      space: 0,
      programId: SystemProgram.programId,
    });
    const { connection } = stubConnection();
    const { wallet, sent } = stubWallet([expired(), "sig2"]);
    await buildAndSend(wallet, connection, [ix], { ...fixedFees, signers: [extra] });
    expect(sent).toHaveLength(2);
    for (const { tx } of sent) {
      const sig = (tx as Transaction).signatures.find((s) => s.publicKey.equals(extra.publicKey));
      expect(sig?.signature).toBeTruthy();
    }
    expect((sent[1]!.tx as Transaction).recentBlockhash).toBe(BLOCKHASHES[1]);
  });

  it("rebuilds with a fresh blockhash after the previous one expired", async () => {
    const { connection, getLatestBlockhash } = stubConnection({ blockHeight: 5_000 });
    const { wallet, sent } = stubWallet([expired(), "sig2"]);
    await expect(buildAndSend(wallet, connection, [transferIx], fixedFees)).resolves.toBe("sig2");
    expect(getLatestBlockhash).toHaveBeenCalledTimes(2);
    expect((sent[0]!.tx as Transaction).recentBlockhash).toBe(BLOCKHASHES[0]);
    expect((sent[1]!.tx as Transaction).recentBlockhash).toBe(BLOCKHASHES[1]);
  });

  it("throws RetriesExhaustedError carrying the last blockhash and cause", async () => {
    const { connection } = stubConnection({ blockHeight: 5_000 });
    const lastCause = new Error("Blockhash not found");
    const { wallet, sent } = stubWallet([expired(), expired(), lastCause]);
    const err = await buildAndSend(wallet, connection, [transferIx], { ...fixedFees, maxRetries: 3 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RetriesExhaustedError);
    const exhausted = err as RetriesExhaustedError;
    expect(exhausted.attempts).toBe(3);
    expect(exhausted.lastBlockhash).toBe(BLOCKHASHES[2]);
    expect(exhausted.lastError).toBe(lastCause);
    expect(sent).toHaveLength(3);
  });

  it("makes exactly one attempt when maxRetries is 0", async () => {
    const { connection } = stubConnection();
    const { wallet, sent } = stubWallet([expired()]);
    const err = await buildAndSend(wallet, connection, [transferIx], { ...fixedFees, maxRetries: 0 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RetriesExhaustedError);
    expect((err as RetriesExhaustedError).attempts).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("rethrows a non-expiry error unchanged without retrying", async () => {
    const { connection } = stubConnection();
    const rejected = new Error("User rejected the request");
    const { wallet, sent } = stubWallet([rejected, "never"]);
    await expect(buildAndSend(wallet, connection, [transferIx], fixedFees)).rejects.toBe(rejected);
    expect(sent).toHaveLength(1);
  });

  it("rethrows an expiry error when the chain has not passed the blockhash's last valid height", async () => {
    // A lagging RPC can report "Blockhash not found" for a blockhash that is
    // still valid; resending would risk a double spend, so surface it.
    const { connection } = stubConnection({ blockHeight: 10 });
    const lag = new Error("Blockhash not found");
    const { wallet, sent } = stubWallet([lag, "never"]);
    await expect(buildAndSend(wallet, connection, [transferIx], fixedFees)).rejects.toBe(lag);
    expect(sent).toHaveLength(1);
  });

  it("attaches transaction metadata to a meta-aware wallet", async () => {
    const { connection } = stubConnection();
    const { wallet } = stubWallet(["sig"]);
    const setNextMeta = jest.fn();
    const metaWallet = Object.assign(wallet, { setNextMeta });
    await buildAndSend(metaWallet, connection, [transferIx], { ...fixedFees, meta: { label: "Send", kind: "transfer" } });
    expect(setNextMeta).toHaveBeenCalledWith({ label: "Send", kind: "transfer" });
  });
});

describe("fetchLookupTables", () => {
  const tableKey = Keypair.fromSeed(new Uint8Array(32).fill(15)).publicKey;

  it("returns the resolved lookup table accounts in order", async () => {
    const account = new AddressLookupTableAccount({
      key: tableKey,
      state: { deactivationSlot: 0n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [] },
    });
    const connection = {
      getAddressLookupTable: jest.fn(async () => ({ context: { slot: 1 }, value: account })),
    } as unknown as Connection;
    await expect(fetchLookupTables(connection, [tableKey.toBase58()])).resolves.toEqual([account]);
  });

  it("throws LookupTableNotFoundError naming the missing table", async () => {
    const connection = {
      getAddressLookupTable: jest.fn(async (key: PublicKey) => ({ context: { slot: 1 }, value: null, key })),
    } as unknown as Connection;
    const err = await fetchLookupTables(connection, [tableKey.toBase58()]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LookupTableNotFoundError);
    expect((err as LookupTableNotFoundError).address).toBe(tableKey.toBase58());
  });
});
