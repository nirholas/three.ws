// Typed errors for @three-ws/agents.
//
// Every HTTP failure surfaces as a subclass of ThreeAgentsError carrying the
// HTTP status, the stable error code from the v1 envelope, the request id (quote
// it to support), the envelope's `details`, and the rate-limit headers the
// server sent. On-chain failures reuse the error classes of
// @three-ws/solana-agent (bundled from its source at build time, so this
// package still has zero runtime dependencies) and carry the same fields.

import {
  SolanaAgentError,
  SwapError,
  SimulationError,
  ConfirmationTimeoutError,
  TransactionRejectedError,
} from "../../../solana-agent-sdk/src/errors";

export {
  SolanaAgentError,
  SwapError,
  SimulationError,
  ConfirmationTimeoutError,
  TransactionRejectedError,
  WalletNotConnectedError,
  WalletCapabilityError,
  MissingTokenAccountError,
} from "../../../solana-agent-sdk/src/errors";

/** Rate-limit state read from the RateLimit-* headers of the failing response. */
export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  /** Seconds until the window resets. */
  reset: number | null;
}

/** Fields every error from this SDK carries, including the on-chain classes. */
export interface ErrorContext {
  status?: number;
  code?: string;
  requestId?: string | null;
  details?: unknown;
  rateLimit?: RateLimitInfo | null;
  method?: string;
  path?: string;
}

/** Base class for every HTTP, validation and transport error thrown by the client. */
export class ThreeAgentsError extends Error {
  /** HTTP status, or undefined when the request never got a response. */
  readonly status: number | undefined;
  /** Stable machine-readable code from the error envelope, e.g. `not_found`. */
  readonly code: string;
  /** Server request id (X-Request-Id). Include it in support requests. */
  readonly requestId: string | null;
  /** The envelope's `details` value, verbatim. */
  readonly details: unknown;
  /** RateLimit-* headers from the failing response, when the server sent them. */
  readonly rateLimit: RateLimitInfo | null;
  readonly method: string | undefined;
  readonly path: string | undefined;

  constructor(message: string, ctx: ErrorContext = {}) {
    super(message);
    this.name = new.target.name;
    this.status = ctx.status;
    this.code = ctx.code ?? "error";
    this.requestId = ctx.requestId ?? null;
    this.details = ctx.details;
    this.rateLimit = ctx.rateLimit ?? null;
    this.method = ctx.method;
    this.path = ctx.path;
  }
}

/** 401: the API key is missing, malformed, revoked or expired. */
export class AuthenticationError extends ThreeAgentsError {}

/** 403: the key is valid but lacks a scope, or the resource belongs to someone else. */
export class PermissionError extends ThreeAgentsError {
  /** The OAuth scope the route requires, when the failure was a missing scope. */
  readonly scope: string | null;
  constructor(message: string, ctx: ErrorContext & { scope?: string | null } = {}) {
    super(message, ctx);
    this.scope = ctx.scope ?? null;
  }
}

/** 404: the agent, run, automation or skill does not exist or is not yours. */
export class NotFoundError extends ThreeAgentsError {}

/** One invalid field reported by a 400 / 422 response. */
export interface FieldError {
  field: string;
  message: string;
}

/** 400 / 422: the request body or query failed validation. */
export class ValidationError extends ThreeAgentsError {
  readonly fields: FieldError[];
  constructor(message: string, ctx: ErrorContext & { fields?: FieldError[] } = {}) {
    super(message, ctx);
    this.fields = ctx.fields ?? [];
  }
}

/** 429: too many requests. Wait `retryAfter` seconds before trying again. */
export class RateLimitError extends ThreeAgentsError {
  readonly retryAfter: number | null;
  constructor(message: string, ctx: ErrorContext & { retryAfter?: number | null } = {}) {
    super(message, ctx);
    this.retryAfter = ctx.retryAfter ?? null;
  }
}

/** 402 or an insufficient-balance code: credits or wallet funds do not cover the call. */
export class InsufficientFundsError extends ThreeAgentsError {}

/**
 * A fund-moving call was made without its explicit confirm flag. Thrown by the
 * client before any request is sent, and mapped from the server's
 * `confirmation_required` code.
 */
export class ConfirmationRequiredError extends ThreeAgentsError {
  /** The flag that must be set to `true`, e.g. `confirm`. */
  readonly confirmFlag: string;
  /** The client method that previews the action and returns the quote to confirm. */
  readonly previewMethod: string;
  constructor(
    message: string,
    ctx: ErrorContext & { confirmFlag: string; previewMethod: string },
  ) {
    super(message, { code: "confirmation_required", ...ctx });
    this.confirmFlag = ctx.confirmFlag;
    this.previewMethod = ctx.previewMethod;
  }
}

/** 5xx after every retry was spent. */
export class ServerError extends ThreeAgentsError {}

