import { Keypair, Transaction } from "@solana/web3.js";
import { BrowserWalletProvider } from "../../src/wallet/browser-server.js";

describe("BrowserWalletProvider", () => {
  const keypair = Keypair.generate();

  function makeSerializedTx(feePayer = keypair.publicKey): string {
    const tx = new Transaction();
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.feePayer = feePayer;
    return Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64");
  }

  function makeTx(feePayer = keypair.publicKey): Transaction {
    const tx = new Transaction();
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.feePayer = feePayer;
    return tx;
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it("constructor defaults: sessionId is a UUID, publicKey is set", () => {
    const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });
    expect(provider.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(provider.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  it("accepts a base58 string publicKey", () => {
    const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey.toBase58() });
    expect(provider.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  it("setNextMeta attaches meta to the next pending tx", async () => {
    const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });
    const meta = { label: "Swap SOL → USDC", kind: "swap" as const };
    provider.setNextMeta(meta);

    const signPromise = provider.signTransaction(makeTx());
    const [entry] = provider.getPending();
    expect(entry?.meta).toEqual(meta);

    provider.submitSigned(entry!.id, makeSerializedTx());
    await signPromise;
  });

  it("signTransaction creates a pending entry", async () => {
    const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });

    const signPromise = provider.signTransaction(makeTx());
    expect(provider.getPending()).toHaveLength(1);

    const [entry] = provider.getPending();
    provider.submitSigned(entry!.id, makeSerializedTx());
    await signPromise;
  });

  it("pending entry has correct fields", async () => {
    const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });

    const signPromise = provider.signTransaction(makeTx());
    const [entry] = provider.getPending();

    expect(entry).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      transaction: expect.any(String),
      versioned: false,
      createdAt: expect.any(Number),
    });
    expect(entry?.meta).toBeUndefined();

    provider.submitSigned(entry!.id, makeSerializedTx());
    await signPromise;
  });

  it("submitSigned resolves the signTransaction promise", async () => {
    const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });

    const signPromise = provider.signTransaction(makeTx());
    const [entry] = provider.getPending();
    provider.submitSigned(entry!.id, makeSerializedTx());

    const result = await signPromise;
    expect(result).toBeInstanceOf(Transaction);
  });

  it("submitRejected rejects the promise with 'rejected'", async () => {
    const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });

    const signPromise = provider.signTransaction(makeTx());
    const [entry] = provider.getPending();
    provider.submitRejected(entry!.id);

    await expect(signPromise).rejects.toThrow(/rejected/i);
  });

  it("timeout rejects the promise with 'timed out' after timeoutMs", async () => {
    jest.useFakeTimers();
    const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey, timeoutMs: 50 });

    const signPromise = provider.signTransaction(makeTx());
    jest.advanceTimersByTime(50);

    await expect(signPromise).rejects.toThrow(/timed out/i);
  });

  it("nextMeta is consumed after one signTransaction call", async () => {
    const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });
    const meta = { label: "Send 1 SOL", kind: "transfer" as const };
    provider.setNextMeta(meta);

    // First call — meta should be present
    const p1 = provider.signTransaction(makeTx());
    const [e1] = provider.getPending();
    expect(e1?.meta).toEqual(meta);
    provider.submitSigned(e1!.id, makeSerializedTx());
    await p1;

    // Second call — meta should be cleared
    const p2 = provider.signTransaction(makeTx());
    const [e2] = provider.getPending();
    expect(e2?.meta).toBeUndefined();
    provider.submitSigned(e2!.id, makeSerializedTx());
    await p2;
  });
});
