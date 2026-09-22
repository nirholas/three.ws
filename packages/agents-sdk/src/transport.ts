// HTTP transport: auth header, timeout, retries with exponential backoff,
// idempotency keys, envelope unwrapping and error mapping. Uses the global
// `fetch` (Node 20+, Deno, Bun, browsers) or one passed in the options.

import {
  ConnectionError,
  ServerError,
  ThreeAgentsError,
  TimeoutError,
  errorFromResponse,
  type RateLimitInfo,
} from "./errors";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TransportOptions {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  retries: number;
  retryDelay: number;
  fetch: FetchLike;
  userAgent: string;
  defaultHeaders: Record<string, string>;
}

/** Response metadata the v1 API attaches to every reply. */
export interface ResponseMeta {
  requestId: string | null;
  timestamp: string | null;
  hasMore?: boolean;
  nextCursor?: string | null;
  rateLimit: RateLimitInfo | null;
}

export interface RequestSpec {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  body?: unknown;
  /**
   * Send an Idempotency-Key. `true` generates one; a string uses it verbatim.
   * The same key is reused across retries so a retried POST never acts twice.
   */
  idempotencyKey?: string | boolean;
  /** Per-call overrides of the client defaults. */
  timeout?: number;
  retries?: number;
  signal?: AbortSignal;
}

export interface RawResult<T> {
  data: T;
  meta: ResponseMeta;
}

const RETRYABLE_STATUS = (s: number) => s >= 500 && s <= 599;

