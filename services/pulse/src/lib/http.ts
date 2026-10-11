// Shared HTTP client for every upstream: per-attempt timeout, retry with
// backoff on 429/5xx/transport errors (honoring Retry-After), and a per-host
// token bucket so a burst of collectors never trips an upstream's rate limit.
import { logger } from './log.ts';

const log = logger('http');

export const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** Requests per minute allowed per host. Unlisted hosts get 120. */
const HOST_RPM: Record<string, number> = {
  'api.dexscreener.com': 250,
  'lite-api.jup.ag': 50,
  'api.geckoterminal.com': 12,
  'frontend-api-v3.pump.fun': 60,
  'kolscan.io': 6,
  'api.mainnet-beta.solana.com': 80,
};

type Bucket = { tokens: number; updated: number; rpm: number };
const buckets = new Map<string, Bucket>();

async function takeToken(host: string): Promise<void> {
  const rpm = HOST_RPM[host] ?? 120;
  let b = buckets.get(host);
  if (!b) {
    b = { tokens: Math.max(1, Math.floor(rpm / 6)), updated: Date.now(), rpm };
    buckets.set(host, b);
  }
  for (;;) {
    const now = Date.now();
    b.tokens = Math.min(Math.max(1, rpm / 6), b.tokens + ((now - b.updated) / 60_000) * rpm);
    b.updated = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    await sleep(Math.ceil(((1 - b.tokens) / rpm) * 60_000));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class HttpError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string, body: string) {
    super(`HTTP ${status} from ${new URL(url).host}: ${body.slice(0, 160)}`);
    this.status = status;
    this.url = url;
  }
}

export type FetchOpts = {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
};

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const { timeoutMs = 15_000, retries = 3, headers = {}, method = 'GET', body } = opts;
  const host = new URL(url).host;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await takeToken(host);
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { accept: 'application/json', 'user-agent': BROWSER_UA, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (res.ok) return text;
      lastErr = new HttpError(res.status, url, text);
      if (res.status !== 429 && res.status < 500) throw lastErr;
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** attempt);
    } catch (err) {
      if (err instanceof HttpError && err.status !== 429 && err.status < 500) throw err;
      lastErr = err;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  log.warn(`giving up on ${host}`, lastErr);
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`non-JSON response from ${new URL(url).host}: ${text.slice(0, 120)}`);
  }
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Run async work over items with bounded concurrency; failures are collected, not thrown. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<{ ok: R[]; failed: number }> {
  const ok: R[] = [];
  let failed = 0;
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        ok.push(await fn(item));
      } catch {
        failed++;
      }
    }
  });
  await Promise.all(workers);
  return { ok, failed };
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
