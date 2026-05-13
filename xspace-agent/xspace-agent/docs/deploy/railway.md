# Deploy to Railway

## Quick Start

1. Fork this repo on GitHub
2. Create a new project at [railway.app](https://railway.app)
3. Click **"Deploy from GitHub repo"** and select your fork
4. Railway auto-detects the Dockerfile — no config needed
5. Add environment variables in the Railway dashboard (see below)
6. Deploy

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `X_AUTH_TOKEN` | X/Twitter auth token (or use username/password below) |
| `X_USERNAME` | X/Twitter username (if not using auth token) |
| `X_PASSWORD` | X/Twitter password (if not using auth token) |
| `OPENAI_API_KEY` | OpenAI API key (or other LLM provider key) |
| `ADMIN_API_KEY` | Secret key to protect the admin panel |

## Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `openai` | LLM provider: `openai`, `claude`, or `groq` |
| `AI_MODEL` | provider default | Model override |
| `TTS_PROVIDER` | `openai` | TTS provider: `openai` or `elevenlabs` |
| `ELEVENLABS_API_KEY` | — | Required if TTS_PROVIDER=elevenlabs |
| `SYSTEM_PROMPT` | default | Custom system prompt for the agent |

## Notes

- Railway Pro plan provides 8GB RAM — sufficient for Puppeteer/Chromium
- `BROWSER_MODE=managed` is set by default (no Chrome DevTools in cloud)
- Use Railway's persistent volumes for cookie/state storage:
  - Mount `/app/cookies` for auth persistence
  - Mount `/app/data` for agent state
- Health check is configured at `/health` — Railway will use it automatically


