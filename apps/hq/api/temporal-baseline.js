/**
 * Temporal Baseline Anomaly Detection API
 * Stores and queries activity baselines using Welford's online algorithm
 * Backed by Upstash Redis for cross-user persistence
 *
 * GET ?type=military_flights&region=global&count=47 - check anomaly
 * POST { updates: [{ type, region, count }] } - batch update baselines
 */

import { getCachedJson, setCachedJson, mget } from './_upstash-cache.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = {
  runtime: 'edge',
};

const BASELINE_TTL = 7776000; // 90 days in seconds
const MIN_SAMPLES = 10;
const Z_THRESHOLD_LOW = 1.5;
const Z_THRESHOLD_MEDIUM = 2.0;
const Z_THRESHOLD_HIGH = 3.0;

const VALID_TYPES = ['military_flights', 'tracked_flights', 'vessels', 'protests', 'news', 'ais_gaps', 'satellite_fires'];

function makeKey(type, region, weekday, month) {
  return `baseline:${type}:${region}:${weekday}:${month}`;
}

function getSeverity(zScore) {
  if (zScore >= Z_THRESHOLD_HIGH) return 'critical';
  if (zScore >= Z_THRESHOLD_MEDIUM) return 'high';
  if (zScore >= Z_THRESHOLD_LOW) return 'medium';
  return 'normal';
}

export default async function handler(request) {
  const corsHeaders = getCorsHeaders(request, 'GET, POST, OPTIONS');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (request.method === 'GET') {
      return await handleGet(request);
    } else if (request.method === 'POST') {
      return await handlePost(request);
    }
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[TemporalBaseline] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleGet(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const region = searchParams.get('region') || 'global';
  const count = parseFloat(searchParams.get('count'));

  if (!type || !VALID_TYPES.includes(type) || isNaN(count)) {
    return json({ error: 'Missing or invalid params: type, count required' }, 400);
  }

  const now = new Date();
  const weekday = now.getUTCDay();
  const month = now.getUTCMonth() + 1;
  const key = makeKey(type, region, weekday, month);

  const baseline = await getCachedJson(key);

  if (!baseline || baseline.sampleCount < MIN_SAMPLES) {
    return json({
      anomaly: null,
      learning: true,
      sampleCount: baseline?.sampleCount || 0,
      samplesNeeded: MIN_SAMPLES,
    });
  }

  const variance = Math.max(0, baseline.m2 / (baseline.sampleCount - 1));
  const stdDev = Math.sqrt(variance);
  const zScore = stdDev > 0 ? Math.abs((count - baseline.mean) / stdDev) : 0;
  const severity = getSeverity(zScore);
  const multiplier = baseline.mean > 0
    ? Math.round((count / baseline.mean) * 100) / 100
    : count > 0 ? 999 : 1;

  return json({
    anomaly: zScore >= Z_THRESHOLD_LOW ? {
      zScore: Math.round(zScore * 100) / 100,
      severity,
      multiplier,
    } : null,
    baseline: {
      mean: Math.round(baseline.mean * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      sampleCount: baseline.sampleCount,
    },
    learning: false,
  });
}

async function handlePost(request) {
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 51200) {
    return json({ error: 'Payload too large' }, 413);
  }

  const body = await request.json();
  const updates = body?.updates;

  if (!Array.isArray(updates) || updates.length === 0) {
    return json({ error: 'Body must have updates array' }, 400);
  }

  const batch = updates.slice(0, 20);
  const now = new Date();
  const weekday = now.getUTCDay();
  const month = now.getUTCMonth() + 1;

  const keys = batch.map(u => makeKey(u.type, u.region || 'global', weekday, month));
  const existing = await mget(...keys);

  const writes = [];

  for (let i = 0; i < batch.length; i++) {
    const { type, region = 'global', count } = batch[i];
    if (!VALID_TYPES.includes(type) || typeof count !== 'number' || isNaN(count)) continue;

    const prev = existing[i] || { mean: 0, m2: 0, sampleCount: 0 };

    const n = prev.sampleCount + 1;
    const delta = count - prev.mean;
    const newMean = prev.mean + delta / n;
    const delta2 = count - newMean;
    const newM2 = prev.m2 + delta * delta2;

    writes.push(setCachedJson(keys[i], {
      mean: newMean,
      m2: newM2,
      sampleCount: n,
      lastUpdated: now.toISOString(),
    }, BASELINE_TTL));
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }

  return json({ updated: writes.length });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
