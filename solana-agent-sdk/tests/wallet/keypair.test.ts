import { describe, it, expect, jest } from "@jest/globals";
import { Keypair, SystemProgram, Transaction, VersionedTransaction, TransactionMessage } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { KeypairWalletProvider } from "../../src/wallet/keypair.js";
import { ConfirmationTimeoutError, TransactionFailedError } from "../../src/errors.js";

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

  it("signTransaction (legacy) keeps a co-signer's existing partial signature", async () => {
    const provider = new KeypairWalletProvider(keypair.secretKey);
    const coSigner = Keypair.generate();
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: keypair.publicKey,
        newAccountPubkey: coSigner.publicKey,
        lamports: 1_000_000,
        space: 0,
        programId: SystemProgram.programId,
      }),
    );
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.feePayer = keypair.publicKey;
    tx.partialSign(coSigner);

    const signed = await provider.signTransaction(tx);
    expect(signed.verifySignatures()).toBe(true);
  });

  describe("signAndSendTransaction", () => {
    function stubConnection(status: unknown) {
      const sendRawTransaction = jest.fn(async (raw: Buffer | Uint8Array) => {
        void raw;
        return "sentSig";
      });
      const getSignatureStatuses = jest.fn(async (_signatures: string[]) => ({ context: { slot: 1 }, value: [status] }));
      const getBlockHeight = jest.fn(async () => 1);
      const connection = { sendRawTransaction, getSignatureStatuses, getBlockHeight } as unknown as Connection;
      return { connection, sendRawTransaction, getSignatureStatuses };
    }
    const confirmed = { slot: 5, confirmations: 1, err: null, confirmationStatus: "confirmed" };
    const failed = { slot: 5, confirmations: 1, err: { InstructionError: [0, { Custom: 1 }] }, confirmationStatus: "confirmed" };

    function legacyTx(): Transaction {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
      );
      tx.recentBlockhash = "11111111111111111111111111111111";
      tx.lastValidBlockHeight = 100;
      tx.feePayer = keypair.publicKey;
      return tx;
    }

    function versionedTx(): VersionedTransaction {
      return new VersionedTransaction(
        new TransactionMessage({
          payerKey: keypair.publicKey,
          recentBlockhash: "11111111111111111111111111111111",
          instructions: [],
        }).compileToV0Message(),
      );
    }

    it("sends a fully signed legacy transaction and waits for confirmation", async () => {
      const provider = new KeypairWalletProvider(keypair.secretKey);
      const { connection, sendRawTransaction, getSignatureStatuses } = stubConnection(confirmed);
      const tx = legacyTx();

      await expect(provider.signAndSendTransaction(tx, connection)).resolves.toBe("sentSig");

      const raw = sendRawTransaction.mock.calls[0]![0];
      expect(Transaction.from(Buffer.from(raw)).verifySignatures()).toBe(true);
      expect(getSignatureStatuses).toHaveBeenCalledWith(["sentSig"]);
    });

    it("throws TransactionFailedError when a legacy transaction fails on-chain", async () => {
      const provider = new KeypairWalletProvider(keypair.secretKey);
      const { connection } = stubConnection(failed);
      await expect(provider.signAndSendTransaction(legacyTx(), connection)).rejects.toThrow(TransactionFailedError);
    });

    it("throws TransactionFailedError when a versioned transaction fails on-chain", async () => {
      const provider = new KeypairWalletProvider(keypair.secretKey);
      const { connection } = stubConnection(failed);
      const err = await provider.signAndSendTransaction(versionedTx(), connection).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TransactionFailedError);
      expect((err as TransactionFailedError).signature).toBe("sentSig");
    });

    it("throws ConfirmationTimeoutError when confirmation does not land in time", async () => {
      const provider = new KeypairWalletProvider(keypair.secretKey, { confirmTimeoutMs: 30 });
      const { connection } = stubConnection(null);
      const err = await provider.signAndSendTransaction(versionedTx(), connection).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConfirmationTimeoutError);
      expect((err as ConfirmationTimeoutError).timeoutMs).toBe(30);
    });

    it("lets per-call confirm options override the provider default", async () => {
      const provider = new KeypairWalletProvider(keypair.secretKey, { confirmTimeoutMs: 60_000 });
      const { connection } = stubConnection(null);
      const err = await provider
        .signAndSendTransaction(versionedTx(), connection, { timeoutMs: 20 })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConfirmationTimeoutError);
      expect((err as ConfirmationTimeoutError).timeoutMs).toBe(20);
    });
  });
});
