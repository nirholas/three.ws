import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import summarize from '../api/groq-summarize.js';
import classifyEvent from '../api/classify-event.js';
import classifyBatch from '../api/classify-batch.js';
import countryIntel from '../api/country-intel.js';
import { groqChat, GROQ_MODELS, GROQ_PRIMARY_MODEL } from '../api/_groq.js';
import openrouterSummarize from '../api/openrouter-summarize.js';
import agentTools from '../api/agent-tools.js';

/**
 * Groq stopped serving `llama-3.1-8b-instant` to the platform key (observed
 * 2026-11-13: HTTP 404 model_not_found), which silently broke every HQ route
 * that hardcoded it. This stub answers like Groq does today: the retired model
 * 404s, `blocked` models 429 on their per-model bucket, anything else answers.
 */
function groqUpstream({ reply, blocked = [] }) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    assert.equal(String(url), 'https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(init.body);
    seen.push(body);
    if (body.model === 'llama-3.1-8b-instant') {
      return new Response(JSON.stringify({ error: { message: `The model \`${body.model}\` does not exist or you do not have access to it.`, type: 'invalid_request_error', code: 'model_not_found' } }), { status: 404 });
    }
    if (blocked.includes(body.model)) {
      return new Response(JSON.stringify({ error: { message: 'Rate limit reached', type: 'tokens', code: 'rate_limit_exceeded' } }), { status: 429 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], usage: { total_tokens: 42 } }), { status: 200 });
  };
  return { fetchImpl, seen };
}

