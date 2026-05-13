# Custom Provider Example

Use a **local LLM** (via Ollama) or any custom API as the AI backend for your X Space agent. The LLM runs on your machine — only TTS still uses a cloud API.

## Prerequisites

- [Ollama](https://ollama.ai) installed and running
- A model pulled: `ollama pull llama3`

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Make sure Ollama is running, then start:
   ```bash
   ollama serve &
   npm start https://x.com/i/spaces/1eaKbrPAqbwKX
   ```

## Adapting for Other Providers

The `CustomProvider` interface requires a single `generateResponse` method:

```typescript
const myProvider: CustomProvider = {
  type: 'socket',
  async generateResponse({ messages, systemPrompt }) {
    // Call any API, local model, or custom logic
    return 'The response text'
  }
}
```

This works with any backend: vLLM, llama.cpp, text-generation-webui, LM Studio, or your own API.

## Configuration

| Env Var | Description | Default |
|---------|-------------|---------|
| `X_AUTH_TOKEN` | X authentication token | *required* |
| `OPENAI_API_KEY` | OpenAI key for TTS | *required* |
| `OLLAMA_HOST` | Ollama server URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Ollama model name | `llama3` |