/** The request did not finish within `timeout` ms, after every retry was spent. */
export class TimeoutError extends ThreeAgentsError {
  readonly timeoutMs: number;
  constructor(message: string, ctx: ErrorContext & { timeoutMs: number }) {
    super(message, { code: "timeout", ...ctx });
    this.timeoutMs = ctx.timeoutMs;
  }
}

/** The server could not be reached (DNS, TLS, connection reset), after every retry. */
export class ConnectionError extends ThreeAgentsError {}

/** The on-chain classes, decorated with the same request context as HTTP errors. */
export type OnChainError = SolanaAgentError & ErrorContext;

function decorate<T extends SolanaAgentError>(err: T, ctx: ErrorContext): T & ErrorContext {
  return Object.assign(err, {
    status: ctx.status,
    code: ctx.code,
    requestId: ctx.requestId ?? null,
    details: ctx.details,
    rateLimit: ctx.rateLimit ?? null,
    method: ctx.method,
    path: ctx.path,
  });
}

function detailString(details: unknown, key: string): string | undefined {
  if (details && typeof details === "object" && key in details) {
    const v = (details as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function detailNumber(details: unknown, key: string): number | undefined {
  if (details && typeof details === "object" && key in details) {
    const v = Number((details as Record<string, unknown>)[key]);
    if (Number.isFinite(v)) return v;
  }
  return undefined;
}

/** Normalise the many shapes a validation `details` value takes into field errors. */
export function fieldErrorsFrom(details: unknown, message = "invalid"): FieldError[] {
  if (!details || typeof details !== "object") return [];
  const d = details as Record<string, unknown>;
  // The v1 router's input helpers report one field as { parameter: name }.
  if (typeof d.parameter === "string") return [{ field: d.parameter, message }];
  const list = Array.isArray(details)
    ? details
    : Array.isArray(d.fields)
      ? d.fields
      : Array.isArray(d.issues)
        ? d.issues
        : null;
  if (list) {
    return list
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({
        field: Array.isArray(x.path) ? x.path.join(".") : String(x.field ?? x.path ?? ""),
        message: String(x.message ?? "invalid"),
      }));
  }
  if (d.fieldErrors && typeof d.fieldErrors === "object") {
    return Object.entries(d.fieldErrors as Record<string, unknown>).flatMap(([field, msgs]) =>
      (Array.isArray(msgs) ? msgs : [msgs]).map((m) => ({ field, message: String(m) })),
    );
  }
  return [];
}

const INSUFFICIENT_CODES = new Set([
  "insufficient_funds",
  "insufficient_credits",
  "insufficient_balance",
  "payment_required",
  "budget_exhausted",
]);

/**
 * Build the right error for a non-2xx response. `retryAfter` is the parsed
 * Retry-After value in seconds.
 */
export function errorFromResponse(
  message: string,
  ctx: ErrorContext & { status: number; retryAfter?: number | null },
): ThreeAgentsError | OnChainError {
  const { status, code = "error", details } = ctx;

  switch (code) {
    case "swap_failed":
      return decorate(
        new SwapError(message, detailString(details, "inputMint"), detailString(details, "outputMint")),
        ctx,
      );
    case "simulation_failed":
      return decorate(new SimulationError(details ?? message), ctx);
    case "confirmation_timeout":
    case "withdrawal_unconfirmed":
      return decorate(
        new ConfirmationTimeoutError(
          detailString(details, "signature") ?? "",
          detailNumber(details, "timeoutMs") ?? 0,
        ),
        ctx,
      );
    case "transaction_rejected":
      return decorate(new TransactionRejectedError(message), ctx);
    case "confirmation_required":
      return new ConfirmationRequiredError(message, {
        ...ctx,
        confirmFlag: detailString(details, "confirmFlag") ?? "confirm",
        previewMethod: detailString(details, "previewMethod") ?? "",
      });
  }

  if (INSUFFICIENT_CODES.has(code) || status === 402) return new InsufficientFundsError(message, ctx);
  if (status === 401) return new AuthenticationError(message, ctx);
  if (status === 403) {
    const scope =
      detailString(details, "required") ??
      detailString(details, "scope") ??
      detailString(details, "requiredScope") ??
      /"([a-z]+:[a-z_]+)"/.exec(message)?.[1] ??
      null;
    return new PermissionError(message, { ...ctx, scope });
  }
  if (status === 404) return new NotFoundError(message, ctx);
  if (status === 400 || status === 422) {
    return new ValidationError(message, { ...ctx, fields: fieldErrorsFrom(details, message) });
  }
  if (status === 429) return new RateLimitError(message, { ...ctx, retryAfter: ctx.retryAfter ?? null });
  if (status >= 500) return new ServerError(message, ctx);
  return new ThreeAgentsError(message, ctx);
}
