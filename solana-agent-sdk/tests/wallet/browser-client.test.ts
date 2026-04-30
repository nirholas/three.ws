import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { BrowserWalletClient, type SignerFn } from "../../src/wallet/browser-client.js";

const baseUrl = "http://localhost:3000/api/wallet";

// Flush all pending microtasks so async chains driven by resolved promises complete.
const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

type MockEs = {
  onmessage: ((e: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof jest.fn>;
};

describe("BrowserWalletClient", () => {
  let mockEs: MockEs;

  beforeEach(() => {
    mockEs = { onmessage: null, onerror: null, close: jest.fn() };
    (globalThis as Record<string, unknown>)["EventSource"] = jest
      .fn()
      .mockImplementation(() => mockEs);
    // Cast through unknown so TypeScript accepts the partial Response mock.
    (globalThis as Record<string, unknown>)["fetch"] = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ signature: "abc" }),
        }),
      ) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // Builds a pending-tx payload with a properly serialized Transaction and a
  // matching signer that signs with the same keypair (feePayer = kp.publicKey).
  function makePending() {
    const kp = Keypair.generate();
    const tx = new Transaction();
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.feePayer = kp.publicKey;
    const b64 = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64");

    const signerImpl = async (decoded: Transaction | VersionedTransaction) => {
      if (decoded instanceof Transaction) decoded.sign(kp);
      return decoded;
    };
    const signerMock = jest.fn().mockImplementation(signerImpl as () => unknown);
    const signer = signerMock as unknown as SignerFn;

    return {
      pending: { id: "tx-001", transaction: b64, versioned: false, createdAt: Date.now() },
      signer,
      signerMock,
    };
  }

  function noopSigner(): SignerFn {
    return jest.fn() as unknown as SignerFn;
  }

  it("connect() opens EventSource at baseUrl + '/stream'", () => {
    const client = new BrowserWalletClient(baseUrl, noopSigner());
    client.connect();
    expect(
      (globalThis as Record<string, unknown>)["EventSource"] as ReturnType<typeof jest.fn>,
    ).toHaveBeenCalledWith(`${baseUrl}/stream`);
  });

  it("disconnect() closes the EventSource", () => {
    const client = new BrowserWalletClient(baseUrl, noopSigner());
    client.connect();
    client.disconnect();
    expect(mockEs.close).toHaveBeenCalled();
  });

  it("onmessage triggers the signer", async () => {
    const { pending, signer, signerMock } = makePending();
    const client = new BrowserWalletClient(baseUrl, signer);
    client.connect();

    mockEs.onmessage!({ data: JSON.stringify(pending) });
    await flushPromises();

    expect(signerMock).toHaveBeenCalledTimes(1);
  });

  it("auto-signs without onApproval: signer is called immediately", async () => {
    const { pending, signer, signerMock } = makePending();
    const client = new BrowserWalletClient(baseUrl, signer);
    client.connect();

    mockEs.onmessage!({ data: JSON.stringify(pending) });
    await flushPromises();

    expect(signerMock).toHaveBeenCalled();
  });

  it("onApproval blocks signing until approve() is called", async () => {
    const { pending, signer, signerMock } = makePending();
    let doApprove!: () => void;
    const client = new BrowserWalletClient(baseUrl, signer, {
      onApproval: (_p, approve) => { doApprove = approve; },
    });
    client.connect();

    mockEs.onmessage!({ data: JSON.stringify(pending) });
    await flushPromises();
    expect(signerMock).not.toHaveBeenCalled();

    doApprove();
    await flushPromises();
    expect(signerMock).toHaveBeenCalled();
  });

  it("onApproval reject path: calls /reject/:id endpoint, signer not called", async () => {
    const { pending, signer, signerMock } = makePending();
    let doReject!: () => void;
    const client = new BrowserWalletClient(baseUrl, signer, {
      onApproval: (_p, _approve, reject) => { doReject = reject; },
    });
    client.connect();

    mockEs.onmessage!({ data: JSON.stringify(pending) });
    doReject();
    await flushPromises();

    expect(
      (globalThis as Record<string, unknown>)["fetch"] as ReturnType<typeof jest.fn>,
    ).toHaveBeenCalledWith(`${baseUrl}/reject/${pending.id}`, { method: "POST" });
    expect(signerMock).not.toHaveBeenCalled();
  });

  it("onConfirmed fires when the sign POST returns a signature", async () => {
    const { pending, signer } = makePending();
    const onConfirmed = jest.fn();
    const client = new BrowserWalletClient(baseUrl, signer, { onConfirmed });
    client.connect();

    mockEs.onmessage!({ data: JSON.stringify(pending) });
    await flushPromises();

    expect(onConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ id: pending.id }),
      "abc",
    );
  });

  it("reconnects on error: new EventSource created after reconnectMs", () => {
    jest.useFakeTimers();
    const client = new BrowserWalletClient(baseUrl, noopSigner(), { reconnectMs: 100 });
    client.connect();

    const EventSourceMock = (globalThis as Record<string, unknown>)["EventSource"] as ReturnType<
      typeof jest.fn
    >;
    expect(EventSourceMock).toHaveBeenCalledTimes(1);

    mockEs.onerror!();
    jest.advanceTimersByTime(100);

    expect(EventSourceMock).toHaveBeenCalledTimes(2);
  });
});