const post = (path, body) => new Request(`https://hq.example${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.20' }, body: JSON.stringify(body),
});

describe('HQ Groq routes use a model Groq still serves', () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.GROQ_API_KEY;
  beforeEach(() => { process.env.GROQ_API_KEY = 'gsk_test_only'; });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = realKey;
  });

  it('groq-summarize returns a summary instead of a 502', async () => {
    globalThis.fetch = groqUpstream({ reply: 'Solana USDC lending pays most on the larger venue.' }).fetchImpl;
    const res = await summarize(post('/api/groq-summarize', { headlines: ['synthetic USDC pool on Solana: 7.5% APY'], mode: 'analysis' }));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.summary, 'Solana USDC lending pays most on the larger venue.');
    assert.notEqual(j.model, 'llama-3.1-8b-instant');
  });

  it('classify-event classifies instead of passing the upstream 404 through', async () => {
    globalThis.fetch = groqUpstream({ reply: '{"level":"low","category":"tech"}' }).fetchImpl;
    const res = await classifyEvent(new Request('https://hq.example/api/classify-event?title=Synthetic%20validator%20client%20release%2011-13', { headers: { 'x-forwarded-for': '203.0.113.21' } }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).level, 'low');
  });

  it('classify-batch returns classifications instead of an all-null fallback', async () => {
    globalThis.fetch = groqUpstream({ reply: '[{"level":"medium","category":"economic"}]' }).fetchImpl;
    const res = await classifyBatch(post('/api/classify-batch', { titles: ['Synthetic stablecoin supply headline 11-13'] }));
    const j = await res.json();
    assert.equal(j.fallback, undefined);
    assert.equal(j.results[0].level, 'medium');
  });

  it('country-intel returns a brief instead of an AI service error', async () => {
    globalThis.fetch = groqUpstream({ reply: 'Monitoring shows no current military activity.' }).fetchImpl;
    const res = await countryIntel(post('/api/country-intel', { country: 'Testland', code: 'TL', context: { synthetic: '11-13' } }));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.brief, 'Monitoring shows no current military activity.');
    assert.notEqual(j.model, 'llama-3.1-8b-instant');
  });
});

describe('groqChat model fallback', () => {
  const payload = { messages: [{ role: 'user', content: 'hi' }], max_tokens: 50 };

  it('answers on the primary model when it is available', async () => {
    const up = groqUpstream({ reply: 'ok' });
    const r = await groqChat('k', payload, { fetchImpl: up.fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.model, GROQ_PRIMARY_MODEL);
    assert.equal(r.data.choices[0].message.content, 'ok');
    assert.equal(up.seen.length, 1);
  });

  it('moves to the next model when one is gone or rate limited, giving the reasoning fallback token headroom', async () => {
    const gone = groqUpstream({ reply: 'ok' });
    const r1 = await groqChat('k', payload, { fetchImpl: gone.fetchImpl, models: [{ id: 'llama-3.1-8b-instant' }, ...GROQ_MODELS] });
    assert.equal(r1.model, GROQ_PRIMARY_MODEL);

    const limited = groqUpstream({ reply: 'ok', blocked: [GROQ_PRIMARY_MODEL] });
    const r2 = await groqChat('k', payload, { fetchImpl: limited.fetchImpl });
    assert.equal(r2.ok, true);
    assert.equal(r2.model, GROQ_MODELS[1].id);
    assert.ok(limited.seen[1].max_tokens >= 512);
    assert.equal(limited.seen[0].max_tokens, 50);
  });

  // Observed 2026-11-13: qwen3.8-27b and gpt-oss-120b both hit their per-model
  // tokens-per-day cap while the platform's instant model (api/_lib/llm.js
  // GROQ_INSTANT_MODEL) still answered on the same key, so HQ narration went
  // dark with a healthy Groq bucket left unused.
  it('reaches the instant model when both larger models are out of daily tokens', async () => {
    const up = groqUpstream({ reply: 'ok', blocked: ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'] });
    const r = await groqChat('k', payload, { fetchImpl: up.fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'openai/gpt-oss-20b');
    assert.equal(up.seen.at(-1).reasoning_effort, 'low');
    assert.equal(up.seen.at(-1).include_reasoning, false);
    assert.ok(up.seen.at(-1).max_tokens >= 512);
  });

  it('stops on a non-model error such as a bad key and reports it', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 }); };
    const r = await groqChat('bad', payload, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.match(r.errorText, /Invalid API Key/);
    assert.equal(calls, 1);
  });

  it('reports the last failure when every model is exhausted', async () => {
    const up = groqUpstream({ reply: 'ok', blocked: GROQ_MODELS.map((m) => m.id) });
    const r = await groqChat('k', payload, { fetchImpl: up.fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.status, 429);
    assert.equal(up.seen.length, GROQ_MODELS.length);
  });
});

/**
 * OpenRouter retired the `:free` twin of meta-llama/llama-3.3-70b-instruct
 * (observed 2026-11-13: HTTP 404 "This model is unavailable for free"). A
 * `:free` id is the only kind HQ may send, so the paid slug is never a fix.
 */
function openrouterUpstream({ reply }) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body);
    seen.push({ body, headers: init.headers });
    if (body.model === 'meta-llama/llama-3.3-70b-instruct:free') {
      return new Response(JSON.stringify({ error: { message: 'This model is unavailable for free.', code: 404 } }), { status: 404 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }), { status: 200 });
  };
  return { fetchImpl, seen };
}

describe('openrouter-summarize uses a free model OpenRouter still serves', () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENROUTER_API_KEY;
  beforeEach(() => { process.env.OPENROUTER_API_KEY = 'sk-or-test-only'; });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = realKey;
  });

  it('returns a summary instead of a 502, and never sends a billable model id', async () => {
    const up = openrouterUpstream({ reply: 'USDC lending on Solana pays most on the smaller venue.' });
    globalThis.fetch = up.fetchImpl;
    const res = await openrouterSummarize(post('/api/openrouter-summarize', { headlines: ['synthetic USDC pool on Solana: 7.5% APY 11-13'], mode: 'analysis' }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).summary, 'USDC lending on Solana pays most on the smaller venue.');
    assert.match(up.seen[0].body.model, /:free$/);
    assert.doesNotMatch(up.seen[0].headers['HTTP-Referer'], /vercel/);
  });
});

describe('agent-tools narrate falls back like the HQ client does', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('uses openrouter-summarize when groq-summarize cannot answer', async () => {
    const hits = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      hits.push(path);
      if (path === '/api/defi-yields') {
        return new Response(JSON.stringify({ pools: [{ project: 'synthetic-lend', symbol: 'USDC', chain: 'Solana', apy: 7.5, tvlUsd: 5e7, stablecoin: true }] }), { status: 200 });
      }
      if (path === '/api/groq-summarize') return new Response(JSON.stringify({ error: 'Rate limited', fallback: true }), { status: 429 });
      if (path === '/api/openrouter-summarize') return new Response(JSON.stringify({ summary: 'One USDC pool on Solana pays 7.5%.' }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    const res = await agentTools(new Request('https://hq.example/api/agent-tools', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.30' },
      body: JSON.stringify({ question: 'best USDC yield on Solana?', narrate: true }),
    }));
    const j = await res.json();
    assert.equal(j.narrative, 'One USDC pool on Solana pays 7.5%.');
    assert.equal(j.narrativeProvider, 'openrouter');
    assert.deepEqual(hits.filter((h) => h.endsWith('-summarize')), ['/api/groq-summarize', '/api/openrouter-summarize']);
  });
});
