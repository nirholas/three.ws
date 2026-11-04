import { describe, it, expect, jest } from "@jest/globals";
import { Keypair, Transaction, type Connection } from "@solana/web3.js";
import { WalletAdapterProvider, type WalletAdapterLike } from "../../src/wallet/wallet-adapter.js";
import {
  TransactionFailedError,
  WalletCapabilityError,
  WalletNotConnectedError,
} from "../../src/errors.js";

const owner = Keypair.fromSeed(new Uint8Array(32).fill(7));

/** Hand-written double of a @solana/wallet-adapter-base adapter. No network. */
function adapterDouble(overrides: Partial<WalletAdapterLike> = {}): WalletAdapterLike {
  return {
    publicKey: owner.publicKey,
    connected: true,
    signTransaction: async (tx) => tx,
    sendTransaction: async () => "adapterSig",
    ...overrides,
  } as WalletAdapterLike;
}

/** Connection stub that reports the given signature status on every poll. */
function statusConnection(status: unknown): Connection {
  return {
    getSignatureStatuses: jest.fn(async () => ({ context: { slot: 1 }, value: [status] })),
  } as unknown as Connection;
}

describe("WalletAdapterProvider", () => {
  it("exposes the adapter's public key when connected", () => {
    expect(new WalletAdapterProvider(adapterDouble()).publicKey.equals(owner.publicKey)).toBe(true);
  });

  it("throws WalletNotConnectedError when the adapter has no public key", () => {
    const provider = new WalletAdapterProvider(adapterDouble({ publicKey: null, connected: false }));
    expect(() => provider.publicKey).toThrow(WalletNotConnectedError);
  });

  it("throws WalletNotConnectedError before signing on a disconnected adapter", async () => {
    const signTransaction = jest.fn(async <T,>(tx: T) => tx);
    const provider = new WalletAdapterProvider(
      adapterDouble({ publicKey: null, connected: false, signTransaction: signTransaction as never }),
    );
    await expect(provider.signTransaction(new Transaction())).rejects.toThrow(WalletNotConnectedError);
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("throws WalletCapabilityError('signTransaction') when the adapter cannot sign", async () => {
    const provider = new WalletAdapterProvider(adapterDouble({ signTransaction: undefined }));
    const err = await provider.signTransaction(new Transaction()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WalletCapabilityError);
    expect((err as WalletCapabilityError).capability).toBe("signTransaction");
  });

  it("throws WalletCapabilityError('sendTransaction') when the adapter cannot send", async () => {
    const provider = new WalletAdapterProvider(
      adapterDouble({ sendTransaction: undefined as unknown as WalletAdapterLike["sendTransaction"] }),
    );
    const err = await provider
      .signAndSendTransaction(new Transaction(), statusConnection(null))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WalletCapabilityError);
    expect((err as WalletCapabilityError).capability).toBe("sendTransaction");
  });

  it("delegates signing to the adapter", async () => {
    const tx = new Transaction();
    const signTransaction = jest.fn(async <T,>(t: T) => t);
    const provider = new WalletAdapterProvider(adapterDouble({ signTransaction: signTransaction as never }));
    await expect(provider.signTransaction(tx)).resolves.toBe(tx);
    expect(signTransaction).toHaveBeenCalledWith(tx);
  });

  it("waits for confirmation after the adapter sends", async () => {
    const connection = statusConnection({ slot: 9, confirmations: 1, err: null, confirmationStatus: "confirmed" });
    const provider = new WalletAdapterProvider(adapterDouble());
    await expect(provider.signAndSendTransaction(new Transaction(), connection)).resolves.toBe("adapterSig");
    expect(connection.getSignatureStatuses).toHaveBeenCalledWith(["adapterSig"]);
  });

  it("throws TransactionFailedError when the sent transaction fails on-chain", async () => {
    const connection = statusConnection({
      slot: 9,
      confirmations: 1,
      err: { InstructionError: [0, { Custom: 1 }] },
      confirmationStatus: "confirmed",
    });
    const provider = new WalletAdapterProvider(adapterDouble());
    const err = await provider.signAndSendTransaction(new Transaction(), connection).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransactionFailedError);
    expect((err as TransactionFailedError).signature).toBe("adapterSig");
  });

  it("stores and returns the next transaction metadata", () => {
    const provider = new WalletAdapterProvider(adapterDouble());
    expect(provider.getNextMeta()).toBeNull();
    provider.setNextMeta({ label: "Send 1 SOL", kind: "transfer" });
    expect(provider.getNextMeta()).toEqual({ label: "Send 1 SOL", kind: "transfer" });
  });
});
