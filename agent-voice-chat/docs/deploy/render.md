# Deploy to Render

## Quick Start

1. Create a new **Web Service** on [render.com](https://render.com)
2. Connect your GitHub repo
3. Render auto-detects the Dockerfile
4. Configure the service:
   - **Health Check Path**: `/health`
   - **Plan**: Standard or higher (needs 2GB+ RAM for Chromium)
5. Add environment variables in the Render dashboard
6. Deploy

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `X_AUTH_TOKEN` | X/Twitter auth token (or use username/password) |
| `X_USERNAME` | X/Twitter username (alternative to auth token) |
| `X_PASSWORD` | X/Twitter password (alternative to auth token) |
| `OPENAI_API_KEY` | OpenAI API key (or other LLM provider key) |
| `ADMIN_API_KEY` | Secret key for the admin panel |

## Persistent Storage

Render supports persistent disks. Create one and mount it:

- **Mount Path**: `/app/data`
- **Size**: 1GB is sufficient

This persists agent state and conversation history across deploys.

For cookie persistence (auth tokens), mount a second disk at `/app/cookies`.

## Notes

- The Dockerfile sets `HEADLESS=true` and `BROWSER_MODE=managed` by default
- Render's Standard plan provides 2GB RAM — sufficient for basic usage
- For heavy usage (multiple spaces), use the Pro plan (4GB+ RAM)
- Auto-deploy from GitHub is supported — push to main to redeploy


