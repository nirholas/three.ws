import { describe, it, expect, jest } from "@jest/globals";
import type { Connection, SignatureStatus } from "@solana/web3.js";
import { confirmSignature } from "../../src/tx/confirm.js";
import { ConfirmationTimeoutError, TransactionFailedError } from "../../src/errors.js";

type Status = Partial<SignatureStatus> | null;

/** Connection stub that replays `statuses` poll by poll (the last one repeats). */
function connectionWith(statuses: Status[], blockHeights: number[] = []) {
  let poll = 0;
  let heightPoll = 0;
  const getSignatureStatuses = jest.fn(async () => {
    const value = statuses[Math.min(poll, statuses.length - 1)] ?? null;
    poll++;
    return { context: { slot: 1 }, value: [value] };
  });
  const getBlockHeight = jest.fn(async () => {
    const h = blockHeights[Math.min(heightPoll, blockHeights.length - 1)] ?? 0;
    heightPoll++;
    return h;
  });
  return {
    connection: { getSignatureStatuses, getBlockHeight } as unknown as Connection,
    getSignatureStatuses,
    getBlockHeight,
  };
}

const at = (confirmationStatus: SignatureStatus["confirmationStatus"], err: unknown = null): Status => ({
  slot: 10,
  confirmations: confirmationStatus === "finalized" ? null : 1,
  err: err as SignatureStatus["err"],
  confirmationStatus,
});

const fast = { pollIntervalMs: 1 };

describe("confirmSignature", () => {
  it("resolves once the signature reaches the requested commitment", async () => {
    const { connection, getSignatureStatuses } = connectionWith([null, at("processed"), at("confirmed")]);
    await expect(confirmSignature(connection, "sig", fast)).resolves.toBeUndefined();
    expect(getSignatureStatuses).toHaveBeenCalledTimes(3);
  });

  it("keeps polling past 'confirmed' when 'finalized' is requested", async () => {
    const { connection, getSignatureStatuses } = connectionWith([at("confirmed"), at("confirmed"), at("finalized")]);
    await confirmSignature(connection, "sig", { ...fast, commitment: "finalized" });
    expect(getSignatureStatuses).toHaveBeenCalledTimes(3);
  });

  it("treats a status with null confirmations and no confirmationStatus as finalized", async () => {
    const { connection } = connectionWith([{ slot: 1, confirmations: null, err: null }]);
    await expect(confirmSignature(connection, "sig", { ...fast, commitment: "finalized" })).resolves.toBeUndefined();
  });

  it("throws TransactionFailedError when the transaction landed with an error", async () => {
    const onChainErr = { InstructionError: [2, { Custom: 6000 }] };
    const { connection } = connectionWith([at("confirmed", onChainErr)]);
    const err = await confirmSignature(connection, "failedSig", fast).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransactionFailedError);
    expect((err as TransactionFailedError).signature).toBe("failedSig");
    expect((err as TransactionFailedError).transactionError).toEqual(onChainErr);
  });

  it("throws ConfirmationTimeoutError when the commitment is not reached in time", async () => {
    const { connection } = connectionWith([null]);
    const started = Date.now();
    const err = await confirmSignature(connection, "slowSig", { timeoutMs: 60, pollIntervalMs: 5 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConfirmationTimeoutError);
    expect((err as ConfirmationTimeoutError).signature).toBe("slowSig");
    expect((err as ConfirmationTimeoutError).timeoutMs).toBe(60);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });

  it("reports block-height expiry so callers can rebuild with a fresh blockhash", async () => {
    const { connection } = connectionWith([null], [100, 151]);
    const err = await confirmSignature(connection, "expiredSig", { ...fast, lastValidBlockHeight: 150 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("block height exceeded");
    expect((err as Error).message).toContain("expiredSig");
  });

  it("does not report expiry when the transaction landed in the final valid block", async () => {
    // First poll: not seen. Height check: expired. Re-check: it landed.
    const { connection } = connectionWith([null, at("confirmed")], [151]);
    await expect(
      confirmSignature(connection, "lastBlockSig", { ...fast, lastValidBlockHeight: 150 }),
    ).resolves.toBeUndefined();
  });

  it("checks block height at the requested commitment", async () => {
    const { connection, getBlockHeight } = connectionWith([null, at("finalized")], [10]);
    await confirmSignature(connection, "sig", { ...fast, commitment: "finalized", lastValidBlockHeight: 50 });
    expect(getBlockHeight).toHaveBeenCalledWith("finalized");
  });
});
