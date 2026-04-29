# Basic Join Example

The absolute minimum — join an X Space with an AI agent in ~15 lines of code.

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Run the agent:
   ```bash
   npm start https://x.com/i/spaces/1eaKbrPAqbwKX
   ```

## What It Does

- Joins the specified X Space as a speaker
- Listens to other speakers via speech-to-text
- Responds using GPT-4o-mini with text-to-speech
- Prints all transcriptions and agent responses to the console

## Configuration

Edit `index.ts` to customize:
- `ai.model` — Change the LLM model
- `ai.systemPrompt` — Change the agent's personality
- `ai.provider` — Switch to `'claude'` or `'groq'`