export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function headerNumber(h: Headers, name: string): number | null {
  const raw = h.get(name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function readRateLimit(h: Headers): RateLimitInfo | null {
  const limit = headerNumber(h, "ratelimit-limit") ?? headerNumber(h, "x-ratelimit-limit");
  const remaining = headerNumber(h, "ratelimit-remaining") ?? headerNumber(h, "x-ratelimit-remaining");
  const reset = headerNumber(h, "ratelimit-reset") ?? headerNumber(h, "x-ratelimit-reset");
  if (limit == null && remaining == null && reset == null) return null;
  return { limit, remaining, reset };
}

/** Retry-After in seconds, from either the delta-seconds or the HTTP-date form. */
export function readRetryAfter(h: Headers): number | null {
  const raw = h.get("retry-after");
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
}

function buildUrl(baseUrl: string, path: string, query?: RequestSpec["query"]): string {
  const url = new URL(baseUrl.replace(/\/+$/, "") + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
  }
  return url.toString();
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface ParsedError {
  code: string;
  message: string;
  details: unknown;
}

/**
 * Read either envelope: the v1 `{ error: { code, message, details } }` or the
 * legacy `{ error: "code", error_description: "…" }` older routes still use.
 */
function parseError(body: unknown, status: number): ParsedError {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const e = b.error;
    if (e && typeof e === "object") {
      const eo = e as Record<string, unknown>;
      return {
        code: String(eo.code ?? "error"),
        message: String(eo.message ?? `HTTP ${status}`),
        details: eo.details,
      };
    }
    if (typeof e === "string") {
      const { error: _e, error_description, ...rest } = b;
      return {
        code: e,
        message: String(error_description ?? e),
        details: Object.keys(rest).length ? rest : undefined,
      };
    }
  }
  return {
    code: `http_${status}`,
    message: typeof body === "string" && body ? body.slice(0, 300) : `HTTP ${status}`,
    details: undefined,
  };
}

function metaFrom(body: unknown, res: Response): ResponseMeta {
  const m =
    body && typeof body === "object" && (body as Record<string, unknown>).meta && typeof (body as Record<string, unknown>).meta === "object"
      ? ((body as Record<string, unknown>).meta as Record<string, unknown>)
      : {};
  return {
    requestId: (m.requestId as string | undefined) ?? res.headers.get("x-request-id"),
    timestamp: (m.timestamp as string | undefined) ?? null,
    hasMore: typeof m.hasMore === "boolean" ? m.hasMore : undefined,
    nextCursor: (m.nextCursor as string | null | undefined) ?? undefined,
    rateLimit: readRateLimit(res.headers),
  };
}

function unwrapData(body: unknown): unknown {
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>).data;
  }
  return body;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Backoff for attempt n (0-based): retryDelay * 2^n, with up to 20% jitter. */
export function backoffMs(retryDelay: number, attempt: number): number {
  const base = retryDelay * 2 ** attempt;
  return Math.round(base + base * 0.2 * Math.random());
}

export class Transport {
  constructor(readonly opts: TransportOptions) {}

  private headers(spec: RequestSpec, idemKey: string | null, stream: boolean): Record<string, string> {
    const h: Record<string, string> = {
      ...this.opts.defaultHeaders,
      authorization: `Bearer ${this.opts.apiKey}`,
      accept: stream ? "text/event-stream" : "application/json",
    };
    const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
    if (!proc?.versions?.node) {
      // Browsers forbid setting User-Agent; send our identifier separately.
      h["x-three-ws-client"] = this.opts.userAgent;
    } else {
      h["user-agent"] = this.opts.userAgent;
    }
    if (spec.body !== undefined) h["content-type"] = "application/json";
    if (idemKey) h["idempotency-key"] = idemKey;
    return h;
  }

  /**
   * Open a request and return the Response once headers arrive, applying the
   * retry policy to connection failures, timeouts and 5xx. Used directly by the
   * SSE stream and by `request` for JSON calls.
   */
  async open(spec: RequestSpec, stream = false): Promise<{ res: Response; clear: () => void }> {
    const url = buildUrl(this.opts.baseUrl, spec.path, spec.query);
    const retries = spec.retries ?? this.opts.retries;
    const timeoutMs = spec.timeout ?? this.opts.timeout;
    const idemKey =
      typeof spec.idempotencyKey === "string"
        ? spec.idempotencyKey
        : spec.idempotencyKey
          ? newIdempotencyKey()
          : null;
    const ctxBase = { method: spec.method, path: spec.path };

    let lastErr: ThreeAgentsError | Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoffMs(this.opts.retryDelay, attempt - 1), spec.signal);

      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeoutMs);
      const onAbort = () => ctrl.abort(spec.signal?.reason);
      spec.signal?.addEventListener("abort", onAbort, { once: true });
      const clear = () => {
        clearTimeout(timer);
        spec.signal?.removeEventListener("abort", onAbort);
      };

      let res: Response;
      try {
        res = await this.opts.fetch(url, {
          method: spec.method,
          headers: this.headers(spec, idemKey, stream),
          body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
          signal: ctrl.signal,
        });
      } catch (err) {
        clear();
        if (spec.signal?.aborted) throw spec.signal.reason ?? err;
        lastErr = timedOut
          ? new TimeoutError(`${spec.method} ${spec.path} timed out after ${timeoutMs}ms`, {
              ...ctxBase,
              timeoutMs,
            })
          : new ConnectionError(
              `${spec.method} ${spec.path} failed: ${(err as Error)?.message ?? String(err)}`,
              { ...ctxBase, code: "connection_error" },
            );
        continue;
      }

      if (res.ok) {
        // Streams keep the timer cleared only once the caller finishes; JSON
        // calls clear it after the body is read (see request()).
        if (stream) clearTimeout(timer);
        return { res, clear };
      }

      const body = await readBody(res).catch(() => null);
      clear();
      const parsed = parseError(body, res.status);
      const meta = metaFrom(body, res);
      const err = errorFromResponse(parsed.message, {
        ...ctxBase,
        status: res.status,
        code: parsed.code,
        details: parsed.details,
        requestId: meta.requestId,
        rateLimit: meta.rateLimit,
        retryAfter: readRetryAfter(res.headers),
      });
      // 409 idempotency_in_progress: the first attempt with this key is still
      // running server-side; waiting and retrying returns its stored result.
      const retryable = RETRYABLE_STATUS(res.status) || parsed.code === "idempotency_in_progress";
      if (retryable && attempt < retries) {
        lastErr = err;
        continue;
      }
      throw err;
    }

    if (lastErr instanceof ThreeAgentsError) throw lastErr;
    throw new ServerError(`${spec.method} ${spec.path} failed after ${retries + 1} attempts`, ctxBase);
  }

  async request<T>(spec: RequestSpec): Promise<RawResult<T>> {
    const { res, clear } = await this.open(spec);
    try {
      const body = await readBody(res);
      return { data: unwrapData(body) as T, meta: metaFrom(body, res) };
    } catch (err) {
      throw new ConnectionError(
        `${spec.method} ${spec.path} response could not be read: ${(err as Error)?.message ?? String(err)}`,
        { method: spec.method, path: spec.path, status: res.status, code: "connection_error", requestId: res.headers.get("x-request-id") },
      );
    } finally {
      clear();
    }
  }
}
