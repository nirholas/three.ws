# Configuration

All configuration is done through environment variables (`.env` file) and the agent config file (`agents.config.json`).

## Environment Variables

### AI Provider

```bash
# Which LLM provider to use for generating responses.
# Options: "openai" | "openai-chat" | "claude" | "groq"
#
# "openai"      — OpenAI Realtime API via WebRTC (lowest latency, ~200ms)
# "openai-chat" — OpenAI Chat Completions API (streaming, ~800ms)
# "claude"      — Anthropic Claude API (streaming, ~900ms)
# "groq"        — Groq API with Llama models (streaming, ~400ms)
AI_PROVIDER=openai
```

### API Keys

```bash
# OpenAI — required for: openai provider, openai-chat provider, openai TTS, openai STT
OPENAI_API_KEY=sk-proj-...

# Anthropic — required for: claude provider
ANTHROPIC_API_KEY=sk-ant-...

# Groq — required for: groq provider, groq STT
GROQ_API_KEY=gsk_...

# ElevenLabs — required only if TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
```

### Speech-to-Text (STT)

```bash
# Which service transcribes user speech to text.
# Only used with socket-based providers (openai-chat, claude, groq).
# The openai realtime provider handles STT internally via WebRTC.
#
# Options: "groq" | "openai"
# - groq: Uses Groq's Whisper Large V3 (fast, requires GROQ_API_KEY)
# - openai: Uses OpenAI's Whisper (requires OPENAI_API_KEY)
STT_PROVIDER=groq
```

### Text-to-Speech (TTS)

```bash
# Which service converts agent text to spoken audio.
# Only used with socket-based providers.
#
# Options: "openai" | "elevenlabs" | "browser"
# - openai: OpenAI TTS API (good quality, requires OPENAI_API_KEY)
# - elevenlabs: ElevenLabs API (best quality, requires ELEVENLABS_API_KEY)
# - browser: Browser's built-in speech synthesis (free, lower quality)
TTS_PROVIDER=openai

# ElevenLabs voice IDs (optional, defaults are provided)
# Find voice IDs at https://elevenlabs.io/voice-library
ELEVENLABS_VOICE_0=your-voice-id-for-agent-0
ELEVENLABS_VOICE_1=your-voice-id-for-agent-1
```

### Server

```bash
# Port the server listens on.
PORT=3000

# Display name shown in the UI header.
PROJECT_NAME=AI Agents

# Enable/disable the text input box in the UI.
# Set to "false" for voice-only mode.
INPUT_CHAT=true

# Custom avatar URLs for agents (optional).
# If not set, default avatars are used.
AVATAR_URL_1=https://example.com/avatar1.png
AVATAR_URL_2=https://example.com/avatar2.png
```

## Security

### Authentication

API key authentication is optional. When the `API_KEY` environment variable is set, all REST and Socket.IO endpoints require a valid token. When unset, the server runs in open mode with no access control — suitable for local development only.

```bash
# Generate a strong random key (recommended: 32+ characters)
API_KEY=$(openssl rand -hex 32)
```

> **Note:** This is a single shared key, not per-user authentication. All clients use the same key. For multi-user access control, place a reverse proxy or API gateway in front of the server.

#### REST API

Include the key as a Bearer token in the `Authorization` header:

```bash
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Requests with a missing or invalid token receive a `401` response:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid Authorization header. Use: Bearer <API_KEY>"
  }
}
```

#### Socket.IO

