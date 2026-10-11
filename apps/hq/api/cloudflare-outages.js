import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
export const config = { runtime: 'edge' };

function clampLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit || '', 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(100, parsed));
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, { status: 403, headers: corsHeaders });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const dateRange = url.searchParams.get('dateRange') || '7d';
  const limit = clampLimit(url.searchParams.get('limit'));

  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    // Signal to client that outages feature is not configured
    return new Response(JSON.stringify({ configured: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=${dateRange}&limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60', ...corsHeaders },
    });
  } catch (error) {
    // Return empty result on error so client circuit breaker doesn't trigger unnecessarily
    return new Response(JSON.stringify({ success: true, result: { annotations: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
