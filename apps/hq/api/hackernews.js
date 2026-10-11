export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

// Fetch Hacker News front page stories
// Uses official HackerNews Firebase API
const ALLOWED_STORY_TYPES = new Set(['top', 'new', 'best', 'ask', 'show', 'job']);
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;
const MAX_CONCURRENCY = 10;

function parseLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit || '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

export default async function handler(request) {
  const cors = getCorsHeaders(request);
  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  try {
    const { searchParams } = new URL(request.url);
    const requestedType = searchParams.get('type') || 'top';
    const storyType = ALLOWED_STORY_TYPES.has(requestedType) ? requestedType : 'top';
    const limit = parseLimit(searchParams.get('limit'));

    // HackerNews official Firebase API
    const storiesUrl = `https://hacker-news.firebaseio.com/v0/${storyType}stories.json`;

    // Fetch story IDs
    const storiesResponse = await fetch(storiesUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!storiesResponse.ok) {
      throw new Error(`HackerNews API returned ${storiesResponse.status}`);
    }

    const storyIds = await storiesResponse.json();
    if (!Array.isArray(storyIds)) {
      throw new Error('HackerNews API returned unexpected payload');
    }
    const limitedIds = storyIds.slice(0, limit);

    // Fetch story details in bounded batches to avoid unbounded fan-out.
    const stories = [];
    for (let i = 0; i < limitedIds.length; i += MAX_CONCURRENCY) {
      const batchIds = limitedIds.slice(i, i + MAX_CONCURRENCY);
      const storyPromises = batchIds.map(async (id) => {
        const storyUrl = `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
        try {
          const response = await fetch(storyUrl, {
            signal: AbortSignal.timeout(5000),
          });
          if (response.ok) {
            return await response.json();
          }
          return null;
        } catch (error) {
          console.error(`Failed to fetch story ${id}:`, error);
          return null;
        }
      });
      const batchResults = await Promise.all(storyPromises);
      stories.push(...batchResults.filter((story) => story !== null));
    }

    return new Response(JSON.stringify({
      type: storyType,
      stories: stories,
      total: stories.length,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...cors,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60', // 5 min cache
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch Hacker News data',
        message: error.message
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...cors,
        },
      }
    );
  }
}
