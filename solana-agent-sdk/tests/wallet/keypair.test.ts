// jest.mock() is not hoisted in ESM mode; use jest.unstable_mockModule + dynamic imports instead.
import { describe, it, expect, jest } from "@jest/globals";

const mockSendAndConfirmFn = jest.fn().mockImplementation(() => Promise.resolve("fakeSig"));

jest.unstable_mockModule("@solana/web3.js", async () => {
  const actual = await import("@solana/web3.js");
  return { ...(actual as object), sendAndConfirmTransaction: mockSendAndConfirmFn };
});

// All imports of mocked modules must be dynamic and come AFTER unstable_mockModule.
const { Keypair, Transaction, VersionedTransaction, TransactionMessage } =
  await import("@solana/web3.js") as typeof import("@solana/web3.js");
const { default: bs58 } = await import("bs58");
const { KeypairWalletProvider } = await import("../../src/wallet/keypair.js");

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
    mockSendAndConfirmFn.mockClear();
    const provider = new KeypairWalletProvider(keypair.secretKey);
    const tx = new Transaction();
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.feePayer = keypair.publicKey;
    const connection = {} as Parameters<
      typeof import("@solana/web3.js").sendAndConfirmTransaction
    >[0];

    const result = await provider.signAndSendTransaction(tx, connection);

    expect(result).toBe("fakeSig");
    expect(mockSendAndConfirmFn).toHaveBeenCalledWith(connection, tx, expect.any(Array));
  });
});
