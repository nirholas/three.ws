import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  try {
    const response = await fetch('https://nasstatus.faa.gov/api/airport-status-information', {
      headers: { 'Accept': 'application/xml' },
    });
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/xml',
        ...cors,
        'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30',
      },
    });
  } catch (error) {
    const safeMsg = String(error.message).replace(/[<>&]/g, '');
    return new Response(`<error>${safeMsg}</error>`, {
      status: 500,
      headers: { 'Content-Type': 'application/xml', ...cors },
    });
  }
}
