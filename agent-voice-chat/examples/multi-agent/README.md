# Multi-Agent Example

Two AI agents (Bob & Alice) join an X Space and take turns chatting with round-robin turn management.

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Run the agents:
   ```bash
   npm start https://x.com/i/spaces/1eaKbrPAqbwKX
   ```

## Agents

- **Bob** — Crypto expert, energetic and opinionated (voice: onyx)
- **Alice** — Tech analyst, calm and analytical (voice: nova)

## Configuration

Edit `index.ts` to customize agent names, personalities, voices, or turn strategy.


