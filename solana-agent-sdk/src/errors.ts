/**
 * Typed errors thrown by @three-ws/solana-agent.
 *
 * Two properties make these safe to branch on in consumer code:
 *
 * - `name` is a fixed string per class, not `constructor.name`. The published
 *   build is minified, which renames classes, so a name derived from the
 *   constructor would come out as a single letter.
 * - `instanceof` works across bundled copies. Each subpath entry (`/wallet`,
 *   `/x402-exact`, `/vanity`) inlines its own copy of this module, so an error
 *   thrown by one copy is a different class identity from the root's. Every
 *   instance carries a brand from the global symbol registry and every class a
 *   kind tag, and `Symbol.hasInstance` matches on those when the native check
 *   fails. A plain `Error` with a copied `name` never matches.
 */

const BRAND: unique symbol = Symbol.for("@three-ws/solana-agent/error");
const KIND: unique symbol = Symbol.for("@three-ws/solana-agent/error-kind");

/** The kind tag a class declares itself, ignoring any inherited from a parent. */
function ownKind(ctor: unknown): string | undefined {
  if (typeof ctor !== "function" || !Object.prototype.hasOwnProperty.call(ctor, KIND)) return undefined;
  return (ctor as unknown as Record<typeof KIND, string>)[KIND];
}

/** JSON.stringify that renders bigints (common in decoded instruction errors) as decimal strings. */
function describe(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)) ?? String(value);
  } catch {
    return String(value);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Base class for all @three-ws/solana-agent errors */
export class SolanaAgentError extends Error {
  static readonly [KIND]: string = "SolanaAgentError";

  constructor(message: string) {
    super(message);
    // A consumer subclass has no kind tag of its own, so it is named after itself.
    this.name = ownKind(new.target) ?? new.target.name;
    Object.defineProperty(this, BRAND, { value: true, enumerable: false });
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    if (typeof this !== "function") return false;
    if (Function.prototype[Symbol.hasInstance].call(this, value)) return true;
    if (value === null || typeof value !== "object" || !(value as Record<symbol, unknown>)[BRAND]) return false;
    const kind = ownKind(this);
    if (kind === undefined) return false;
    for (let proto = Object.getPrototypeOf(value); proto; proto = Object.getPrototypeOf(proto)) {
      if (ownKind((proto as { constructor?: unknown }).constructor) === kind) return true;
    }
    return false;
  }
}

/** Thrown when a transaction is rejected by the user (browser wallet) or timed out waiting for approval */
export class TransactionRejectedError extends SolanaAgentError {
  static readonly [KIND]: string = "TransactionRejectedError";
  constructor(public readonly reason: string = "User rejected") {
    super(`Transaction rejected: ${reason}`);
  }
}

/** Thrown when a wallet is not connected (WalletAdapterProvider with null publicKey) */
export class WalletNotConnectedError extends SolanaAgentError {
  static readonly [KIND]: string = "WalletNotConnectedError";
  constructor() {
    super("Wallet is not connected");
  }
}

/** Thrown when a wallet adapter does not support a required operation */
export class WalletCapabilityError extends SolanaAgentError {
  static readonly [KIND]: string = "WalletCapabilityError";
  constructor(public readonly capability: string) {
    super(`Wallet does not support: ${capability}`);
  }
}

/** Thrown when a sender has no token account for the given mint */
export class MissingTokenAccountError extends SolanaAgentError {
  static readonly [KIND]: string = "MissingTokenAccountError";
  constructor(public readonly mint: string, public readonly owner: string) {
    super(`No token account for mint ${mint} owned by ${owner}`);
  }
}

/** Thrown when a Jupiter swap quote or swap request fails, or a swap transaction does not match its quote */
export class SwapError extends SolanaAgentError {
  static readonly [KIND]: string = "SwapError";
  constructor(
    message: string,
    public readonly inputMint?: string,
    public readonly outputMint?: string,
  ) {
    super(message);
  }
}

/** Thrown when transaction simulation fails before submission */
export class SimulationError extends SolanaAgentError {
  static readonly [KIND]: string = "SimulationError";
  constructor(public readonly simulationError: unknown) {
    super(`Transaction simulation failed: ${describe(simulationError)}`);
  }
}

/** Thrown when a transaction is not confirmed within the timeout period */
export class ConfirmationTimeoutError extends SolanaAgentError {
  static readonly [KIND]: string = "ConfirmationTimeoutError";
  constructor(public readonly signature: string, public readonly timeoutMs: number) {
    super(`Transaction ${signature} not confirmed within ${timeoutMs}ms`);
  }
}

/** Thrown when a transaction landed on-chain but its execution failed */
export class TransactionFailedError extends SolanaAgentError {
  static readonly [KIND]: string = "TransactionFailedError";
  constructor(public readonly signature: string, public readonly transactionError: unknown) {
    super(`Transaction ${signature} failed on-chain: ${describe(transactionError)}`);
  }
}

/** Thrown when every send attempt's blockhash expired before the transaction landed */
export class RetriesExhaustedError extends SolanaAgentError {
  static readonly [KIND]: string = "RetriesExhaustedError";
  constructor(
    public readonly attempts: number,
    public readonly lastBlockhash: string,
    public readonly lastError: unknown,
  ) {
    super(
      `Transaction did not land after ${attempts} attempts (last blockhash ${lastBlockhash}): ${messageOf(lastError)}`,
    );
  }
}

/** Thrown when an address lookup table account does not exist */
export class LookupTableNotFoundError extends SolanaAgentError {
  static readonly [KIND]: string = "LookupTableNotFoundError";
  constructor(public readonly address: string) {
    super(`Lookup table not found: ${address}`);
  }
}

/** Thrown when a mint account does not exist */
export class MintNotFoundError extends SolanaAgentError {
  static readonly [KIND]: string = "MintNotFoundError";
  constructor(public readonly mint: string) {
    super(`Mint not found: ${mint}`);
  }
}

/** Thrown when an account passed as a mint is not owned by SPL Token or Token-2022 */
export class NotATokenMintError extends SolanaAgentError {
  static readonly [KIND]: string = "NotATokenMintError";
  constructor(public readonly mint: string, public readonly owner: string) {
    super(`Not an SPL token mint (owner ${owner}): ${mint}`);
  }
}

/** Thrown when a caller-supplied argument is malformed or out of range, before anything is sent */
export class InvalidInputError extends SolanaAgentError {
  static readonly [KIND]: string = "InvalidInputError";
  constructor(public readonly param: string, message: string) {
    super(message);
  }
}

/** Thrown when an HTTP request to a three.ws service returns a non-2xx status */
export class RequestFailedError extends SolanaAgentError {
  static readonly [KIND]: string = "RequestFailedError";
  constructor(public readonly url: string, public readonly status: number, public readonly detail: string = "") {
    super(`Request to ${url} failed with status ${status}${detail ? `: ${detail}` : ""}`);
  }
}

/** Thrown when a vanity receipt fails independent verification; `failures` lists each failed check */
export class ReceiptVerificationError extends SolanaAgentError {
  static readonly [KIND]: string = "ReceiptVerificationError";
  constructor(public readonly failures: string[]) {
    super(`Receipt failed verification: ${failures.join("; ")}`);
  }
}
