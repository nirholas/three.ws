import { describe, it, expect, jest } from "@jest/globals";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assertSwapMatchesQuote } from "../../src/actions/swap-guard.js";
import { SwapError } from "../../src/errors.js";

const NATIVE_MINT = "So11111111111111111111111111111111111111112";
const THREE_MINT = "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump";
const INPUT_MINT = Keypair.fromSeed(new Uint8Array(32).fill(81)).publicKey.toBase58();
const owner = Keypair.fromSeed(new Uint8Array(32).fill(82)).publicKey;
const pool = Keypair.fromSeed(new Uint8Array(32).fill(83)).publicKey;
const attacker = Keypair.fromSeed(new Uint8Array(32).fill(84)).publicKey;
const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";

const ata = (mint: string, who: PublicKey, program = TOKEN_PROGRAM_ID) =>
  getAssociatedTokenAddressSync(new PublicKey(mint), who, true, program, ASSOCIATED_TOKEN_PROGRAM_ID);

const spend = (amount: bigint, from = owner) =>
  createTransferCheckedInstruction(ata(INPUT_MINT, from), new PublicKey(INPUT_MINT), ata(INPUT_MINT, pool), from, amount, 6);

const creditThree = (to = owner) =>
  createTransferCheckedInstruction(
    ata(THREE_MINT, pool, TOKEN_2022_PROGRAM_ID),
    new PublicKey(THREE_MINT),
    ata(THREE_MINT, to, TOKEN_2022_PROGRAM_ID),
    pool,
    990_000n,
    6,
    [],
    TOKEN_2022_PROGRAM_ID,
  );

function v0(instructions: TransactionInstruction[], tables: AddressLookupTableAccount[] = []) {
  const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message(tables);
  return new VersionedTransaction(msg);
}

const noTables = { getAddressLookupTable: jest.fn() } as unknown as Connection;
const params = { inputMint: INPUT_MINT, outputMint: THREE_MINT, maxInAmount: 1_000_000n, owner };

async function rejection(p: Promise<void>): Promise<SwapError> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SwapError);
  return err as SwapError;
}

describe("assertSwapMatchesQuote", () => {
  it("accepts a swap that spends at most the quoted input and credits the owner's Token-2022 account", async () => {
    await expect(assertSwapMatchesQuote(noTables, v0([spend(1_000_000n), creditThree()]), params)).resolves.toBeUndefined();
  });

  it("counts legacy Transfer instructions as well as TransferChecked", async () => {
    const legacySpend = createTransferInstruction(ata(INPUT_MINT, owner), ata(INPUT_MINT, pool), owner, 600_000n);
    const tx = v0([legacySpend, spend(600_000n), creditThree()]);
    const err = await rejection(assertSwapMatchesQuote(noTables, tx, params));
    expect(err.message).toContain("spends 1200000");
    expect([err.inputMint, err.outputMint]).toEqual([INPUT_MINT, THREE_MINT]);
  });

  it("rejects a transaction that spends more than the quote authorized", async () => {
    const err = await rejection(assertSwapMatchesQuote(noTables, v0([spend(1_000_001n), creditThree()]), params));
    expect(err.message).toContain("at most 1000000");
  });

  it("rejects a transaction that routes the output to someone else", async () => {
    const err = await rejection(assertSwapMatchesQuote(noTables, v0([spend(1_000_000n), creditThree(attacker)]), params));
    expect(err.message).toContain(`does not credit ${THREE_MINT}`);
  });

  it("ignores transfers that are not out of the owner's input account", async () => {
    const thirdParty = spend(50_000_000n, attacker);
    await expect(
      assertSwapMatchesQuote(noTables, v0([thirdParty, spend(1_000n), creditThree()]), params),
    ).resolves.toBeUndefined();
  });

  it("counts native SOL wrapped out of the wallet as input spend", async () => {
    const wrap = (lamports: number) =>
      SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata(NATIVE_MINT, owner), lamports });
    const solParams = { ...params, inputMint: NATIVE_MINT, maxInAmount: 2_000_000n };
    await expect(assertSwapMatchesQuote(noTables, v0([wrap(2_000_000), creditThree()]), solParams)).resolves.toBeUndefined();
    const err = await rejection(assertSwapMatchesQuote(noTables, v0([wrap(1_500_000), wrap(600_000), creditThree()]), solParams));
    expect(err.message).toContain("spends 2100000");
  });

  it("does not count SOL sent to the wallet by someone else", async () => {
    const tip = SystemProgram.transfer({ fromPubkey: attacker, toPubkey: owner, lamports: 9_000_000 });
    const solParams = { ...params, inputMint: NATIVE_MINT, maxInAmount: 1n };
    await expect(assertSwapMatchesQuote(noTables, v0([tip, creditThree()]), solParams)).resolves.toBeUndefined();
  });

  it("resolves the lookup tables the transaction references", async () => {
    const table = new AddressLookupTableAccount({
      key: Keypair.fromSeed(new Uint8Array(32).fill(85)).publicKey,
      state: {
        deactivationSlot: BigInt("18446744073709551615"),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: [ata(INPUT_MINT, pool), ata(THREE_MINT, pool, TOKEN_2022_PROGRAM_ID), new PublicKey(THREE_MINT)],
      },
    });
    const getAddressLookupTable = jest.fn(async (_key: unknown) => ({ context: { slot: 1 }, value: table }));
    const connection = { getAddressLookupTable } as unknown as Connection;
    const tx = v0([spend(1_000_000n), creditThree()], [table]);
    expect(tx.message.addressTableLookups).toHaveLength(1);
    await expect(assertSwapMatchesQuote(connection, tx, params)).resolves.toBeUndefined();
    expect(getAddressLookupTable).toHaveBeenCalledWith(table.key);
  });

  it("rejects a transaction whose lookup table cannot be resolved", async () => {
    const table = new AddressLookupTableAccount({
      key: Keypair.fromSeed(new Uint8Array(32).fill(86)).publicKey,
      state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [ata(INPUT_MINT, pool)] },
    });
    const connection = { getAddressLookupTable: jest.fn(async () => ({ context: { slot: 1 }, value: null })) } as unknown as Connection;
    const err = await rejection(assertSwapMatchesQuote(connection, v0([spend(1n), creditThree()], [table]), params));
    expect(err.message).toContain("unresolvable address lookup table");
    expect([err.inputMint, err.outputMint]).toEqual([INPUT_MINT, THREE_MINT]);
  });

  it("rejects a transaction that cannot be decompiled against its lookup tables", async () => {
    const real = new AddressLookupTableAccount({
      key: Keypair.fromSeed(new Uint8Array(32).fill(87)).publicKey,
      state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [ata(INPUT_MINT, pool)] },
    });
    // The RPC hands back a table with a different (empty) address list, so the
    // compiled lookup index points past the end.
    const tampered = new AddressLookupTableAccount({ key: real.key, state: { ...real.state, addresses: [] } });
    const connection = { getAddressLookupTable: jest.fn(async () => ({ context: { slot: 1 }, value: tampered })) } as unknown as Connection;
    const err = await rejection(assertSwapMatchesQuote(connection, v0([spend(1n), creditThree()], [real]), params));
    expect(err.message).toContain("Unable to decode swap transaction for validation");
  });
});
