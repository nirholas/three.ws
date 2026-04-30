import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { BrowserWalletClient } from "../../src/wallet/browser-client.js";

const baseUrl = "http://localhost:3000/api/wallet";

// Flush all pending microtasks and macro-tasks in the queue.
const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

type MockEsInstance = {
  onmessage: ((e: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: jest.Mock;
};

describe("BrowserWalletClient", () => {
  let mockEs: MockEsInstance;

  beforeEach(() => {
    mockEs = { onmessage: null, onerror: null, close: jest.fn() };
    (global as Record<string, unknown>)["EventSource"] = jest
      .fn()
      .mockImplementation(() => mockEs);
    (global as Record<string, unknown>)["fetch"] = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ signature: "abc" }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // Build a pending-tx payload with a real serialized Transaction.
  function makePending() {
    const kp = Keypair.generate();
    const tx = new Transaction();
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.feePayer = kp.publicKey;
    const b64 = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64");
    const signer = jest.fn().mockImplementation(
      async (decoded: Transaction | VersionedTransaction) => {
        if (decoded instanceof Transaction) decoded.sign(kp);
        return decoded;
      },
    );
    return {
      pending: { id: "tx-001", transaction: b64, versioned: false, createdAt: Date.now() },
      signer,
    };
  }

  it("connect() opens EventSource at baseUrl + '/stream'", () => {
    const client = new BrowserWalletClient(baseUrl, jest.fn());
    client.connect();
    expect(
      (global as Record<string, unknown>)["EventSource"] as jest.Mock,
    ).toHaveBeenCalledWith(`${baseUrl}/stream`);
  });

  it("disconnect() closes the EventSource", () => {
    const client = new BrowserWalletClient(baseUrl, jest.fn());
    client.connect();
    client.disconnect();
    expect(mockEs.close).toHaveBeenCalled();
  });

  it("onmessage triggers the signer", async () => {
    const { pending, signer } = makePending();
    const client = new BrowserWalletClient(baseUrl, signer);
    client.connect();

    mockEs.onmessage!({ data: JSON.stringify(pending) });
    await flushPromises();

    expect(signer).toHaveBeenCalledTimes(1);
  });

  it("auto-signs without onApproval: signer is called immediately", async () => {
    const { pending, signer } = makePending();
    const client = new BrowserWalletClient(baseUrl, signer);
    client.connect();

    mockEs.onmessage!({ data: JSON.stringify(pending) });
    await flushPromises();

    expect(signer).toHaveBeenCalled();
  });

  it("onApproval blocks signing until approve() is called", async () => {
    const { pending, signer } = makePending();
    let doApprove!: () => void;
    const client = new BrowserWalletClient(baseUrl, signer, {
      onApproval: (_p, approve) => { doApprove = approve; },
    });
    client.connect();

    mockEs.onmessage!({ data: JSON.stringify(pending) });
    await flushPromises();
    expect(signer).not.toHaveBeenCalled();

    doApprove();
    await flushPromises();
    expect(signer).toHaveBeenCalled();
  });

  it("onApproval reject path: calls /reject/:id endpoint, signer not called", async () => {
    const { pending, signer } = makePending();
    let doReject!: () => void;
    const client = new BrowserWalletClient(baseUrl, signer, {
      onApproval: (_p, _approve, reject) => { doReject = reject; },
    });
    client.connect();

    mockEs.onmessage!({ data: JSON.stringify(pending) });
    doReject();
    await flushPromises();

    expect(
      (global as Record<string, unknown>)["fetch"] as jest.Mock,
    ).toHaveBeenCalledWith(`${baseUrl}/reject/${pending.id}`, { method: "POST" });
    expect(signer).not.toHaveBeenCalled();
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
    const client = new BrowserWalletClient(baseUrl, jest.fn(), { reconnectMs: 100 });
    client.connect();

    const EventSourceMock = (global as Record<string, unknown>)["EventSource"] as jest.Mock;
    expect(EventSourceMock).toHaveBeenCalledTimes(1);

    mockEs.onerror!();
    jest.advanceTimersByTime(100);

    expect(EventSourceMock).toHaveBeenCalledTimes(2);
  });
});
