// Wingbits API proxy - keeps API key server-side
// Note: Edge runtime is stateless - caching happens client-side and via HTTP Cache-Control
import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/wingbits', '');
  const corsHeaders = getCorsHeaders(req, 'GET, POST, OPTIONS');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, {
        status: 403,
        headers: corsHeaders,
      });
    }
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (isDisallowedOrigin(req)) {
    return Response.json({ error: 'Origin not allowed' }, {
      status: 403,
      headers: corsHeaders,
    });
  }

  // Get API key from server-side env
  const apiKey = process.env.WINGBITS_API_KEY;

  if (!apiKey) {
    return Response.json({
      error: 'Wingbits not configured',
      configured: false
    }, {
      status: 200,
      headers: corsHeaders,
    });
  }

  // Route: GET /details/:icao24 - Aircraft details
  const detailsMatch = path.match(/^\/details\/([a-fA-F0-9]+)$/);
  if (detailsMatch) {
    const icao24 = detailsMatch[1].toLowerCase();

    try {
      const response = await fetch(`https://customer-api.wingbits.com/v1/flights/details/${icao24}`, {
        headers: {
          'x-api-key': apiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return Response.json({
          error: `Wingbits API error: ${response.status}`,
          icao24,
        }, {
          status: response.status,
          headers: corsHeaders,
        });
      }

      const data = await response.json();

      return Response.json(data, {
        headers: {
          ...corsHeaders,
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600', // 24h - aircraft details rarely change
        },
      });
    } catch (error) {
      return Response.json({
        error: `Fetch failed: ${error.message}`,
        icao24,
      }, {
        status: 500,
        headers: corsHeaders,
      });
    }
  }

  // Route: POST /details/batch - Batch lookup multiple aircraft (parallel)
  if (path === '/details/batch' && req.method === 'POST') {
    try {
      const body = await req.json();
      const icao24List = body.icao24s || [];

      if (!Array.isArray(icao24List) || icao24List.length === 0) {
        return Response.json({ error: 'icao24s array required' }, {
          status: 400,
          headers: corsHeaders,
        });
      }

      // Limit batch size to avoid overwhelming the API
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
            const data = await response.json();
            return { icao24, data };
          }
        } catch {
          // Skip failed lookups
        }
        return null;
      });

      const fetchResults = await Promise.all(fetchPromises);

      for (const result of fetchResults) {
        if (result) {
          results[result.icao24] = result.data;
        }
      }

      return Response.json({
        results,
        fetched: Object.keys(results).length,
        requested: limitedList.length,
      }, {
        headers: {
          ...corsHeaders,
        },
      });
    } catch (error) {
      return Response.json({
        error: `Batch lookup failed: ${error.message}`,
      }, {
        status: 500,
        headers: corsHeaders,
      });
    }
  }

  // Route: GET /flights - Get live flight positions in a geographic area
  // Query params: la (lat), lo (lon), w (width), h (height), unit (km|nm)
  if (path === '/flights' && req.method === 'GET') {
    try {
      const params = new URLSearchParams(url.search);
      const la = params.get('la') || params.get('lat');
      const lo = params.get('lo') || params.get('lon');
      const w = params.get('w') || params.get('width') || '500';
      const h = params.get('h') || params.get('height') || '500';
      const unit = params.get('unit') || 'nm';

      if (!la || !lo) {
        return Response.json({ error: 'lat (la) and lon (lo) required' }, {
          status: 400,
          headers: corsHeaders,
        });
      }

      const wingbitsUrl = `https://customer-api.wingbits.com/v1/flights?by=box&la=${la}&lo=${lo}&w=${w}&h=${h}&unit=${unit}`;
      console.log('[Wingbits] Fetching flights:', wingbitsUrl);

      const response = await fetch(wingbitsUrl, {
        headers: {
          'x-api-key': apiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Wingbits] API error:', response.status, errorText);
        return Response.json({
          error: `Wingbits API error: ${response.status}`,
          details: errorText,
        }, {
          status: response.status,
          headers: corsHeaders,
        });
      }

      const data = await response.json();
      console.log('[Wingbits] Got', Array.isArray(data) ? data.length : 0, 'flights');

      return Response.json(data, {
        headers: {
          ...corsHeaders,
          'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=15', // 30 seconds - live data
        },
      });
    } catch (error) {
      console.error('[Wingbits] Flights fetch error:', error);
      return Response.json({
        error: `Fetch failed: ${error.message}`,
      }, {
        status: 500,
        headers: corsHeaders,
      });
    }
  }

  // Route: POST /flights/batch - Get flights for multiple areas (for theater posture)
  if (path === '/flights/batch' && req.method === 'POST') {
    try {
      const body = await req.json();
      const areas = body.areas || [];

      if (!Array.isArray(areas) || areas.length === 0) {
        return Response.json({ error: 'areas array required' }, {
          status: 400,
          headers: corsHeaders,
        });
      }

      // Wingbits batch endpoint format
      const wingbitsAreas = areas.map(area => ({
        alias: area.id || area.alias,
        by: 'box',
        la: (area.north + area.south) / 2,
        lo: (area.east + area.west) / 2,
        w: Math.abs(area.east - area.west) * 60, // degrees to nautical miles (approx)
        h: Math.abs(area.north - area.south) * 60,
        unit: 'nm',
      }));

      const response = await fetch('https://customer-api.wingbits.com/v1/flights', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(wingbitsAreas),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return Response.json({
          error: `Wingbits API error: ${response.status}`,
          details: errorText,
        }, {
          status: response.status,
          headers: corsHeaders,
        });
      }

      const data = await response.json();
      console.log('[Wingbits] Batch got', data.length, 'area results');

      return Response.json(data, {
        headers: {
          ...corsHeaders,
          'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=15',
        },
      });
    } catch (error) {
      console.error('[Wingbits] Batch flights error:', error);
      return Response.json({
        error: `Fetch failed: ${error.message}`,
      }, {
        status: 500,
        headers: corsHeaders,
      });
    }
  }

  // Route: GET /health - Check Wingbits status
  if (path === '/health' || path === '') {
    try {
      const response = await fetch('https://customer-api.wingbits.com/health', {
        headers: { 'x-api-key': apiKey },
      });
      const data = await response.json();
      return Response.json({
        ...data,
        configured: true,
      }, {
        headers: corsHeaders,
      });
    } catch (error) {
      return Response.json({
        error: error.message,
        configured: true,
      }, {
        status: 500,
        headers: corsHeaders,
      });
    }
  }

  return Response.json({ error: 'Not found' }, {
    status: 404,
    headers: corsHeaders,
  });
}
