/**
 * Shared Groq chat client for HQ's LLM routes (summaries, classification,
 * country briefs).
 *
 * Groq retires models without notice to the caller: on 2026-11-13 the platform
 * key started getting HTTP 404 model_not_found for `llama-3.1-8b-instant`, and
 * every HQ route that hardcoded it went dark. Routes now ask for an ordered
 * model list and move to the next model when one is gone or its per-model
 * token bucket is exhausted. Any other failure (bad key, malformed request)
 * stops immediately, because a different model would not fix it.
 *
 * The primary matches the platform chain in api/_lib/llm.js (GROQ_MODEL), a
 * fast non-reasoning model that returns clean content. The fallback is the
 * platform's large model, a reasoning model, so it runs at low effort with
 * enough token headroom that the answer is not consumed by reasoning.
 *
 * Groq meters daily tokens per model, so the last rung is the platform's
 * instant model (api/_lib/llm.js GROQ_INSTANT_MODEL) on its own bucket. On
 * 2026-11-13 both larger models hit their daily cap while it still answered.
 */

export const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const GROQ_MODELS = Object.freeze([
  Object.freeze({ id: 'qwen/qwen3.8-27b' }),
  Object.freeze({ id: 'openai/gpt-oss-120b', params: { reasoning_effort: 'low', include_reasoning: false }, minTokens: 512 }),
  Object.freeze({ id: 'openai/gpt-oss-20b', params: { reasoning_effort: 'low', include_reasoning: false }, minTokens: 512 }),
]);

export const GROQ_PRIMARY_MODEL = GROQ_MODELS[0].id;

function tryNextModel(status, errorText) {
  if (status === 404 || status === 429 || status === 503) return true;
  return status === 400 && /model_not_found|model_decommissioned|does not exist/i.test(errorText);
}

/**
 * POST one chat completion, walking the model list.
 * Returns `{ ok: true, model, data }` or `{ ok: false, model, status, errorText }`
 * describing the last attempt.
 */
export async function groqChat(apiKey, payload, { fetchImpl = fetch, signal, models = GROQ_MODELS } = {}) {
  let failure = null;
  for (const m of models) {
    const body = { ...payload, ...(m.params || {}), model: m.id };
    if (m.minTokens && Number.isFinite(payload.max_tokens)) body.max_tokens = Math.max(payload.max_tokens, m.minTokens);
    const res = await fetchImpl(GROQ_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true, model: m.id, data: await res.json() };
    const errorText = await res.text();
    failure = { ok: false, model: m.id, status: res.status, errorText };
    if (!tryNextModel(res.status, errorText)) return failure;
    console.warn(`[Groq] ${m.id} unavailable (HTTP ${res.status}), trying next model`);
  }
  return failure;
}
