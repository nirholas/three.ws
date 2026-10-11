/**
 * Groq API Summarization Endpoint with Redis Caching
 * Uses Llama 3.1 8B Instant for high-throughput summarization
 * Free tier: 14,400 requests/day (14x more than 70B model)
 * Server-side Redis cache for cross-user deduplication
 */

import { getCachedJson, setCachedJson, hashString } from './_upstash-cache.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

export const config = {
  runtime: 'edge',
};

const rateLimiter = createIpRateLimiter({ limit: 15, windowMs: 60_000 });

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant'; // 14.4K RPD vs 1K for 70b
const CACHE_TTL_SECONDS = 86400; // 24 hours

const CACHE_VERSION = 'v3';

function getCacheKey(headlines, mode, geoContext = '', variant = 'full') {
  const sorted = headlines.slice(0, 8).sort().join('|');
  const geoHash = geoContext ? ':g' + hashString(geoContext).slice(0, 6) : '';
  const hash = hashString(`${mode}:${sorted}`);
  return `summary:${CACHE_VERSION}:${variant}:${hash}${geoHash}`;
}

// Deduplicate similar headlines (same story from different sources)
function deduplicateHeadlines(headlines) {
  const seen = new Set();
  const unique = [];

  for (const headline of headlines) {
    // Normalize: lowercase, remove punctuation, collapse whitespace
    const normalized = headline.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract key words (4+ chars) for similarity check
    const words = new Set(normalized.split(' ').filter(w => w.length >= 4));

    // Check if this headline is too similar to any we've seen
    let isDuplicate = false;
    for (const seenWords of seen) {
      const intersection = [...words].filter(w => seenWords.has(w));
      const similarity = intersection.length / Math.min(words.size, seenWords.size);
      if (similarity > 0.6) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.add(words);
      unique.push(headline);
    }
  }

  return unique;
}

