import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { Keypair, Transaction, type Connection } from "@solana/web3.js";
import { BrowserWalletProvider } from "../../src/wallet/browser-server.js";
import { ConfirmationTimeoutError, TransactionFailedError, TransactionRejectedError } from "../../src/errors.js";

describe("BrowserWalletProvider", () => {
  const keypair = Keypair.generate();

  function makeTx(feePayer = keypair.publicKey): Transaction {
    const tx = new Transaction();
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.feePayer = feePayer;
    return tx;
  }

  // The provider now validates that the returned, signed transaction matches the
  // requested one and is validly signed by the wallet. Tests must therefore sign
  // the exact tx they submitted back.
  function signSerialized(tx: Transaction): string {
    tx.sign(keypair);
    return Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64");
  }

  function makeSerializedTx(feePayer = keypair.publicKey): string {
    return signSerialized(makeTx(feePayer));
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

    const p1 = provider.signTransaction(makeTx());
    const [e1] = provider.getPending();
    expect(e1?.meta).toEqual(meta);
    provider.submitSigned(e1!.id, makeSerializedTx());
    await p1;

    const p2 = provider.signTransaction(makeTx());
    const [e2] = provider.getPending();
    expect(e2?.meta).toBeUndefined();
    provider.submitSigned(e2!.id, makeSerializedTx());
    await p2;
  });
  describe("signAndSendTransaction", () => {
    function stubConnection(status: unknown) {
      const sendRawTransaction = jest.fn(async () => "browserSig");
      const getSignatureStatuses = jest.fn(async () => ({ context: { slot: 1 }, value: [status] }));
      return {
        connection: { sendRawTransaction, getSignatureStatuses } as unknown as Connection,
        sendRawTransaction,
      };
    }

    async function approveNext(provider: BrowserWalletProvider): Promise<void> {
      for (let i = 0; i < 50 && provider.getPending().length === 0; i++) {
        await new Promise((r) => setImmediate(r));
      }
      const [entry] = provider.getPending();
      provider.submitSigned(entry!.id, makeSerializedTx());
    }

    it("submits the browser-signed transaction and resolves once confirmed", async () => {
      const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });
      const { connection, sendRawTransaction } = stubConnection({
        slot: 3, confirmations: 1, err: null, confirmationStatus: "confirmed",
      });
      const sent = provider.signAndSendTransaction(makeTx(), connection);
      await approveNext(provider);
      await expect(sent).resolves.toBe("browserSig");
      expect(sendRawTransaction).toHaveBeenCalledTimes(1);
    });

    it("throws TransactionFailedError when the submitted transaction fails on-chain", async () => {
      const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });
      const { connection } = stubConnection({
        slot: 3, confirmations: 1, err: { InstructionError: [0, "InvalidAccountData"] }, confirmationStatus: "confirmed",
      });
      const sent = provider.signAndSendTransaction(makeTx(), connection).catch((e: unknown) => e);
      await approveNext(provider);
      const err = await sent;
      expect(err).toBeInstanceOf(TransactionFailedError);
      expect((err as TransactionFailedError).signature).toBe("browserSig");
    });

    it("throws ConfirmationTimeoutError after the configured confirm timeout", async () => {
      const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey, confirmTimeoutMs: 25 });
      const { connection } = stubConnection(null);
      const sent = provider.signAndSendTransaction(makeTx(), connection).catch((e: unknown) => e);
      await approveNext(provider);
      const err = await sent;
      expect(err).toBeInstanceOf(ConfirmationTimeoutError);
      expect((err as ConfirmationTimeoutError).timeoutMs).toBe(25);
    });
  });

  describe("createHandler POST /sign/:id", () => {
    const base = "http://agent.local/api/wallet";

    async function waitForPending(provider: BrowserWalletProvider) {
      for (let i = 0; i < 50 && provider.getPending().length === 0; i++) {
        await new Promise((r) => setImmediate(r));
      }
      return provider.getPending()[0]!;
    }

    function signRequest(provider: BrowserWalletProvider, id: string, signedTransaction: string) {
      return new Request(`${base}/sign/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wallet-session": provider.sessionId },
        body: JSON.stringify({ signedTransaction }),
      });
    }

    function connectionWith(status: unknown) {
      return {
        sendRawTransaction: jest.fn(async () => "handlerSig"),
        getSignatureStatuses: jest.fn(async () => ({ context: { slot: 1 }, value: [status] })),
      } as unknown as Connection;
    }

    it("answers with the signature once the transaction confirms", async () => {
      const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });
      const handler = provider.createHandler("/api/wallet");
      const sent = provider.signAndSendTransaction(
        makeTx(),
        connectionWith({ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }),
      );
      const pending = await waitForPending(provider);
      const res = await handler(signRequest(provider, pending.id, makeSerializedTx()));
      await expect(res.json()).resolves.toEqual({ ok: true, signature: "handlerSig" });
      await expect(sent).resolves.toBe("handlerSig");
    });

    it("answers with the on-chain failure and signature instead of waiting out a timer", async () => {
      const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });
      const handler = provider.createHandler("/api/wallet");
      const sent = provider
        .signAndSendTransaction(
          makeTx(),
          connectionWith({ slot: 1, confirmations: 1, err: { InstructionError: [0, { Custom: 3 }] }, confirmationStatus: "confirmed" }),
        )
        .catch((e: unknown) => e);
      const pending = await waitForPending(provider);
      const res = await handler(signRequest(provider, pending.id, makeSerializedTx()));
      const body = (await res.json()) as { ok: boolean; error: string; signature: string };
      expect(body.ok).toBe(false);
      expect(body.signature).toBe("handlerSig");
      expect(body.error).toContain("failed on-chain");
      expect(await sent).toBeInstanceOf(TransactionFailedError);
    });

    it("answers with the refusal when the browser returns a different transaction", async () => {
      const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });
      const handler = provider.createHandler("/api/wallet");
      const sent = provider.signAndSendTransaction(makeTx(), connectionWith(null)).catch((e: unknown) => e);
      const pending = await waitForPending(provider);
      const other = makeTx();
      other.recentBlockhash = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
      const res = await handler(signRequest(provider, pending.id, signSerialized(other)));
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: "Transaction rejected: Returned transaction does not match the requested transaction",
      });
      expect(await sent).toBeInstanceOf(TransactionRejectedError);
    });

    it("answers a sign-only request as soon as the signature is accepted", async () => {
      const provider = new BrowserWalletProvider({ publicKey: keypair.publicKey });
      const handler = provider.createHandler("/api/wallet");
      const signed = provider.signTransaction(makeTx());
      const pending = await waitForPending(provider);
      const res = await handler(signRequest(provider, pending.id, makeSerializedTx()));
      await expect(res.json()).resolves.toEqual({ ok: true });
      await expect(signed).resolves.toBeInstanceOf(Transaction);
    });
  });
});
