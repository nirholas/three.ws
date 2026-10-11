// Wingbits single aircraft details
import { getCorsHeaders, isDisallowedOrigin } from '../../_cors.js';
export const config = { runtime: 'edge' };

export default async function handler(req, { params }) {
  const icao24 = params.icao24?.toLowerCase();
  const apiKey = process.env.WINGBITS_API_KEY;
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, { status: 403, headers: corsHeaders });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  if (isDisallowedOrigin(req)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: corsHeaders });
  }

  if (!apiKey) {
    return Response.json({ error: 'Wingbits not configured', configured: false }, {
      headers: corsHeaders,
    });
  }

  if (!icao24 || !/^[a-f0-9]+$/i.test(icao24)) {
    return Response.json({ error: 'Invalid icao24' }, { status: 400, headers: corsHeaders });
  }

  try {
    const response = await fetch(`https://customer-api.wingbits.com/v1/flights/details/${icao24}`, {
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return Response.json({ error: `Wingbits API error: ${response.status}`, icao24 }, {
        status: response.status,
        headers: corsHeaders,
      });
    }

    const data = await response.json();
    return Response.json(data, {
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600' },
    });
  } catch (error) {
    return Response.json({ error: error.message, icao24 }, { status: 500, headers: corsHeaders });
  }
}
