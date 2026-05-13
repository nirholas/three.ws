# Custom Providers

agent-voice-chat supports pluggable LLM, TTS, and STT providers. This guide shows how to add your own.

## Provider Architecture

There are two types of providers:

- **WebRTC providers** — audio streams directly between the browser and the API (e.g., OpenAI Realtime)
- **Socket providers** — audio goes through the server: mic → STT → LLM → TTS → playback

Socket providers are the most common type and the easiest to implement.

## Adding a New LLM Provider

### 1. Create the Provider File

Create a new file in `providers/`, e.g., `providers/my-provider.js`:

```javascript
const ConversationHistory = require('./conversation-history');

class MyProvider {
  constructor() {
    this.type = 'socket'; // or 'webrtc'
    this.history = new ConversationHistory(20);
    this.apiKey = process.env.MY_PROVIDER_API_KEY;

    if (!this.apiKey) {
      console.warn('[MyProvider] MY_PROVIDER_API_KEY not set');
    }
  }

  /**
   * Stream a response from the LLM.
   * @param {number} agentId - Which agent is responding
   * @param {string} userText - The user's message
   * @param {string} systemPrompt - The agent's system prompt
   * @yields {string} Text chunks as they arrive
   */
  async *streamResponse(agentId, userText, systemPrompt) {
    // Add user message to history
    this.history.add(agentId, 'user', userText);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.history.get(agentId)
    ];

    // Call your API with streaming
    const response = await fetch('https://api.my-provider.com/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'my-model',
        messages,
        stream: true,
        max_tokens: 300
      })
    });

    let fullText = '';

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') break;

        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          yield delta; // Emit each chunk
        }
      }
    }

    // Save assistant response to history
    this.history.add(agentId, 'assistant', fullText);
  }

  /**
   * Clear conversation history for an agent.
   */
  clearHistory(agentId) {
    this.history.clear(agentId);
  }
}

module.exports = MyProvider;
```

### 2. Register the Provider

Add your provider to `providers/index.js`:

```javascript
function getProvider(providerName) {
  switch (providerName) {
    case 'openai':
      return new (require('./openai-realtime'))();
    case 'openai-chat':
      return new (require('./openai-chat'))();
    case 'claude':
      return new (require('./claude'))();
    case 'groq':
      return new (require('./groq'))();
    case 'my-provider':  // Add this
      return new (require('./my-provider'))();
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}
```

### 3. Use It

Set the environment variable:

```bash
AI_PROVIDER=my-provider
MY_PROVIDER_API_KEY=your-key
```

## Provider Interface

### Socket Providers (required methods)

```typescript
interface SocketProvider {
  type: 'socket';

  // Stream LLM response chunks. Must be an async generator.
  streamResponse(
    agentId: number,
    userText: string,
    systemPrompt: string
  ): AsyncGenerator<string>;

  // Clear agent's conversation history.
  clearHistory(agentId: number): void;
}
```

### WebRTC Providers (required methods)

```typescript
interface WebRTCProvider {
  type: 'webrtc';

  // Create an ephemeral session token for the client.
  createSession(
    agentId: number,
    prompts: Record<number, string>,
    voices: Record<number, string>
  ): Promise<{ client_secret: { value: string } }>;
}
```

## Adding a New TTS Provider

Edit `providers/tts.js` to add your TTS service:

```javascript
async function synthesize(text, agentId) {
  const provider = process.env.TTS_PROVIDER;

  switch (provider) {
    case 'openai':
      return synthesizeOpenAI(text, agentId);
    case 'elevenlabs':
      return synthesizeElevenLabs(text, agentId);
    case 'my-tts':  // Add your provider
      return synthesizeMyTTS(text, agentId);
    case 'browser':
      return null; // Falls back to browser speech synthesis
  }
}

async function synthesizeMyTTS(text, agentId) {
  const voice = getVoice(agentId);

  const response = await fetch('https://api.my-tts.com/synthesize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MY_TTS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text, voice, format: 'mp3' })
  });

  // Must return an ArrayBuffer of audio data
  return response.arrayBuffer();
}
```

## Adding a New STT Provider

Edit `providers/stt.js`:

```javascript
async function transcribe(audioBuffer, mimeType) {
  const provider = process.env.STT_PROVIDER;

  switch (provider) {
    case 'groq':
      return transcribeGroq(audioBuffer, mimeType);
    case 'openai':
      return transcribeOpenAI(audioBuffer, mimeType);
    case 'my-stt':  // Add your provider
      return transcribeMySTT(audioBuffer, mimeType);
  }
}

async function transcribeMySTT(audioBuffer, mimeType) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('audio', audioBuffer, {
    filename: 'audio.webm',
    contentType: mimeType
  });

  const response = await fetch('https://api.my-stt.com/transcribe', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MY_STT_API_KEY}`
    },
    body: form
  });

  const result = await response.json();
  return result.text; // Must return the transcribed text string
}
```

## Conversation History

The `ConversationHistory` class manages per-agent message history:

```javascript
const ConversationHistory = require('./conversation-history');

const history = new ConversationHistory(20); // Max 20 messages per agent

history.add(agentId, 'user', 'Hello');
history.add(agentId, 'assistant', 'Hi there!');
history.get(agentId);   // [{ role: 'user', content: 'Hello' }, ...]
history.clear(agentId); // Reset for this agent
```

Use this in your provider to maintain conversation context. It automatically trims old messages when the limit is reached.

## Tips

- **Keep max_tokens low** (200–300) for voice responses. Long responses sound unnatural when spoken.
- **Handle errors gracefully.** If the API fails, throw an error — the server will catch it and release the agent's turn.
- **Test with text first.** Set `INPUT_CHAT=true` and type messages before testing with voice.
- **Reuse SSE parsing.** If your API uses OpenAI-compatible SSE format, look at `openai-chat.js` or `groq.js` for reference — they share the same parsing pattern.
