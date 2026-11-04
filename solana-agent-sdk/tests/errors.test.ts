import { describe, it, expect, jest } from "@jest/globals";
import * as errors from "../src/errors.js";
import * as root from "../src/index.js";

const {
  SolanaAgentError,
  TransactionRejectedError,
  WalletNotConnectedError,
  WalletCapabilityError,
  MissingTokenAccountError,
  SwapError,
  SimulationError,
  ConfirmationTimeoutError,
  TransactionFailedError,
  RetriesExhaustedError,
  LookupTableNotFoundError,
  MintNotFoundError,
  NotATokenMintError,
  InvalidInputError,
  RequestFailedError,
  ReceiptVerificationError,
} = errors;

const THREE_MINT = "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump";

const cases: Array<[string, () => Error]> = [
  ["SolanaAgentError", () => new SolanaAgentError("base")],
  ["TransactionRejectedError", () => new TransactionRejectedError()],
  ["WalletNotConnectedError", () => new WalletNotConnectedError()],
  ["WalletCapabilityError", () => new WalletCapabilityError("signTransaction")],
  ["MissingTokenAccountError", () => new MissingTokenAccountError(THREE_MINT, "owner")],
  ["SwapError", () => new SwapError("bad swap")],
  ["SimulationError", () => new SimulationError({ InstructionError: [0, "Custom"] })],
  ["ConfirmationTimeoutError", () => new ConfirmationTimeoutError("sig", 5_000)],
  ["TransactionFailedError", () => new TransactionFailedError("sig", { InstructionError: [1, { Custom: 1 }] })],
  ["RetriesExhaustedError", () => new RetriesExhaustedError(3, "hash", new Error("block height exceeded"))],
  ["LookupTableNotFoundError", () => new LookupTableNotFoundError("alt")],
  ["MintNotFoundError", () => new MintNotFoundError(THREE_MINT)],
  ["NotATokenMintError", () => new NotATokenMintError(THREE_MINT, "11111111111111111111111111111111")],
  ["InvalidInputError", () => new InvalidInputError("amount", "amount must be positive")],
  ["RequestFailedError", () => new RequestFailedError("https://three.ws/x", 502, "upstream")],
  ["ReceiptVerificationError", () => new ReceiptVerificationError(["sig: bad"])],
];

