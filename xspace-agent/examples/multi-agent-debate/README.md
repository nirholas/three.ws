# Multi-Agent Debate Example

Two AI agents — **Bull** (optimist, powered by OpenAI) and **Bear** (skeptic, powered by Claude) — debate a topic live in an X Space using round-robin turns.

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Run with a Space URL and optional debate topic:
   ```bash
   npm start https://x.com/i/spaces/1eaKbrPAqbwKX "Bitcoin will hit $1M by 2030"
   ```

## How It Works

- **Bull** uses OpenAI GPT-4o-mini with the `alloy` voice
- **Bear** uses Claude Sonnet with the `echo` voice
- Agents take turns every 2 seconds using round-robin strategy
- The debate runs for up to 20 turns, then concludes

## Configuration

- Edit `index.ts` to change agents, voices, turn strategy, or max turns
- Supported turn strategies: `round-robin`, `queue`, `director`
- Default debate topic: "AI will replace most software engineering jobs within 5 years"


