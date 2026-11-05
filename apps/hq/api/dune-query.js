export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

/**
 * Opt-in Dune Analytics proxy. Reads the latest cached results of a saved
 * Dune query (it never executes one, so it never spends execution credits).
 * Needs DUNE_API_KEY; without it the endpoint answers 200 with
 * { enabled: false } so the panel can show how to turn it on.
 *
 *   GET /api/dune-query                  -> { enabled }
 *   GET /api/dune-query?id=<queryId>[&limit=50]
 */

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map();

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  const headers = { ...cors, 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: isDisallowedOrigin(req) ? 403 : 204, headers: cors });
  if (isDisallowedOrigin(req)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...headers, Allow: 'GET, OPTIONS' } });

  const key = process.env.DUNE_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ enabled: false, reason: 'DUNE_API_KEY is not set. Add it in Settings (desktop) or the server environment to turn this panel on.' }), { headers });
  }
  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (!limiter.check(ip)) return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: { ...headers, 'Retry-After': '60' } });

  const q = new URL(req.url).searchParams;
  const id = q.get('id');
  if (!id) return new Response(JSON.stringify({ enabled: true }), { headers });
  if (!/^\d{1,12}$/.test(id)) return new Response(JSON.stringify({ error: 'id must be a numeric Dune query id' }), { status: 400, headers });
  const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 50));

  const ck = `${id}:${limit}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return new Response(JSON.stringify(hit.body), { headers: { ...headers, 'X-Cache': 'HIT' } });
  try {
    const res = await fetch(`https://api.dune.com/api/v1/query/${id}/results?limit=${limit}`, {
      headers: { 'X-Dune-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return new Response(JSON.stringify({ enabled: true, error: 'Dune rejected the configured key.' }), { status: 502, headers });
    if (res.status === 404) return new Response(JSON.stringify({ enabled: true, error: `No Dune query ${id}, or it has no saved result yet.` }), { status: 404, headers });
    if (res.status === 429) return new Response(JSON.stringify({ enabled: true, error: 'Dune rate limit reached. Try again shortly.' }), { status: 429, headers: { ...headers, 'Retry-After': '60' } });
    if (!res.ok) throw new Error(`Dune HTTP ${res.status}`);
    const json = await res.json();
    const body = {
      enabled: true, queryId: id, executedAt: json.execution_ended_at || null,
      columns: json.result?.metadata?.column_names || [], rows: json.result?.rows || [], rowCount: json.result?.metadata?.total_row_count ?? null,
      source: 'Dune Analytics, latest saved result',
    };
    cache.set(ck, { at: Date.now(), body });
    if (cache.size > 50) cache.delete(cache.keys().next().value);
    return new Response(JSON.stringify(body), { headers: { ...headers, 'X-Cache': 'MISS' } });
  } catch (err) {
    console.error('[dune-query]', err?.message || err);
    return new Response(JSON.stringify({ enabled: true, error: 'Dune did not answer. Try again in a moment.' }), { status: 502, headers });
  }
}