describe("error classes", () => {
  it.each(cases)("%s has its own name and is a SolanaAgentError", (name, make) => {
    const err = make();
    expect(err.name).toBe(name);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SolanaAgentError);
    expect(err.message.length).toBeGreaterThan(0);
    expect(String(err)).toContain(name);
  });

  it.each(cases)("%s is re-exported from the package root", (name) => {
    expect((root as Record<string, unknown>)[name]).toBe((errors as Record<string, unknown>)[name]);
  });

  it("keeps the class name when a minifier renames the constructor", () => {
    // `tsup --minify` (build:prod, the published build) renames classes, so a
    // name derived from `constructor.name` comes out as a single letter.
    // Simulate that rename on the SDK's own classes and confirm the reported
    // name is unaffected.
    for (const [Cls, make] of [
      [WalletNotConnectedError, () => new WalletNotConnectedError()],
      [WalletCapabilityError, () => new WalletCapabilityError("signTransaction")],
    ] as const) {
      const real = Cls.name;
      Object.defineProperty(Cls, "name", { value: "Z", configurable: true });
      try {
        expect(make().name).toBe(real);
      } finally {
        Object.defineProperty(Cls, "name", { value: real, configurable: true });
      }
    }
  });

  it("names a consumer subclass after the subclass", () => {
    class AppError extends SolanaAgentError {}
    const err = new AppError("app");
    expect(err.name).toBe("AppError");
    expect(err).toBeInstanceOf(SolanaAgentError);
    expect(new SolanaAgentError("x")).not.toBeInstanceOf(AppError);
  });

  it("carries structured fields", () => {
    expect(new TransactionRejectedError("timeout").reason).toBe("timeout");
    expect(new WalletCapabilityError("sendTransaction").capability).toBe("sendTransaction");
    const missing = new MissingTokenAccountError(THREE_MINT, "ownerKey");
    expect([missing.mint, missing.owner]).toEqual([THREE_MINT, "ownerKey"]);
    const swap = new SwapError("x", "in", "out");
    expect([swap.inputMint, swap.outputMint]).toEqual(["in", "out"]);
    const sim = new SimulationError({ InstructionError: [0, "Custom"] });
    expect(sim.simulationError).toEqual({ InstructionError: [0, "Custom"] });
    const timeout = new ConfirmationTimeoutError("sigX", 1234);
    expect([timeout.signature, timeout.timeoutMs]).toEqual(["sigX", 1234]);
    expect(timeout.message).toContain("1234ms");
    const failed = new TransactionFailedError("sigY", { InstructionError: [1, { Custom: 6001 }] });
    expect(failed.signature).toBe("sigY");
    expect(failed.transactionError).toEqual({ InstructionError: [1, { Custom: 6001 }] });
    expect(failed.message).toContain("6001");
    const cause = new Error("Signature abc has expired: block height exceeded.");
    const exhausted = new RetriesExhaustedError(4, "lastHash", cause);
    expect([exhausted.attempts, exhausted.lastBlockhash, exhausted.lastError]).toEqual([4, "lastHash", cause]);
    expect(exhausted.message).toContain("4 attempts");
    expect(exhausted.message).toContain("block height exceeded");
    expect(new LookupTableNotFoundError("altAddr").address).toBe("altAddr");
    expect(new MintNotFoundError(THREE_MINT).mint).toBe(THREE_MINT);
    const notMint = new NotATokenMintError(THREE_MINT, "ownerProgram");
    expect([notMint.mint, notMint.owner]).toEqual([THREE_MINT, "ownerProgram"]);
    expect(new InvalidInputError("amount", "bad").param).toBe("amount");
    const req = new RequestFailedError("https://three.ws/api/x", 503, "busy");
    expect([req.url, req.status, req.detail]).toEqual(["https://three.ws/api/x", 503, "busy"]);
    expect(new ReceiptVerificationError(["a: no", "b: no"]).failures).toEqual(["a: no", "b: no"]);
  });

  it("serializes simulation and on-chain errors that contain bigints", () => {
    expect(() => new SimulationError({ amount: 10n })).not.toThrow();
    expect(new SimulationError({ amount: 10n }).message).toContain("10");
    expect(new TransactionFailedError("s", { amount: 2n ** 64n }).message).toContain("18446744073709551616");
  });

  it("recognizes an error thrown by another bundled copy of the SDK", async () => {
    // Each subpath entry (/wallet, /x402-exact, /vanity) is bundled with
    // --no-splitting, so it carries its own copy of these classes. An error
    // thrown by the /wallet copy must still match the root's classes.
    const copy = await loadSecondCopy();
    expect(copy.WalletNotConnectedError).not.toBe(WalletNotConnectedError);
    const err = new copy.WalletNotConnectedError();
    expect(err).toBeInstanceOf(WalletNotConnectedError);
    expect(err).toBeInstanceOf(SolanaAgentError);
    expect(err).not.toBeInstanceOf(WalletCapabilityError);
    expect(new WalletNotConnectedError()).toBeInstanceOf(copy.SolanaAgentError);
  });

  it("does not match plain errors or look-alikes without the SDK brand", () => {
    const lookAlike = new Error("Wallet is not connected");
    lookAlike.name = "WalletNotConnectedError";
    expect(lookAlike).not.toBeInstanceOf(WalletNotConnectedError);
    expect(lookAlike).not.toBeInstanceOf(SolanaAgentError);
    expect(null as unknown).not.toBeInstanceOf(SolanaAgentError);
    expect("WalletNotConnectedError" as unknown).not.toBeInstanceOf(SolanaAgentError);
  });
});

/**
 * Load a second, independent instance of src/errors.ts, the same situation a
 * consumer hits when two tsup entries each inline their own copy.
 */
async function loadSecondCopy(): Promise<typeof errors> {
  let copy: typeof errors | undefined;
  await jest.isolateModulesAsync(async () => {
    copy = (await import("../src/errors.js")) as typeof errors;
  });
  if (!copy) throw new Error("isolateModulesAsync did not load a second copy");
  return copy;
}
