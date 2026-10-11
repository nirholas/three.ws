// YouTube Live Stream Detection API
// Uses YouTube's oembed endpoint to check for live streams

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';
import { UA_BROWSER } from '../_ua.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  const cors = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  const url = new URL(request.url);
  const channel = url.searchParams.get('channel');

  if (!channel) {
    return new Response(JSON.stringify({ error: 'Missing channel parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Try to fetch the channel's live page
    const channelHandle = channel.startsWith('@') ? channel : `@${channel}`;
    const liveUrl = `https://www.youtube.com/${channelHandle}/live`;

    const response = await fetch(liveUrl, {
      headers: {
        'User-Agent': UA_BROWSER,
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ videoId: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const html = await response.text();

    // Extract video ID from the page
    const videoIdMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    const isLiveMatch = html.match(/"isLive":\s*true/);

    if (videoIdMatch && isLiveMatch) {
      return new Response(JSON.stringify({ videoId: videoIdMatch[1], isLive: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60', // Cache for 5 minutes
        },
      });
    }

    // Return null if no live stream found
    return new Response(JSON.stringify({ videoId: null, isLive: false }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('YouTube live check error:', error);
    return new Response(JSON.stringify({ videoId: null, error: error.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
