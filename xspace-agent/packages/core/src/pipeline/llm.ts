// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Pipeline – LLM Provider Factory
// =============================================================================

import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import type { AIConfig, Message, ProviderMetrics } from '../types'
import type { LLMProvider, CustomProviderInterface } from './types'
import { ProviderError } from '../errors'
import { getMetrics } from '../observability/metrics'
import { getAppLogger } from '../observability/logger'

// ---------------------------------------------------------------------------
// Token estimation (≈4 chars per token; sufficient to prevent context overflow)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4': 8_192,
  'gpt-4-turbo': 128_000,
  'gpt-4-turbo-preview': 128_000,
  'gpt-3.5-turbo': 4_096,
  'claude-sonnet-4-20250514': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-sonnet-20240229': 200_000,
  'claude-3-haiku-20240307': 200_000,
  'llama-3.3-70b-versatile': 128_000,
  'llama-3.1-70b-versatile': 128_000,
  'llama-3.1-8b-instant': 128_000,
  'mixtral-8x7b-32768': 32_768,
}
const DEFAULT_CONTEXT_LIMIT = 8_192

function getContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT
}

/**
 * Trims conversation history so the total tokens fit within the model's
 * context window, always preserving the most recent user turn.
 */
function trimHistoryToTokenBudget(
  systemPrompt: string,
  history: Message[], // already includes the current user turn as last entry
  model: string,
  maxOutputTokens: number,
): Message[] {
  const contextLimit = getContextLimit(model)
  const budget = contextLimit - estimateTokens(systemPrompt) - maxOutputTokens - 64
  if (budget <= 0) return history.slice(-1)

  const trimmed = [...history]
  let used = trimmed.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  while (used > budget && trimmed.length > 1) {
    used -= estimateTokens(trimmed[0].content)
    trimmed.shift()
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// Streaming error type
// ---------------------------------------------------------------------------

export class LLMStreamError extends Error {
  constructor(
    message: string,
    public readonly partialText: string,
  ) {
    super(message)
    this.name = 'LLMStreamError'
  }
}

// ---------------------------------------------------------------------------
// Metrics helpers
// ---------------------------------------------------------------------------

function createMetrics(): ProviderMetrics {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    avgLatencyMs: 0,
    avgTimeToFirstTokenMs: 0,
  }
}

function recordMetric(
  metrics: ProviderMetrics,
  success: boolean,
  latencyMs: number,
  timeToFirstTokenMs: number,
  inputTokens: number,
  outputTokens: number,
  providerName?: string,
): void {
  metrics.requestCount++
  if (success) {
    metrics.successCount++
  } else {
    metrics.errorCount++
  }
  metrics.totalInputTokens += inputTokens
  metrics.totalOutputTokens += outputTokens
  const n = metrics.requestCount
  metrics.avgLatencyMs = (metrics.avgLatencyMs * (n - 1) + latencyMs) / n
  metrics.avgTimeToFirstTokenMs =
    (metrics.avgTimeToFirstTokenMs * (n - 1) + timeToFirstTokenMs) / n

  // Emit to global metrics collector
  const m = getMetrics()
  const labels: Record<string, string> = providerName ? { provider: providerName } : {}
  m.counter('xspace_llm_requests_total', 'Total LLM requests', labels)
  m.histogram('xspace_llm_latency_ms', latencyMs, 'LLM request latency', labels)
  if (timeToFirstTokenMs > 0) {
    m.histogram('xspace_llm_ttft_ms', timeToFirstTokenMs, 'LLM time to first token', labels)
  }
  m.counter('xspace_llm_tokens_input', 'Input tokens', labels, inputTokens)
  m.counter('xspace_llm_tokens_output', 'Output tokens', labels, outputTokens)
  if (!success) {
    m.counter('xspace_llm_errors_total', 'LLM request errors', labels)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureHistory(
  store: Record<number, Message[]>,
  agentId: number,
  maxHistory: number,
): void {
  if (!store[agentId]) store[agentId] = []
  if (store[agentId].length > maxHistory) {
    store[agentId] = store[agentId].slice(-maxHistory)
  }
}

function addToHistory(
  store: Record<number, Message[]>,
  agentId: number,
  role: 'user' | 'assistant',
  content: string,
  maxHistory: number,
): void {
  if (!store[agentId]) store[agentId] = []
  store[agentId].push({ role, content })
  if (store[agentId].length > maxHistory) {
    store[agentId] = store[agentId].slice(-maxHistory)
  }
}

// ---------------------------------------------------------------------------
// Claude (Anthropic)
// ---------------------------------------------------------------------------

function createClaudeLLM(config: AIConfig): LLMProvider {
  const log = getAppLogger('llm')
  const client = new Anthropic({ apiKey: config.apiKey })
  const model = config.model || 'claude-sonnet-4-20250514'
  const maxTokens = config.maxTokens || 300
  const maxHistory = config.maxHistory || 20
  const streamStartTimeout = config.timeout?.streamStart ?? 30_000
  const totalTimeout = config.timeout?.total ?? 120_000
  const history: Record<number, Message[]> = {}
  const metrics = createMetrics()

  const providerName = model.includes('haiku') ? 'claude-haiku' : 'claude-sonnet'
  // Pricing per 1M tokens
  const inputPrice = model.includes('haiku') ? 0.25 : 3.00
  const outputPrice = model.includes('haiku') ? 1.25 : 15.00

  return {
    name: providerName,
    type: 'socket',

    async *streamResponse(
      agentId: number,
      userText: string,
      systemPrompt: string,
    ): AsyncIterable<string> {
      ensureHistory(history, agentId, maxHistory)
      addToHistory(history, agentId, 'user', userText, maxHistory)

      const trimmedHistory = trimHistoryToTokenBudget(
        systemPrompt,
        history[agentId],
        model,
        maxTokens,
      )

      // Claude API only accepts 'user'|'assistant' in messages array
      const claudeMessages = trimmedHistory
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      const inputTokens =
        estimateTokens(systemPrompt) +
        claudeMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0)

      const requestStart = Date.now()
      let timeToFirstToken = 0
      let outputTokens = 0
      let streamCompleted = false

      const abortController = new AbortController()
      const streamStartTimer = setTimeout(
        () => abortController.abort(new Error(`Claude stream did not start within ${streamStartTimeout}ms`)),
        streamStartTimeout,
      )
      const totalTimer = setTimeout(
        () => abortController.abort(new Error(`Claude request exceeded total timeout of ${totalTimeout}ms`)),
        totalTimeout,
      )

      let stream: ReturnType<typeof client.messages.stream>
      try {
        stream = client.messages.stream(
          { model, max_tokens: maxTokens, system: systemPrompt, messages: claudeMessages },
          { signal: abortController.signal },
        )
      } catch (err: any) {
        clearTimeout(streamStartTimer)
        clearTimeout(totalTimer)
        recordMetric(metrics, false, Date.now() - requestStart, 0, inputTokens, 0, providerName)
        log.error({ err, provider: providerName }, 'LLM stream creation failed')
        throw err
      }

      let fullResponse = ''
      try {
        for await (const event of stream) {
          if (abortController.signal.aborted) break

          if (event.type === 'message_stop') {
            streamCompleted = true
            break
          }

          if (
            event.type === 'content_block_delta' &&
            (event.delta as { type: string; text?: string })?.type === 'text_delta'
          ) {
            if (timeToFirstToken === 0) {
              timeToFirstToken = Date.now() - requestStart
              clearTimeout(streamStartTimer)
            }
            const text = (event.delta as { text: string }).text
            outputTokens += estimateTokens(text)
            fullResponse += text
            yield text
          }
        }
      } catch (err: any) {
        clearTimeout(streamStartTimer)
        clearTimeout(totalTimer)
        recordMetric(metrics, false, Date.now() - requestStart, timeToFirstToken, inputTokens, outputTokens, providerName)
        log.error({ err, provider: providerName, latencyMs: Date.now() - requestStart }, 'LLM stream failed')
        if (abortController.signal.aborted) {
          throw new LLMStreamError(
            `Claude stream timed out after ${totalTimeout}ms`,
            fullResponse,
          )
        }
        throw err
      }

      clearTimeout(streamStartTimer)
      clearTimeout(totalTimer)

      if (!streamCompleted && fullResponse.length > 0) {
        recordMetric(metrics, false, Date.now() - requestStart, timeToFirstToken, inputTokens, outputTokens, providerName)
        throw new LLMStreamError(
          'Claude stream ended without a completion signal (incomplete response)',
          fullResponse,
        )
      }

      recordMetric(metrics, true, Date.now() - requestStart, timeToFirstToken, inputTokens, outputTokens, providerName)
      log.debug({ provider: providerName, latencyMs: Date.now() - requestStart, inputTokens, outputTokens }, 'LLM request completed')
      addToHistory(history, agentId, 'assistant', fullResponse, maxHistory)
    },

    clearHistory(agentId: number): void {
      history[agentId] = []
    },

    getMetrics(): ProviderMetrics {
      return { ...metrics }
    },

    estimateCost(inputTokens: number, outputTokens = 0): number {
      return (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice
    },

    async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
      const start = Date.now()
      try {
        await client.messages.create({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        })
        return { ok: true, latencyMs: Date.now() - start }
      } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err?.message ?? String(err) }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider  (shared by OpenAI and Groq)
// ---------------------------------------------------------------------------

function createOpenAICompatibleProvider(
  config: AIConfig,
  baseURL: string,
  defaultModel: string,
  providerLabel: string,
  inputPricePer1M: number,
  outputPricePer1M: number,
): LLMProvider {
  const log = getAppLogger('llm')
  const apiKey = config.apiKey ?? ''
  const model = config.model || defaultModel
  const maxTokens = config.maxTokens || 300
  const maxHistory = config.maxHistory || 20
  const streamStartTimeout = config.timeout?.streamStart ?? 30_000
  const totalTimeout = config.timeout?.total ?? 120_000
  const history: Record<number, Message[]> = {}
  const metrics = createMetrics()

  return {
    name: providerLabel,
    type: 'socket',

    async *streamResponse(
      agentId: number,
      userText: string,
      systemPrompt: string,
    ): AsyncIterable<string> {
      ensureHistory(history, agentId, maxHistory)
      addToHistory(history, agentId, 'user', userText, maxHistory)

      const trimmedHistory = trimHistoryToTokenBudget(
        systemPrompt,
        history[agentId],
        model,
        maxTokens,
      )

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...trimmedHistory,
      ]

      const inputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
      const requestStart = Date.now()
      let timeToFirstToken = 0
      let outputTokens = 0
      let streamCompleted = false

      const abortController = new AbortController()
      const streamStartTimer = setTimeout(
        () => abortController.abort(new Error(`LLM stream did not start within ${streamStartTimeout}ms`)),
        streamStartTimeout,
      )
      const totalTimer = setTimeout(
        () => abortController.abort(new Error(`LLM request exceeded total timeout of ${totalTimeout}ms`)),
        totalTimeout,
      )

      let response: any
      try {
        response = await axios.post(
          `${baseURL}/chat/completions`,
          { model, messages, max_tokens: maxTokens, stream: true },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            responseType: 'stream',
            signal: abortController.signal,
          },
        )
        // Connection established — cancel the stream-start deadline
        clearTimeout(streamStartTimer)
        timeToFirstToken = Date.now() - requestStart
      } catch (err: any) {
        clearTimeout(streamStartTimer)
        clearTimeout(totalTimer)
        recordMetric(metrics, false, Date.now() - requestStart, 0, inputTokens, 0, providerLabel)
        log.error({ err, provider: providerLabel }, 'LLM stream creation failed')
        if (abortController.signal.aborted) {
          throw new LLMStreamError(`LLM request timed out: ${err?.message ?? err}`, '')
        }
        throw err
      }

      let fullResponse = ''
      try {
        for await (const chunk of response.data) {
          if (abortController.signal.aborted) break

          const lines: string[] = chunk
            .toString()
            .split('\n')
            .filter((l: string) => l.startsWith('data: '))

          for (const line of lines) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') {
              streamCompleted = true
              break
            }
            try {
              const parsed = JSON.parse(data)
              const delta: string | undefined = parsed.choices?.[0]?.delta?.content
              if (delta) {
                outputTokens += estimateTokens(delta)
                fullResponse += delta
                yield delta
              }
            } catch {
              // skip malformed chunks
            }
          }
          if (streamCompleted) break
        }
      } catch (err: any) {
        clearTimeout(totalTimer)
        recordMetric(metrics, false, Date.now() - requestStart, timeToFirstToken, inputTokens, outputTokens, providerLabel)
        log.error({ err, provider: providerLabel, latencyMs: Date.now() - requestStart }, 'LLM stream failed')
        if (abortController.signal.aborted) {
          throw new LLMStreamError(
            `LLM stream timed out after ${totalTimeout}ms`,
            fullResponse,
          )
        }
        throw err
      }

      clearTimeout(totalTimer)

      if (!streamCompleted && fullResponse.length > 0) {
        recordMetric(metrics, false, Date.now() - requestStart, timeToFirstToken, inputTokens, outputTokens, providerLabel)
        throw new LLMStreamError(
          'LLM stream ended without a [DONE] signal (incomplete response)',
          fullResponse,
        )
      }

      recordMetric(metrics, true, Date.now() - requestStart, timeToFirstToken, inputTokens, outputTokens, providerLabel)
      log.debug({ provider: providerLabel, latencyMs: Date.now() - requestStart, inputTokens, outputTokens }, 'LLM request completed')
      addToHistory(history, agentId, 'assistant', fullResponse, maxHistory)
    },

    clearHistory(agentId: number): void {
      history[agentId] = []
    },

    getMetrics(): ProviderMetrics {
      return { ...metrics }
    },

    estimateCost(inputTokens: number, outputTokens = 0): number {
      return (inputTokens / 1_000_000) * inputPricePer1M + (outputTokens / 1_000_000) * outputPricePer1M
    },

    async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
      const start = Date.now()
      const abortController = new AbortController()
      const timer = setTimeout(() => abortController.abort(), 10_000)
      try {
        const res = await axios.post(
          `${baseURL}/chat/completions`,
          { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false },
          {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            signal: abortController.signal,
          },
        )
        clearTimeout(timer)
        return { ok: res.status >= 200 && res.status < 300, latencyMs: Date.now() - start }
      } catch (err: any) {
        clearTimeout(timer)
        return { ok: false, latencyMs: Date.now() - start, error: err?.message ?? String(err) }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Custom Provider Adapter
// ---------------------------------------------------------------------------

function createCustomLLM(config: AIConfig): LLMProvider {
  const custom: CustomProviderInterface = config.custom as CustomProviderInterface
  const maxHistory = config.maxHistory || 20
  const history: Record<number, Message[]> = {}
  const metrics = createMetrics()

  return {
    name: 'custom',
    type: 'socket',

    async *streamResponse(
      agentId: number,
      userText: string,
      systemPrompt: string,
    ): AsyncIterable<string> {
      if (!history[agentId]) history[agentId] = []
      history[agentId].push({ role: 'user', content: userText })
      if (history[agentId].length > maxHistory) {
        history[agentId] = history[agentId].slice(-maxHistory)
      }

      if (custom.generateResponseStream) {
        let full = ''
        for await (const delta of custom.generateResponseStream({
          messages: history[agentId],
          systemPrompt,
        })) {
          full += delta
          yield delta
        }
        history[agentId].push({ role: 'assistant', content: full })
      } else {
        const response = await custom.generateResponse({
          messages: history[agentId],
          systemPrompt,
        })
        history[agentId].push({ role: 'assistant', content: response })
        yield response
      }
    },

    clearHistory(agentId: number): void {
      history[agentId] = []
    },

    getMetrics(): ProviderMetrics {
      return { ...metrics }
    },

    estimateCost(): number {
      return 0 // Custom providers have opaque pricing
    },

    async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
      return { ok: true, latencyMs: 0 }
    },
  }
}

// ---------------------------------------------------------------------------
// Public Factory
// ---------------------------------------------------------------------------

export function createLLM(config: AIConfig): LLMProvider {
  switch (config.provider) {
    case 'claude':
      return createClaudeLLM(config)
    case 'groq':
      return createOpenAICompatibleProvider(
        config,
        'https://api.groq.com/openai/v1',
        'llama-3.3-70b-versatile',
        'groq-llama',
        0.05,   // input per 1M tokens
        0.08,   // output per 1M tokens
      )
    case 'openai': {
      const isMini = config.model?.includes('mini')
      return createOpenAICompatibleProvider(
        config,
        'https://api.openai.com/v1',
        'gpt-4o',
        isMini ? 'openai-gpt-4o-mini' : 'openai-gpt-4o',
        isMini ? 0.15 : 2.50,
        isMini ? 0.60 : 10.00,
      )
    }
    case 'custom':
      return createCustomLLM(config)
    default:
      throw new ProviderError(config.provider, 'initialization', `Unsupported LLM provider: ${config.provider}. Supported: openai, claude, groq, custom`)
  }
}


