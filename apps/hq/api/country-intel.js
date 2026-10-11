/**
 * Country Intelligence Brief Endpoint
 * Generates AI-powered country situation briefs using Groq
 * Redis cached (2h TTL) for cross-user deduplication
 */

import { getCachedJson, setCachedJson, hashString } from './_upstash-cache.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

export const config = {
  runtime: 'edge',
};

const rateLimiter = createIpRateLimiter({ limit: 10, windowMs: 60_000 });

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';
const CACHE_TTL_SECONDS = 7200; // 2 hours
const CACHE_VERSION = 'ci-v2';

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
    return new Response(JSON.stringify({ intel: null, fallback: true, skipped: true, reason: 'GROQ_API_KEY not configured' }), {
      status: 200,
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
    const { country, code, context } = await request.json();

    if (!country || !code) {
      return new Response(JSON.stringify({ error: 'country and code required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cache key includes country code + context hash (context changes as data updates)
    const contextHash = context ? hashString(JSON.stringify(context)).slice(0, 8) : 'no-ctx';
    const cacheKey = `${CACHE_VERSION}:${code}:${contextHash}`;

    const cached = await getCachedJson(cacheKey);
    if (cached && typeof cached === 'object' && cached.brief) {
      return new Response(JSON.stringify({ ...cached, cached: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
      });
    }

    // Build data context section
    const dataLines = [];
    if (context?.score != null) {
      const changeStr = context.change24h ? ` (${context.change24h > 0 ? '+' : ''}${context.change24h} in 24h)` : '';
      dataLines.push(`Instability Score: ${context.score}/100 (${context.level || 'unknown'}) - trend: ${context.trend || 'unknown'}${changeStr}`);
    }
    if (context?.components) {
      const c = context.components;
      dataLines.push(`Score Components: Unrest ${c.unrest ?? '?'}/100, Security ${c.security ?? '?'}/100, Information ${c.information ?? '?'}/100`);
    }
    if (context?.protests != null) dataLines.push(`Active protests in/near country (7d): ${context.protests}`);
    if (context?.militaryFlights != null) dataLines.push(`Military aircraft detected in/near country: ${context.militaryFlights}`);
    if (context?.militaryVessels != null) dataLines.push(`Military vessels detected in/near country: ${context.militaryVessels}`);
    if (context?.outages != null) dataLines.push(`Internet outages: ${context.outages}`);
    if (context?.earthquakes != null) dataLines.push(`Recent earthquakes: ${context.earthquakes}`);
    if (context?.stockIndex) dataLines.push(`Stock Market Index: ${context.stockIndex}`);
    if (context?.convergenceScore != null) {
      dataLines.push(`Signal convergence score: ${context.convergenceScore}/100 (multiple signal types detected: ${(context.signalTypes || []).join(', ')})`);
    }
    if (context?.regionalConvergence?.length > 0) {
      dataLines.push(`\nRegional convergence alerts:`);
      context.regionalConvergence.forEach(r => dataLines.push(`- ${r}`));
    }
    if (context?.headlines?.length > 0) {
      dataLines.push(`\nRecent headlines mentioning ${country} (${context.headlines.length} found):`);
      context.headlines.slice(0, 15).forEach((h, i) => dataLines.push(`${i + 1}. ${h}`));
    }

    const dataSection = dataLines.length > 0
      ? `\nCURRENT SENSOR DATA:\n${dataLines.join('\n')}`
      : '\nNo real-time sensor data available for this country.';

    const dateStr = new Date().toISOString().split('T')[0];

    const systemPrompt = `You are a senior intelligence analyst providing comprehensive country situation briefs. Current date: ${dateStr}. Donald Trump is the current US President (second term, inaugurated Jan 2025).

Write a thorough, data-driven intelligence brief for the requested country. Structure:

1. **Current Situation** - What is happening right now. Reference specific data: instability scores, protest counts, military presence, outages. Explain what the numbers mean in context.

2. **Military & Security Posture** - Analyze military activity in/near the country. What forces are present? What does the positioning suggest? What are foreign nations doing in this theater?

3. **Key Risk Factors** - What drives instability or stability. Connect the dots between different signals (protests + outages = potential crackdown? military buildup + diplomatic tensions = escalation risk?). Reference specific headlines.

4. **Regional Context** - How does this country's situation affect or relate to its neighbors and the broader region? Reference any convergence alerts.

5. **Outlook & Watch Items** - What to monitor in the near term. Be specific about indicators that would signal escalation or de-escalation.

Rules:
- Be specific and analytical. Reference the data provided (scores, counts, headlines, convergence).
- If data shows low activity, say so - don't manufacture threats.
- Connect signals: explain what combinations of data points suggest.
- 5-6 paragraphs, 300-400 words.
- No speculation beyond what the data supports.
- Use plain language, not jargon.
- If military assets are 0, don't speculate about military presence - say monitoring shows no current military activity.
- When referencing a specific headline from the numbered list, cite it as [N] where N is the headline number (e.g. "tensions escalated [3]"). Only cite headlines you directly reference.`;

    const userPrompt = `Country: ${country} (${code})${dataSection}`;

    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 900,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('[CountryIntel] Groq error:', groqRes.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error', fallback: true }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const groqData = await groqRes.json();
    const brief = groqData.choices?.[0]?.message?.content || '';

    const result = {
      brief,
      country,
      code,
      model: MODEL,
      generatedAt: new Date().toISOString(),
    };

    if (brief) {
      await setCachedJson(cacheKey, result, CACHE_TTL_SECONDS);
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
    });
  } catch (err) {
    console.error('[CountryIntel] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
