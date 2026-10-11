import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const ALLOWED_ORDER = ['volume', 'liquidity', 'startDate', 'endDate', 'spread'];
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;

function validateBoolean(val, defaultVal) {
  if (val === 'true' || val === 'false') return val;
  return defaultVal;
}

function validateLimit(val) {
  const num = parseInt(val, 10);
  if (isNaN(num)) return 50;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, num));
}

function validateOrder(val) {
  return ALLOWED_ORDER.includes(val) ? val : 'volume';
}

function sanitizeTagSlug(val) {
  if (!val) return null;
  return val.replace(/[^a-z0-9-]/gi, '').slice(0, 100) || null;
}

async function tryFetch(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function buildUrl(base, endpoint, params) {
  if (endpoint === 'events') {
    return `${base}/events?${params}`;
  }
  return `${base}/markets?${params}`;
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint') || 'markets';

  const closed = validateBoolean(url.searchParams.get('closed'), 'false');
  const order = validateOrder(url.searchParams.get('order'));
  const ascending = validateBoolean(url.searchParams.get('ascending'), 'false');
  const limit = validateLimit(url.searchParams.get('limit'));

  const params = new URLSearchParams({
    closed,
    order,
    ascending,
    limit: String(limit),
  });

  if (endpoint === 'events') {
    const tag = sanitizeTagSlug(url.searchParams.get('tag'));
    if (tag) params.set('tag_slug', tag);
  }

  // Gamma API is behind Cloudflare which blocks server-side TLS connections
  // (JA3 fingerprint detection). Only browser-originated requests succeed.
  // We still try in case Cloudflare policy changes, but gracefully return empty on failure.
  try {
    const data = await tryFetch(buildUrl(GAMMA_BASE, endpoint, params));
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...cors,
        'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60',
        'X-Polymarket-Source': 'gamma',
      },
    });
  } catch (err) {
    // Expected: Cloudflare blocks non-browser TLS connections
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...cors,
        'X-Polymarket-Error': err.message,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    });
  }
}
