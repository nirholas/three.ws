import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { UA_BOT } from './_ua.js';
export const config = { runtime: 'edge' };

// Fetch AI/ML papers from ArXiv
// Categories: cs.AI, cs.LG (Machine Learning), cs.CL (Computation and Language)
export default async function handler(request) {
  const cors = getCorsHeaders(request);
  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  try {
    const { searchParams } = new URL(request.url);
    const rawCategory = searchParams.get('category') || 'cs.AI';
    const rawMaxResults = searchParams.get('max_results') || '50';
    const rawSortBy = searchParams.get('sortBy') || 'submittedDate';

    // Validate category against allowlist
    const ALLOWED_CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV', 'cs.NE', 'cs.RO', 'cs.CR', 'cs.DC', 'stat.ML', 'q-fin.ST', 'q-fin.TR', 'q-fin.RM'];
    const category = ALLOWED_CATEGORIES.includes(rawCategory) ? rawCategory : 'cs.AI';

    // Validate maxResults (1-200)
    const maxResults = Math.max(1, Math.min(200, parseInt(rawMaxResults, 10) || 50));

    // Validate sortBy against allowlist
    const ALLOWED_SORT = ['submittedDate', 'lastUpdatedDate', 'relevance'];
    const sortBy = ALLOWED_SORT.includes(rawSortBy) ? rawSortBy : 'submittedDate';

    // ArXiv API search query
    // Search for papers in specified category, sorted by date
    const query = `cat:${category}`;
    const apiUrl = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=descending`;

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': UA_BOT,
      },
    });

    if (!response.ok) {
      throw new Error(`ArXiv API returned ${response.status}`);
    }

    const xmlData = await response.text();

    // Parse XML to extract key information
    // Return raw XML for client-side parsing or transform here
    return new Response(xmlData, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        ...cors,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600', // 1 hour cache
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch ArXiv data',
        message: error.message
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...cors
        },
      }
    );
  }
}