Pass the key in the handshake `auth` object (recommended):

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: { token: "YOUR_API_KEY" }
});
```

Or as a query parameter:

```js
const socket = io("http://localhost:3000", {
  query: { token: "YOUR_API_KEY" }
});
```

Connections without a valid token are rejected with an `Authentication required` error before the socket opens.

#### Unauthenticated Endpoints

These endpoints are always open, regardless of `API_KEY`:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Health check — returns server status, uptime, and provider connectivity |
| `GET /config` | Legacy config endpoint — returns UI settings (project name, avatars, input mode) |
| Static files (`/`) | The built-in web UI |

#### Authentication Summary

| `API_KEY` set? | `/api/*` routes | Socket.IO | Startup log |
|----------------|----------------|-----------|-------------|
| No | Open | Open | `WARN: API_KEY is not set — API endpoints are unprotected` |
| Yes | Require `Bearer` token | Require handshake token | `INFO: API key authentication enabled` |

### CORS

Cross-Origin Resource Sharing controls which domains can make requests to the server.

```bash
# Comma-separated list of allowed origins
CORS_ORIGINS=https://myapp.com,https://admin.myapp.com
```

| `CORS_ORIGINS` | `NODE_ENV` | Behavior |
|----------------|------------|----------|
| Not set | `development` | All origins allowed (permissive) |
| Not set | `production` | Same-origin only (restrictive) |
| Set | Any | Only listed origins allowed, credentials supported |

### Rate Limiting

Rate limits are applied per IP address using a sliding 1-minute window. Exceeding the limit returns a `429 Too Many Requests` response with a `Retry-After` header.

```bash
# Requests per minute per IP
RATE_LIMIT_GENERAL=100    # General API endpoints (default: 100)
RATE_LIMIT_MESSAGE=20     # POST /api/agents/:id/message — LLM calls (default: 20)
RATE_LIMIT_SESSION=5      # GET /session/:agentId — creates billable OpenAI Realtime sessions (default: 5)
```

Socket.IO events are also rate-limited per socket using an in-memory counter with the same 1-minute window.

### HTTP Security Headers

The server uses [Helmet](https://helmetjs.github.io/) to set security headers automatically. Key defaults:

```bash
# Controls whether the page can be embedded in iframes
# Options: "SAMEORIGIN" (default) | "DENY"
X_FRAME_OPTIONS=SAMEORIGIN
```

Headers applied include:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | Allows `self`, inline styles/scripts, WebSocket/WebRTC connections, OpenAI API |
| `X-Frame-Options` | `SAMEORIGIN` (or `DENY` if configured) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Embedder-Policy` | Disabled (required for WebRTC) |

### Input Sanitization

All user-submitted text is automatically sanitized before it reaches the LLM:

- **HTML stripping** — all HTML tags are removed
- **Prompt injection filtering** — known injection patterns (`[SYSTEM]`, `[INST]`, `<|im_start|>`, etc.) are stripped
- **Length limit** — messages are truncated to 2,000 characters
- **Audio size limit** — audio payloads are capped at 5 MB
- **JSON body limit** — request bodies are capped at 1 MB

### Production Checklist

When deploying to a public environment:

1. **Set `API_KEY`** to a strong random value (32+ hex characters)
2. **Set `NODE_ENV=production`** — enables strict CORS, JSON logging
3. **Set `CORS_ORIGINS`** to your frontend domain(s)
4. **Use HTTPS** — required for browser microphone access
5. **Review rate limits** — lower `RATE_LIMIT_SESSION` if cost is a concern (each session creates a billable OpenAI Realtime connection)
6. **Set `X_FRAME_OPTIONS=DENY`** if you don't need iframe embedding

## Provider Setup Matrix

Not sure which keys you need? Find your provider below:

| Provider | Required Keys | Optional |
|----------|--------------|----------|
| `openai` (Realtime) | `OPENAI_API_KEY` | — |
| `openai-chat` | `OPENAI_API_KEY`, + STT key | `ELEVENLABS_API_KEY` |
| `claude` | `ANTHROPIC_API_KEY`, + STT key, + TTS key | — |
| `groq` | `GROQ_API_KEY`, + TTS key | — |

**STT key** = `GROQ_API_KEY` (if `STT_PROVIDER=groq`) or `OPENAI_API_KEY` (if `STT_PROVIDER=openai`)
**TTS key** = `OPENAI_API_KEY` (if `TTS_PROVIDER=openai`) or `ELEVENLABS_API_KEY` (if `TTS_PROVIDER=elevenlabs`) or none (if `TTS_PROVIDER=browser`)

## agents.config.json

This file defines your agent personalities, voices, and visual themes. It lives in the project root.

### Full Schema

```json
{
  "agents": [
    {
      "id": "bob",
      "name": "Bob",
      "personality": "You're Bob. Energetic and quick-witted...",
      "voice": "verse",
      "avatar": "/assets/bob.png",
      "theme": {
        "primary": "#818cf8",
        "gradient": ["#667eea", "#764ba2"],
        "background": ["#1a1a2e", "#16213e"]
      }
    }
  ],
  "basePrompt": "System prompt shared by all agents...",
  "defaults": {
    "voice": "alloy",
    "maxHistoryLength": 50
  }
}
```

### Field Reference

#### Agent Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier, used in URLs and API calls |
| `name` | string | Yes | Display name shown in the UI |
| `personality` | string | Yes | Agent-specific system prompt, appended to `basePrompt` |
| `voice` | string | No | Voice ID for TTS. OpenAI voices: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`, `verse`, `sage`. ElevenLabs: use env vars |
| `avatar` | string | No | Path or URL to avatar image |
| `theme.primary` | string | No | Primary accent color (hex) |
| `theme.gradient` | string[] | No | Two-color gradient for the agent's UI |
| `theme.background` | string[] | No | Two-color gradient for page background |

#### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `basePrompt` | string | System prompt prepended to every agent's personality |
| `defaults.voice` | string | Fallback voice if agent doesn't specify one |
| `defaults.maxHistoryLength` | number | Max conversation messages kept per agent (default: 50) |

### How Prompts Work

The final system prompt sent to the LLM is:

```
{basePrompt}

{agent.personality}
```

This lets you define shared behavior (tone, format rules) in `basePrompt` and agent-specific traits in each agent's `personality` field.

## Minimal Configuration Examples

### Cheapest Setup (Groq + browser TTS)

```bash
AI_PROVIDER=groq
GROQ_API_KEY=gsk_...
TTS_PROVIDER=browser
```

Cost: Groq free tier covers moderate usage. Browser TTS is free.

### Best Quality (OpenAI Realtime)

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...
```

Everything runs through OpenAI's Realtime API — no separate STT/TTS needed.

### Best Voice Quality (Claude + ElevenLabs)

```bash
AI_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
STT_PROVIDER=groq
GROQ_API_KEY=gsk_...
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
```


