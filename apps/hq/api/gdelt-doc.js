import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
export const config = { runtime: 'edge' };

const MAX_RECORDS = 20;
const DEFAULT_RECORDS = 10;

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  const url = new URL(req.url);
  const query = url.searchParams.get('query');
  const maxrecords = Math.min(
    parseInt(url.searchParams.get('maxrecords') || DEFAULT_RECORDS, 10),
    MAX_RECORDS
  );
  const timespan = url.searchParams.get('timespan') || '72h';

  if (!query || query.length < 2) {
    return new Response(JSON.stringify({ error: 'Query parameter required' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const gdeltUrl = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    gdeltUrl.searchParams.set('query', query);
    gdeltUrl.searchParams.set('mode', 'artlist');
    gdeltUrl.searchParams.set('maxrecords', maxrecords.toString());
    gdeltUrl.searchParams.set('format', 'json');
    gdeltUrl.searchParams.set('sort', 'date');
    gdeltUrl.searchParams.set('timespan', timespan);

    const response = await fetch(gdeltUrl.toString());

    if (!response.ok) {
      throw new Error(`GDELT returned ${response.status}`);
    }

    const data = await response.json();

    const articles = (data.articles || []).map(article => ({
      title: article.title,
      url: article.url,
      source: article.domain || article.source?.domain,
      date: article.seendate,
      image: article.socialimage,
      language: article.language,
      tone: article.tone,
    }));

    return new Response(JSON.stringify({ articles, query }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...cors,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, articles: [] }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}
