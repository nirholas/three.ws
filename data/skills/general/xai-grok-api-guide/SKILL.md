---
name: xai-grok-api-guide
description: Guide to the xAI Grok API — Elon Musk's AI model with real-time X/Twitter data access. Covers Grok-2 and Grok-3 models, function calling, vision, long context, and unique features like X search integration and real-time knowledge cutoff.
license: MIT
metadata:
  category: general
  difficulty: intermediate
  author: nich
  tags: [general, xai-grok-api-guide]
---

# xAI Grok API Guide

Grok is xAI's frontier AI model with native X (Twitter) data access. This guide covers API usage, models, and integration patterns.

## Why Grok?

| Feature | Grok Advantage |
|---------|---------------|
| **Real-time X data** | Access to live tweets, trending topics |
| **No knowledge cutoff** | Trained on latest data continuously |
| **Humor/personality** | More engaging conversational style |
| **Function calling** | Full tool support |
| **Vision** | Image understanding |
| **Long context** | 128K+ context window |

## Models

| Model | Context | Best For | Price (1M tokens) |
|-------|---------|---------|------------------|
| **Grok-3** | 128K | Complex reasoning, analysis | $5 / $15 |
| **Grok-2** | 128K | General tasks, faster | $2 / $10 |
| **Grok-2-mini** | 128K | Quick responses, budget | $0.50 / $2 |

## Quick Start

```bash
curl https://api.x.ai/v1/chat/completions \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-3",
    "messages": [
      {"role": "user", "content": "What is trending in crypto on X right now?"}
    ]
  }'
```

## OpenAI-Compatible API

```typescript
import OpenAI from 'openai';

const xai = new OpenAI({
  baseURL: 'https://api.x.ai/v1',
  apiKey: process.env.XAI_API_KEY,
});

const response = await xai.chat.completions.create({
  model: 'grok-3',
  messages: [
    { role: 'system', content: 'You are a crypto market analyst.' },
    { role: 'user', content: 'Analyze $SPA on X/Twitter.' }
  ]
});
```

## Function Calling

```typescript
const response = await xai.chat.completions.create({
  model: 'grok-3',
  messages: [{ role: 'user', content: 'What is the price of SPA?' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'getTokenPrice',
        description: 'Get the current price of a cryptocurrency token',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Token symbol (e.g., SPA, ETH)' },
            chain: { type: 'string', description: 'Blockchain (e.g., arbitrum)' }
          },
          required: ['symbol']
        }
      }
    }
  ]
});
```

## X/Twitter Integration

Grok has unique access to X data:

### Searching X
```typescript
const response = await xai.chat.completions.create({
  model: 'grok-3',
  messages: [
    {
      role: 'user',
      content: 'Search X for posts about Sperax USDs and summarize the sentiment'
    }
  ]
});
// Grok natively searches X and returns real-time results
```

### Trending Analysis
```typescript
const response = await xai.chat.completions.create({
  model: 'grok-3',
  messages: [
    { role: 'user', content: 'What crypto topics are trending on X in the last 24 hours?' }
  ]
});
```

## Use Cases for Crypto

| Use Case | Model | Advantage |
|----------|-------|-----------|
| **Sentiment analysis** | Grok-3 | Native X data access |
| **Trending tokens** | Grok-3 | Real-time social data |
| **News monitoring** | Grok-2 | Fast, always current |
| **Community pulse** | Grok-3 | X conversation analysis |
| **Influencer tracking** | Grok-2 | Track crypto influencers on X |

## SperaxOS Integration

Grok is available as a model provider in SperaxOS:

```env
XAI_API_KEY=xai-...
```

Best used for:
- X/Twitter social intelligence tools
- Real-time crypto news analysis
- Community sentiment monitoring
- Social-first agent personalities

## Links

- API: https://x.ai/api
- Docs: https://docs.x.ai
- Model Card: https://x.ai/blog/grok
- SperaxOS: https://app.sperax.io
