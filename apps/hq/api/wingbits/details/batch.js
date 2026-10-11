// Wingbits batch aircraft details
import { getCorsHeaders, isDisallowedOrigin } from '../../_cors.js';
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const apiKey = process.env.WINGBITS_API_KEY;

  const corsHeaders = getCorsHeaders(req, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, { status: 403, headers: corsHeaders });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (isDisallowedOrigin(req)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  if (!apiKey) {
    return Response.json({ error: 'Wingbits not configured', configured: false }, {
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json();
    const icao24List = body.icao24s || [];

    if (!Array.isArray(icao24List) || icao24List.length === 0) {
      return Response.json({ error: 'icao24s array required' }, { status: 400, headers: corsHeaders });
    }

    // Limit batch size
    const limitedList = icao24List.slice(0, 20).map(id => id.toLowerCase());
    const results = {};

    // Fetch all in parallel
    const fetchPromises = limitedList.map(async (icao24) => {
      try {
        const response = await fetch(`https://customer-api.wingbits.com/v1/flights/details/${icao24}`, {
          headers: {
            'x-api-key': apiKey,
            'Accept': 'application/json',
          },
        });
        if (response.ok) {
          return { icao24, data: await response.json() };
        }
      } catch {
        // Skip failed lookups
      }
      return null;
    });

    const fetchResults = await Promise.all(fetchPromises);
    for (const result of fetchResults) {
      if (result) results[result.icao24] = result.data;
    }

    return Response.json({
      results,
      fetched: Object.keys(results).length,
      requested: limitedList.length,
    }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60', ...corsHeaders } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
