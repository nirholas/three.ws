import { describe, it, expect } from "@jest/globals";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MEMO_PROGRAM_ID, memoInstruction } from "../../src/utils/memo.js";

describe("memoInstruction", () => {
  it("targets the SPL Memo v2 program", () => {
    expect(MEMO_PROGRAM_ID.equals(new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"))).toBe(true);
    expect(memoInstruction("hi").programId.equals(MEMO_PROGRAM_ID)).toBe(true);
  });

  it("encodes the memo as UTF-8 bytes, including multi-byte characters", () => {
    const ix = memoInstruction("three.ws ✓ 日本");
    expect(Buffer.from(ix.data).toString("utf8")).toBe("three.ws ✓ 日本");
    expect(ix.data.length).toBe(Buffer.byteLength("three.ws ✓ 日本", "utf8"));
  });

  it("has no account keys when no signers are given", () => {
    expect(memoInstruction("x").keys).toEqual([]);
  });

  it("lists each signer as a read-only signer", () => {
    const a = Keypair.fromSeed(new Uint8Array(32).fill(61)).publicKey;
    const b = Keypair.fromSeed(new Uint8Array(32).fill(62)).publicKey;
    expect(memoInstruction("x", [a, b]).keys).toEqual([
      { pubkey: a, isSigner: true, isWritable: false },
      { pubkey: b, isSigner: true, isWritable: false },
    ]);
  });
});
