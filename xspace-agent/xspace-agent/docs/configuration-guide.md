# Configuration Guide

This guide covers how to configure xspace-agent's AI pipeline: choosing providers, managing costs, setting up fallbacks, and integrating custom providers.

For the full list of environment variables, see `.env.example` in the repository root.

---

## Table of Contents

1. [Choosing an LLM Provider](#1-choosing-an-llm-provider)
2. [Choosing an STT Provider](#2-choosing-an-stt-provider)
3. [Choosing a TTS Provider](#3-choosing-a-tts-provider)
4. [Cost Management](#4-cost-management)
5. [Provider Fallback with ProviderRouter](#5-provider-fallback-with-providerrouter)
6. [Custom Provider Integration](#6-custom-provider-integration)

---

## 1. Choosing an LLM Provider

Set `AI_PROVIDER` in your `.env` or pass `ai.provider` in `AgentConfig`. Four options are available:

### OpenAI (`openai`)

- **Models**: `gpt-4o` (default), `gpt-4o-mini`
- **Latency**: ~200ms via Realtime API (WebRTC), ~800ms via Chat Completions
- **Strengths**: Best overall quality, lowest latency when using Realtime mode, handles STT/TTS internally in Realtime mode
- **Weaknesses**: Most expensive per token
- **Pricing**: gpt-4o costs $2.50/1M input tokens, $10.00/1M output tokens. gpt-4o-mini costs $0.15/1M input, $0.60/1M output.
- **Context window**: 128K tokens

```typescript
const agent = new XSpaceAgent({
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o',          // or 'gpt-4o-mini' for lower cost
    systemPrompt: 'You are a helpful assistant.',
    maxTokens: 300,
  },
  // ...
});
```

### Claude / Anthropic (`claude`)

- **Models**: `claude-sonnet-4-20250514` (default), `claude-3-haiku-20240307`
- **Latency**: ~900ms (streaming via Chat API)
- **Strengths**: Strong reasoning, excellent instruction following, 200K context window
- **Weaknesses**: Higher latency than OpenAI/Groq, requires separate STT and TTS providers
- **Pricing**: Sonnet costs $3.00/1M input, $15.00/1M output. Haiku costs $0.25/1M input, $1.25/1M output.
- **Context window**: 200K tokens

```typescript
const agent = new XSpaceAgent({
  ai: {
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-sonnet-4-20250514',
    systemPrompt: 'You are a witty podcast host.',
  },
  // Claude requires a separate STT provider
  // STT defaults to Groq Whisper
});
```

### Groq (`groq`)

- **Models**: `llama-3.3-70b-versatile` (default), `llama-3.1-8b-instant`, `mixtral-8x7b-32768`
- **Latency**: ~400ms (streaming)
- **Strengths**: Fastest inference, cheapest pricing, free STT tier
- **Weaknesses**: Lower quality than GPT-4o or Claude Sonnet on complex reasoning, requires separate TTS
- **Pricing**: $0.05/1M input, $0.08/1M output (Llama 3.3 70B)
- **Context window**: 128K tokens (Llama models), 32K (Mixtral)

```typescript
const agent = new XSpaceAgent({
  ai: {
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY!,
    model: 'llama-3.3-70b-versatile',
    systemPrompt: 'You are a tech expert.',
  },
  voice: { provider: 'browser' }, // Free TTS for lowest cost
});
```

### Quick Comparison

| Provider | Latency | Quality | Cost | Context |
|----------|---------|---------|------|---------|
| OpenAI gpt-4o | ~200-800ms | Highest | $$$ | 128K |
| OpenAI gpt-4o-mini | ~200-800ms | Good | $ | 128K |
| Claude Sonnet | ~900ms | High | $$$ | 200K |
| Claude Haiku | ~900ms | Good | $ | 200K |
| Groq Llama 3.3 70B | ~400ms | Good | $ | 128K |

### Recommendation

- **Best quality**: OpenAI `gpt-4o` or Claude Sonnet
- **Best latency**: OpenAI Realtime or Groq
- **Lowest cost**: Groq with browser TTS
- **Longest context**: Claude (200K tokens)

---

## 2. Choosing an STT Provider

Set `STT_PROVIDER` in `.env` or configure via the `createSTT()` factory. STT is only needed when using socket-based providers (openai-chat, claude, groq). The OpenAI Realtime provider handles STT internally.

### Groq Whisper (`groq`) -- Default

- **Model**: `whisper-large-v3`
- **Pricing**: Free tier (no per-minute cost)
- **Latency**: Fast
- **Quality**: Excellent -- same Whisper Large V3 model as OpenAI, running on Groq hardware

```bash
STT_PROVIDER=groq
GROQ_API_KEY=gsk_...
```

### OpenAI Whisper (`openai`)

- **Model**: `whisper-1`
- **Pricing**: $0.006 per minute of audio
- **Latency**: Moderate
- **Quality**: Excellent

```bash
STT_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

### Recommendation

Use **Groq Whisper** unless you are already using OpenAI for everything and want to minimize the number of API keys. Groq Whisper uses the same model at no cost.

---

## 3. Choosing a TTS Provider

Set `TTS_PROVIDER` in `.env` or pass `voice.provider` in `AgentConfig`. The provider is auto-detected if not explicitly set: ElevenLabs (if key present) > OpenAI (if key present) > Browser.

### ElevenLabs (`elevenlabs`)

- **Quality**: Best -- natural, expressive voices with multilingual support
- **Pricing**: ~$0.03 per 1,000 characters
- **Latency**: Moderate (~500ms)
- **Features**: Streaming synthesis (`synthesizeStream`), per-agent voice mapping, stability/similarity controls
- **Voices**: Large library of pre-made and cloned voices

```typescript
const agent = new XSpaceAgent({
  ai: { /* ... */ },
  voice: {
    provider: 'elevenlabs',
    apiKey: process.env.ELEVENLABS_API_KEY!,
    voiceId: 'VR6AewLTigWG4xSOukaG',  // Optional: override default
    stability: 0.7,                      // Voice consistency (0-1)
  },
});
```

Per-agent voice mapping for multi-agent setups:

```bash
ELEVENLABS_VOICE_0=VR6AewLTigWG4xSOukaG   # Agent 0
ELEVENLABS_VOICE_1=TxGEqnHWrfWFTfGW9XjX   # Agent 1
```

### OpenAI TTS (`openai`)

- **Quality**: Good -- clear, consistent voices
- **Pricing**: ~$0.015 per 1,000 characters
- **Latency**: Fast (~300ms)
- **Voices**: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

```typescript
const agent = new XSpaceAgent({
  ai: { /* ... */ },
  voice: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    voiceId: 'nova',
  },
});
```

Default voice mapping: Agent 0 = `onyx`, Agent 1 = `nova`.

### Browser TTS (`browser`)

- **Quality**: Low -- robotic, varies by browser/OS
- **Pricing**: Free
- **Latency**: Instant (client-side)
- **Use case**: Development, testing, or zero-cost deployments

```typescript
const agent = new XSpaceAgent({
  ai: { /* ... */ },
  voice: { provider: 'browser' },
});
```

The server returns `null` from `synthesize()` and the client handles synthesis in the browser via the Web Speech API.

### Quick Comparison

| Provider | Quality | Cost per 1K chars | Streaming | Voice Cloning |
|----------|---------|-------------------|-----------|---------------|
| ElevenLabs | Best | $0.030 | Yes | Yes |
| OpenAI TTS | Good | $0.015 | No | No |
| Browser | Low | Free | N/A | No |

### Recommendation

- **Production**: ElevenLabs for best voice quality, OpenAI for good quality at lower cost
- **Development**: Browser TTS to avoid API costs during testing
- **Budget-conscious**: OpenAI TTS offers a good balance

---

## 4. Cost Management

### Budget Configuration

The `CostTracker` class tracks per-provider costs in real time. It records every LLM, STT, and TTS request with USD cost estimates.

```typescript
import { CostTracker } from 'xspace-agent';

const tracker = new CostTracker();

// Track an LLM call (provider name, input tokens, output tokens)
tracker.trackLLM('openai-gpt-4o', 500, 200);
tracker.trackSTT('groq-whisper', 30);          // 30 seconds of audio
tracker.trackTTS('elevenlabs-tts', 150);        // 150 characters

// Get a summary
const summary = tracker.getSummary();
// { total: 0.0059, byProvider: {...}, byType: {...}, requestCount: 3 }

// Filter by time
const lastHour = tracker.getSummary(Date.now() - 3_600_000);
```

### Cost Estimation

Every provider exposes an `estimateCost()` method:

```typescript
const llm = createLLM({ provider: 'openai', apiKey: '...', systemPrompt: '...' });
const estimated = llm.estimateCost(1000, 300); // 1000 input tokens, 300 output
// => 0.0055 USD for gpt-4o

const tts = createTTS({ provider: 'elevenlabs', apiKey: '...' });
const ttsCost = tts.estimateCost(500); // 500 characters
// => 0.015 USD
```

### Monitoring via Admin Panel

When using `@xspace/server`, cost data is available via REST endpoints:

- `GET /admin/providers/costs` -- Full cost breakdown
- `GET /admin/providers/costs?since=<timestamp>` -- Costs since a specific time
- `GET /admin/providers` -- Provider status including cumulative metrics

Socket.IO also emits `provider:cost` events for real-time dashboard updates.

### Cost-Saving Strategies

1. **Use Groq for LLM + STT**: At $0.05/1M input tokens and free STT, Groq is the cheapest option.
2. **Use Browser TTS**: Eliminates TTS costs entirely.
3. **Enable response caching**: Avoid duplicate LLM calls for repeated queries.
4. **Limit `maxTokens`**: Set `ai.maxTokens` to cap response length (default: 300).
5. **Use `gpt-4o-mini` or `claude-3-haiku`**: Budget-friendly models that are still capable.
6. **Use `cost-based` routing**: The ProviderRouter can automatically select the cheapest available provider.

### Response Caching

Enable caching to avoid redundant LLM calls:

```typescript
const agent = new XSpaceAgent({
  ai: {
    provider: 'openai',
    apiKey: '...',
    systemPrompt: '...',
    cache: {
      enabled: true,
      maxSize: 100,     // Max cached entries (LRU eviction)
      ttlMs: 300_000,   // 5-minute TTL
    },
  },
});
```

---

## 5. Provider Fallback with ProviderRouter

The `ProviderRouter` enables intelligent routing across multiple LLM providers with automatic failover.

### Routing Strategies

| Strategy | Description |
|----------|-------------|
| `primary-fallback` | Always use the primary provider; fall back to others on failure |
| `latency-based` | Route to the provider with the lowest average latency |
| `cost-based` | Route to the cheapest available provider |
| `smart` | Adaptive routing that considers a hint (`speed`, `quality`, or `cost`) |

### Setup

```typescript
import { ProviderRouter } from 'xspace-agent';
import { createLLM } from 'xspace-agent';

const openai = createLLM({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  systemPrompt: 'You are helpful.',
});

const groq = createLLM({
  provider: 'groq',
  apiKey: process.env.GROQ_API_KEY!,
  systemPrompt: 'You are helpful.',
});

const claude = createLLM({
  provider: 'claude',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  systemPrompt: 'You are helpful.',
});

const router = new ProviderRouter({
  providers: [openai, groq, claude],
  strategy: 'primary-fallback',
  primaryIndex: 0,              // OpenAI is primary
  healthRecheckMs: 30_000,      // Re-check failed providers every 30s
});
```

### Using the Router

```typescript
// Select the best provider based on strategy
const provider = router.select();
// Use it directly
for await (const chunk of provider.streamResponse(0, 'Hello', 'Be helpful.')) {
  process.stdout.write(chunk);
}

// Or use executeWithFallback for automatic retry on failure
const result = await router.executeWithFallback(async (provider) => {
  let text = '';
  for await (const chunk of provider.streamResponse(0, 'Hello', 'Be helpful.')) {
    text += chunk;
  }
  return text;
});
```

### Smart Routing with Hints

The `smart` strategy accepts a priority hint:

```typescript
const router = new ProviderRouter({
  providers: [openai, groq, claude],
  strategy: 'smart',
});

// For a quick status check, prioritize speed
const fastProvider = router.select('speed');

// For a detailed explanation, prioritize quality
const qualityProvider = router.select('quality');

// For bulk processing, prioritize cost
const cheapProvider = router.select('cost');
```

### Health Monitoring

The router performs automatic health checks. Failed providers are temporarily disabled and re-checked after `healthRecheckMs`:

```typescript
// Get status of all providers
const statuses = router.getStatuses();
// [{ name: 'openai-gpt-4o', healthy: true, enabled: true, metrics: {...} }, ...]

// Manually disable/enable a provider
router.disable('groq-llama');
router.enable('groq-llama');

// Force a health re-check
await router.checkAll();
```

---

## 6. Custom Provider Integration

Implement the `CustomProvider` interface to integrate any LLM:

### Basic Custom Provider

```typescript
import { XSpaceAgent } from 'xspace-agent';
import type { CustomProvider } from 'xspace-agent';

const myProvider: CustomProvider = {
  type: 'socket',

  async generateResponse({ messages, systemPrompt }) {
    // Call your custom LLM API
    const response = await fetch('https://my-llm.example.com/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system: systemPrompt }),
    });
    const data = await response.json();
    return data.text;
  },
};

const agent = new XSpaceAgent({
  ai: {
    provider: 'custom',
    systemPrompt: 'You are helpful.',
    custom: myProvider,
  },
  // ...
});
```

### Streaming Custom Provider

For lower latency, implement `generateResponseStream`:

```typescript
const myStreamingProvider: CustomProvider = {
  type: 'socket',

  async generateResponse({ messages, systemPrompt }) {
    // Fallback non-streaming implementation
    let result = '';
    for await (const chunk of this.generateResponseStream!({ messages, systemPrompt })) {
      result += chunk;
    }
    return result;
  },

  async *generateResponseStream({ messages, systemPrompt }) {
    const response = await fetch('https://my-llm.example.com/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system: systemPrompt }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  },
};
```

### Full LLMProvider Interface

For deeper integration (health checks, metrics, cost tracking, use with ProviderRouter), implement the full `LLMProvider` interface instead of `CustomProvider`:

```typescript
import type { LLMProvider, ProviderMetrics } from 'xspace-agent';

class MyLLMProvider implements LLMProvider {
  readonly name = 'my-provider';
  type = 'socket' as const;
  private metrics: ProviderMetrics = {
    requestCount: 0, successCount: 0, errorCount: 0,
    totalInputTokens: 0, totalOutputTokens: 0,
    avgLatencyMs: 0, avgTimeToFirstTokenMs: 0,
  };

  async *streamResponse(
    agentId: number,
    userText: string,
    systemPrompt: string,
  ): AsyncIterable<string> {
    const start = Date.now();
    this.metrics.requestCount++;

    try {
      // Your implementation here
      yield 'Hello from my provider!';
      this.metrics.successCount++;
      this.metrics.avgLatencyMs = Date.now() - start;
    } catch (err) {
      this.metrics.errorCount++;
      throw err;
    }
  }

  clearHistory(agentId: number): void {
    // Clear stored conversation history for the given agent
  }

  async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await fetch('https://my-llm.example.com/health');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message };
    }
  }

  getMetrics(): ProviderMetrics {
    return { ...this.metrics };
  }

  estimateCost(inputTokens: number, outputTokens = 0): number {
    // Your pricing logic
    return (inputTokens + outputTokens) / 1_000_000 * 1.00;
  }
}
```

This full implementation can be used directly with `ProviderRouter` for automatic failover and with `CostTracker` for cost monitoring.


