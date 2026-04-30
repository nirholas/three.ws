import { describe, it, expect, jest } from "@jest/globals";
import { Keypair, Transaction, VersionedTransaction, TransactionMessage } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { KeypairWalletProvider } from "../../src/wallet/keypair.js";

describe("KeypairWalletProvider", () => {
  const keypair = Keypair.generate();

  it("base58 string constructor sets correct publicKey", () => {
    const bs58Key = bs58.encode(keypair.secretKey);
    const provider = new KeypairWalletProvider(bs58Key);
    expect(provider.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  it("Uint8Array constructor sets correct publicKey", () => {
    const provider = new KeypairWalletProvider(keypair.secretKey);
    expect(provider.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  it("Array constructor sets correct publicKey", () => {
    const provider = new KeypairWalletProvider(Array.from(keypair.secretKey));
    expect(provider.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  it("signTransaction (legacy) produces a valid signature for the keypair", async () => {
    const provider = new KeypairWalletProvider(keypair.secretKey);
    const tx = new Transaction();
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.feePayer = keypair.publicKey;

    const signed = await provider.signTransaction(tx);
    const sig = signed.signature;
    expect(sig).not.toBeNull();
    expect(sig!.some((b) => b !== 0)).toBe(true);
  });

  it("signTransaction (versioned) produces non-empty signatures", async () => {
    const provider = new KeypairWalletProvider(keypair.secretKey);
    const message = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(message);

    const signed = await provider.signTransaction(vtx);
    expect(signed.signatures.length).toBeGreaterThan(0);
    expect(signed.signatures[0]!.some((b) => b !== 0)).toBe(true);
  });

  it("signAndSendTransaction calls sendAndConfirmTransaction with the keypair", async () => {
    const provider = new KeypairWalletProvider(keypair.secretKey);
    const tx = new Transaction();
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.feePayer = keypair.publicKey;

    // Minimal connection mock: sendAndConfirmTransaction calls these two methods.
    const fakeSig = "fakeSig";
    const sendTransaction = jest.fn().mockImplementation(() => Promise.resolve(fakeSig));
    const confirmTransaction = jest
      .fn()
      .mockImplementation(() => Promise.resolve({ value: { err: null } }));
    const connection = { sendTransaction, confirmTransaction } as unknown as Connection;

    const result = await provider.signAndSendTransaction(tx, connection);

    expect(result).toBe(fakeSig);
    // Verify the keypair was included in the signers array passed to sendTransaction.
    expect(sendTransaction).toHaveBeenCalledWith(
      tx,
      expect.arrayContaining([
        expect.objectContaining({ publicKey: keypair.publicKey }),
      ]),
      // sendOptions is undefined when no ConfirmOptions are passed
      undefined,
    );
  });
});
