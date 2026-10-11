// OpenSky Network API proxy - v3
// Note: OpenSky seems to block some cloud provider IPs
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { UA_BROWSER } from './_ua.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  const url = new URL(req.url);

  // Build OpenSky API URL with bounding box params
  const params = new URLSearchParams();
  const bboxKeys = ['lamin', 'lomin', 'lamax', 'lomax'];
  const bboxBounds = { lamin: [-90, 90], lomin: [-180, 180], lamax: [-90, 90], lomax: [-180, 180] };
  for (const key of bboxKeys) {
    const val = url.searchParams.get(key);
    if (val) {
      const num = parseFloat(val);
      if (isNaN(num) || num < bboxBounds[key][0] || num > bboxBounds[key][1]) {
        return Response.json({ error: `Invalid ${key}: must be a number between ${bboxBounds[key][0]} and ${bboxBounds[key][1]}` }, { status: 400, headers: cors });
      }
      params.set(key, String(num));
    }
  }

  const openskyUrl = `https://opensky-network.org/api/states/all${params.toString() ? '?' + params.toString() : ''}`;

  try {
    // Try fetching with different headers to avoid blocks
    const response = await fetch(openskyUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': UA_BROWSER,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
      },
    });

    if (response.status === 429) {
      return Response.json({ error: 'Rate limited', time: Date.now(), states: null }, {
        status: 429,
        headers: cors,
      });
    }

    // Check if response is OK
    if (!response.ok) {
      const text = await response.text();
      return Response.json({
        error: `OpenSky HTTP ${response.status}: ${text.substring(0, 200)}`,
        time: Date.now(),
        states: null
      }, {
        status: response.status,
        headers: cors,
      });
    }

    const data = await response.json();
    return Response.json(data, {
      status: response.status,
      headers: {
        ...cors,
        'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=15',
      },
    });
  } catch (error) {
    return Response.json({
      error: `Fetch failed: ${error.name} - ${error.message}`,
      time: Date.now(),
      states: null
    }, {
      status: 500,
      headers: cors,
    });
  }
}
