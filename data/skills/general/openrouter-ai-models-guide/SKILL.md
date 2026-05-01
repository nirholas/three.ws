---
name: openrouter-ai-models-guide
description: Guide to OpenRouter — the unified API for 200+ AI models from OpenAI, Anthropic, Google, Meta, Mistral, and more. Covers model selection, pricing, routing strategies, fallback chains, and integration with SperaxOS for optimal model usage per task.
license: MIT
metadata:
  category: general
  difficulty: intermediate
  author: nich
  tags: [general, openrouter-ai-models-guide]
---

# OpenRouter AI Models Guide

OpenRouter provides a unified API for 200+ AI models. This guide covers model selection, pricing, routing, and integration with SperaxOS.

## What Is OpenRouter?

A single API endpoint that routes requests to 200+ models:

```
Your App → OpenRouter API → Model Provider
                              ├── OpenAI (GPT-4, o1, o3)
                              ├── Anthropic (Claude 4, Sonnet, Haiku)
                              ├── Google (Gemini 2.5, Pro, Flash)
                              ├── Meta (Llama 4, Maverick)
                              ├── Mistral (Large, Medium)
                              ├── DeepSeek (V3, R1)
                              └── 50+ more providers
```

## Quick Start

```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Model Selection Guide

### By Task

| Task | Recommended Model | Why |
|------|------------------|-----|
| **Complex reasoning** | claude-sonnet-4, o3 | Best logical reasoning |
| **Coding** | claude-sonnet-4, deepseek-v3 | Best code generation |
| **Creative writing** | claude-sonnet-4, gpt-4o | Most creative output |
| **Fast responses** | gemini-flash, claude-haiku | Lowest latency |
| **Long context** | gemini-pro-2.5 (1M), claude-sonnet-4 (200K) | Largest context windows |
| **DeFi analysis** | claude-sonnet-4, gpt-4o | Best structured data handling |
| **Vision/images** | gpt-4o, gemini-pro | Best image understanding |
| **JSON output** | claude-sonnet-4, gpt-4o | Most reliable structured output |
| **Budget** | deepseek-v3, llama-4 | Cheapest per token |

### By Price (per 1M tokens)

| Tier | Input | Output | Models |
|------|-------|--------|--------|
| **Free** | $0 | $0 | Selected models with limits |
| **Budget** | $0.10-0.50 | $0.30-1.50 | DeepSeek, Llama, Gemma |
| **Standard** | $1-5 | $3-15 | GPT-4o, Claude Sonnet, Gemini Pro |
| **Premium** | $10-15 | $30-60 | o3, Claude Opus |

### By Context Window

| Model | Context | Best For |
|-------|---------|---------|
| Gemini 2.5 Pro | 1,048,576 | Entire codebases |
| Claude Sonnet 4 | 200,000 | Long documents |
| GPT-4o | 128,000 | Standard tasks |
| DeepSeek V3 | 64,000 | Budget long-context |

## Routing Strategies

### Automatic Routing
Let OpenRouter pick the best model:
```json
{
  "model": "openrouter/auto",
  "messages": [...]
}
```

### Fallback Chain
Define fallback models if primary is unavailable:
```json
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "route": "fallback",
  "models": [
    "anthropic/claude-sonnet-4-20250514",
    "openai/gpt-4o",
    "google/gemini-2.5-pro"
  ]
}
```

### Cheapest Route
Use the cheapest available model for a task:
```json
{
  "model": "openrouter/cheapest",
  "max_price": { "prompt": 0.001, "completion": 0.003 }
}
```

## SperaxOS Integration

SperaxOS uses OpenRouter as a model provider:

### Configuration
```env
# .env
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL_LIST=anthropic/claude-sonnet-4-20250514,openai/gpt-4o,google/gemini-2.5-pro
```

### Model Data File
SperaxOS maintains a curated model list at `data/openrouter-models.ts`:
- Pre-selected models optimized for DeFi/crypto tasks
- Pricing and capability metadata
- Context window sizes
- Feature flags (vision, function calling, JSON mode)

### Per-Agent Model Selection
Different SperaxOS agents can use different models:
- **DeFi Advisor**: Claude Sonnet 4 (best reasoning)
- **Quick Chat**: Gemini Flash (fastest response)
- **Code Assistant**: DeepSeek V3 (budget coding)
- **Research Agent**: Gemini 2.5 Pro (largest context)

## API Compatibility

OpenRouter is compatible with:
- OpenAI SDK (just change base URL)
- LangChain
- LlamaIndex
- Vercel AI SDK
- Any OpenAI-compatible client

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});
```

## Links

- Website: https://openrouter.ai
- Docs: https://openrouter.ai/docs
- Models: https://openrouter.ai/models
- GitHub: https://github.com/nirholas/openrouter-models
- SperaxOS: https://app.sperax.io