export default async function handler(request) {
  const corsHeaders = getCorsHeaders(request, 'POST, OPTIONS');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const clientIp = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (!rateLimiter.check(clientIp)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ summary: null, fallback: true, skipped: true, reason: 'Service unavailable' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 51200) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { headlines, mode = 'brief', geoContext = '', variant = 'full' } = await request.json();

    // Validate mode and variant against allowlists
    const ALLOWED_MODES = ['brief', 'analysis', 'synthesis'];
    const ALLOWED_VARIANTS = ['full', 'tech'];
    const safeMode = ALLOWED_MODES.includes(mode) ? mode : 'brief';
    const safeVariant = ALLOWED_VARIANTS.includes(variant) ? variant : 'full';

    if (!headlines || !Array.isArray(headlines) || headlines.length === 0) {
      return new Response(JSON.stringify({ error: 'Headlines array required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate headline items are strings and cap count
    const safeHeadlines = headlines
      .filter(h => typeof h === 'string' && h.length > 0)
      .slice(0, 8)
      .map(h => h.slice(0, 500));

    if (safeHeadlines.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid headline strings provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cap geoContext length to prevent prompt overflow
    const safeGeoContext = typeof geoContext === 'string' ? geoContext.slice(0, 2000) : '';

    // Check cache first
    const cacheKey = getCacheKey(safeHeadlines, safeMode, safeGeoContext, safeVariant);
    const cached = await getCachedJson(cacheKey);
    if (cached && typeof cached === 'object' && cached.summary) {
      return new Response(JSON.stringify({
        summary: cached.summary,
        model: cached.model || MODEL,
        provider: 'cache',
        cached: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Deduplicate similar headlines (same story from multiple sources)
    const uniqueHeadlines = deduplicateHeadlines(safeHeadlines);
    const headlineText = uniqueHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n');

    let systemPrompt, userPrompt;

    // Include intelligence synthesis context in prompt if available
    const intelSection = safeGeoContext ? `\n\n${safeGeoContext}` : '';

    // Current date context for LLM (models may have outdated knowledge)
    const isTechVariant = safeVariant === 'tech';
    const dateContext = `Current date: ${new Date().toISOString().split('T')[0]}.`;

    if (safeMode === 'brief') {
      if (isTechVariant) {
        // Tech variant: focus on startups, AI, funding, product launches
        systemPrompt = `${dateContext}

Summarize the key tech/startup development in 2-3 sentences.
Rules:
- Focus ONLY on technology, startups, AI, funding, product launches, or developer news
- IGNORE political news, trade policy, tariffs, government actions unless directly about tech regulation
- Lead with the company/product/technology name
- Start directly: "OpenAI announced...", "A new $50M Series B...", "GitHub released..."
- No bullet points, no meta-commentary`;
      } else {
        // Full variant: geopolitical focus
        systemPrompt = `${dateContext}

Summarize the key development in 2-3 sentences.
Rules:
- Lead with WHAT happened and WHERE - be specific
- NEVER start with "Breaking news", "Good evening", "Tonight", or TV-style openings
- Start directly with the subject: "Iran's regime...", "The US Treasury...", "Protests in..."
- CRITICAL FOCAL POINTS are the main actors - mention them by name
- If focal points show news + signals convergence, that's the lead
- No bullet points, no meta-commentary`;
      }
      userPrompt = `Summarize the top story:\n${headlineText}${intelSection}`;
    } else if (safeMode === 'analysis') {
      if (isTechVariant) {
        systemPrompt = `${dateContext}

Analyze the tech/startup trend in 2-3 sentences.
Rules:
- Focus ONLY on technology implications: funding trends, AI developments, market shifts, product strategy
- IGNORE political implications, trade wars, government unless directly about tech policy
- Lead with the insight for tech industry
- Connect to startup ecosystem, VC trends, or technical implications`;
      } else {
        systemPrompt = `${dateContext}

Provide analysis in 2-3 sentences. Be direct and specific.
Rules:
- Lead with the insight - what's significant and why
- NEVER start with "Breaking news", "Tonight", "The key/dominant narrative is"
- Start with substance: "Iran faces...", "The escalation in...", "Multiple signals suggest..."
- CRITICAL FOCAL POINTS are your main actors - explain WHY they matter
- If focal points show news-signal correlation, flag as escalation
- Connect dots, be specific about implications`;
      }
      userPrompt = isTechVariant
        ? `What's the key tech trend or development?\n${headlineText}${intelSection}`
        : `What's the key pattern or risk?\n${headlineText}${intelSection}`;
    } else {
      systemPrompt = isTechVariant
        ? `${dateContext}\n\nSynthesize tech news in 2 sentences. Focus on startups, AI, funding, products. Ignore politics unless directly about tech regulation.`
        : `${dateContext}\n\nSynthesize in 2 sentences max. Lead with substance. NEVER start with "Breaking news" or "Tonight" - just state the insight directly. CRITICAL focal points with news-signal convergence are significant.`;
      userPrompt = `Key takeaway:\n${headlineText}${intelSection}`;
    }

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 150,
        top_p: 0.9,
      }),
    });

    clearTimeout(fetchTimeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Groq] API error:', response.status, errorText);

      // Return fallback signal for rate limiting
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited', fallback: true }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Upstream API error', fallback: true }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      return new Response(JSON.stringify({ error: 'Empty response', fallback: true }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Store in cache
    await setCachedJson(cacheKey, {
      summary,
      model: MODEL,
      timestamp: Date.now(),
    }, CACHE_TTL_SECONDS);

    return new Response(JSON.stringify({
      summary,
      model: MODEL,
      provider: 'groq',
      cached: false,
      tokens: data.usage?.total_tokens || 0,
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=300',
      },
    });

  } catch (error) {
    console.error('[Groq] Error:', error.name, error.message, error.stack?.split('\n')[1]);
    const isTimeout = error.name === 'AbortError';
    return new Response(JSON.stringify({
      error: isTimeout ? 'Request timeout' : 'Internal server error',
      fallback: true
    }), {
      status: isTimeout ? 504 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
