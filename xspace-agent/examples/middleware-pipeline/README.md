# Middleware Pipeline Example

Demonstrates the **middleware hook system** for processing audio and text at each stage of the agent pipeline: STT, LLM, and TTS.

## Pipeline

```
Audio In → [STT] → after:stt (noise filter) → [LLM] → before:llm (language detect)
                                                       after:llm  (safety filter)
         → [TTS] → after:tts (analytics)    → Audio Out
```

### Middleware Stages

1. **Noise filter** (`after:stt`) — Drops utterances shorter than 3 words
2. **Language detection** (`before:llm`) — Detects the speaker's language and instructs the LLM to respond in kind
3. **Safety filter** (`after:llm`) — Redacts SSNs, credit card numbers, and email addresses from responses
4. **Analytics** (`after:tts`) — Logs response count and audio buffer size

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

## Writing Your Own Middleware

```typescript
// Return the value to pass it through, or null to drop it
agent.use('after:stt', (transcription) => {
  // modify or filter transcriptions
  return transcription
})

// Modify the system prompt or messages before they reach the LLM
agent.use('before:llm', async (messages, systemPrompt) => {
  return { messages, systemPrompt }
})

// Transform LLM output before TTS
agent.use('after:llm', (response) => {
  return response.replace(/badword/gi, '***')
})

// Inspect or transform audio before playback
agent.use('after:tts', (audioBuffer) => {
  return audioBuffer
})
```


