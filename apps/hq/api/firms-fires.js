/**
 * NASA FIRMS Satellite Fire Detection API
 * Proxies requests to NASA FIRMS to avoid CORS and protect API key
 * Returns parsed fire data for monitored conflict regions
 *
 * GET ?region=Ukraine&days=1  - fires for one region
 * GET ?days=1                 - fires for all monitored regions
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = {
  runtime: 'edge',
};

const FIRMS_API_KEY = process.env.NASA_FIRMS_API_KEY || process.env.FIRMS_API_KEY || '';
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const SOURCE = 'VIIRS_SNPP_NRT';

// Bounding boxes as west,south,east,north
const MONITORED_REGIONS = {
  'Ukraine':      { bbox: '22,44,40,53' },
  'Russia':       { bbox: '20,50,180,82' },
  'Iran':         { bbox: '44,25,63,40' },
  'Israel/Gaza':  { bbox: '34,29,36,34' },
  'Syria':        { bbox: '35,32,42,37' },
  'Taiwan':       { bbox: '119,21,123,26' },
  'North Korea':  { bbox: '124,37,131,43' },
  'Saudi Arabia': { bbox: '34,16,56,32' },
  'Turkey':       { bbox: '26,36,45,42' },
};

// Map VIIRS confidence letters to numeric
function parseConfidence(c) {
  if (c === 'h') return 95;
  if (c === 'n') return 50;
  if (c === 'l') return 20;
  return parseInt(c) || 0;
}

function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim());
    if (vals.length < headers.length) continue;

    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx]; });

    results.push({
      lat: parseFloat(row.latitude),
      lon: parseFloat(row.longitude),
      brightness: parseFloat(row.bright_ti4) || 0,
      scan: parseFloat(row.scan) || 0,
      track: parseFloat(row.track) || 0,
      acq_date: row.acq_date || '',
      acq_time: row.acq_time || '',
      satellite: row.satellite || '',
      confidence: parseConfidence(row.confidence),
      bright_t31: parseFloat(row.bright_ti5) || 0,
      frp: parseFloat(row.frp) || 0,
      daynight: row.daynight || '',
    });
  }

  return results;
}

export default async function handler(request) {
  const cors = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  if (!FIRMS_API_KEY) {
    return json({ regions: {}, totalCount: 0, skipped: true, reason: 'NASA_FIRMS_API_KEY not configured', source: SOURCE, days: 0, timestamp: new Date().toISOString() }, 200, cors);
  }

  try {
    const { searchParams } = new URL(request.url);
    const regionName = searchParams.get('region');
    const days = Math.min(parseInt(searchParams.get('days')) || 1, 5);

    const regions = regionName
      ? { [regionName]: MONITORED_REGIONS[regionName] }
      : MONITORED_REGIONS;

    if (regionName && !MONITORED_REGIONS[regionName]) {
      return json({ error: `Unknown region: ${regionName}` }, 400, cors);
    }

    const allFires = {};
    let totalCount = 0;

    // Fetch regions in parallel (max 10)
    const entries = Object.entries(regions);
    const results = await Promise.allSettled(
      entries.map(async ([name, { bbox }]) => {
        const url = `${FIRMS_BASE}/${FIRMS_API_KEY}/${SOURCE}/${bbox}/${days}`;
        const res = await fetch(url, {
          headers: { 'Accept': 'text/csv' },
        });
        if (!res.ok) throw new Error(`FIRMS ${res.status} for ${name}`);
        const csv = await res.text();
        return { name, fires: parseCSV(csv) };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { name, fires } = result.value;
        allFires[name] = fires;
        totalCount += fires.length;
      } else {
        console.error('[FIRMS]', result.reason?.message);
      }
    }

    return json({
      regions: allFires,
      totalCount,
      source: SOURCE,
      days,
      timestamp: new Date().toISOString(),
    }, 200, cors);
  } catch (err) {
    console.error('[FIRMS] Error:', err);
    return json({ error: 'Failed to fetch fire data' }, 500, cors);
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120',
      ...extraHeaders,
    },
  });
}
