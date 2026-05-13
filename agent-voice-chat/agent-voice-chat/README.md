# agent-voice-chat

> Add multi-agent AI voice conversations to any website in minutes

[![License: All Rights Reserved](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

<!-- TODO: Add hero GIF/screenshot showing the widget in action -->

Users speak into their mic. AI agents listen, think, and talk back — in real time. Multiple agents can take turns in the same conversation, each with their own personality and voice.

## Features

- **Multi-agent voice conversations** — multiple AI agents with distinct personalities in one room
- **Multiple LLM providers** — OpenAI Realtime, OpenAI Chat, Claude, Groq
- **Embeddable widget** — add voice chat to any site with one `<script>` tag
- **React & Vue components** — first-class framework support
- **Real-time voice with WebRTC** — sub-200ms latency with OpenAI Realtime
- **Flexible audio pipeline** — STT + LLM + TTS for non-realtime providers
- **Customizable agents** — define personality, voice, avatar, and theme per agent
- **Room-based isolation** — multi-tenancy with independent conversation state
- **Full REST API** — manage agents, rooms, and messages programmatically

## Quick Start

### Option 1: Self-host the server

```bash
git clone https://github.com/anthropics/agent-voice-chat.git
cd agent-voice-chat
npm install
cp .env.example .env   # add your API key(s)
npm start
```

Open `http://localhost:3000` and start talking.

### Option 2: Embed anywhere (no framework needed)

```html
<script
  src="https://unpkg.com/agent-voice-chat/widget.js"
  data-server="https://your-server.com"
  data-agent="bob"
></script>
```

A floating voice chat button appears on your page. That's it.

### Option 3: React

```tsx
import { VoiceChat } from '@agent-voice-chat/react';

function App() {
  return <VoiceChat server="https://your-server.com" agent="bob" />;
}
```

### Option 4: Vue

```vue
<template>
  <VoiceChat server="https://your-server.com" agent="bob" />
</template>

<script setup>
import { VoiceChat } from '@agent-voice-chat/vue';
</script>
```

## Provider Comparison

| Provider | Type | Latency | Quality | Cost | Voice |
|----------|------|---------|---------|------|-------|
| OpenAI Realtime | WebRTC | ~200ms | Excellent | $$$$ | Native (built-in) |
| OpenAI Chat + TTS | Socket | ~800ms | Great | $$ | OpenAI TTS |
| Claude + TTS | Socket | ~900ms | Great | $$ | OpenAI / ElevenLabs |
| Groq + TTS | Socket | ~400ms | Good | $ | OpenAI / ElevenLabs |

**WebRTC** providers stream audio directly between browser and API — lowest latency.
**Socket** providers use a server-side pipeline: STT → LLM → TTS — more flexible, supports any LLM.

## How It Works

```
User speaks → Mic capture → Voice Activity Detection
  ├─ WebRTC path: audio stream ↔ OpenAI Realtime API (bidirectional)
  └─ Socket path: audio → Server STT → LLM → TTS → audio playback
```

Agents take turns via a server-managed turn queue, so multiple agents never talk over each other.

## Configuration

### Environment Variables

```bash
AI_PROVIDER=openai          # openai | openai-chat | claude | groq
OPENAI_API_KEY=sk-...       # Required for OpenAI providers and OpenAI TTS
ANTHROPIC_API_KEY=sk-ant-.. # Required for Claude provider
GROQ_API_KEY=gsk_...        # Required for Groq provider and Groq STT
STT_PROVIDER=groq           # groq | openai (for socket-based providers)
TTS_PROVIDER=openai         # openai | elevenlabs | browser
```

See [.env.example](.env.example) for all options.

### Agent Personalities

Define agents in `agents.config.json`:

```json
{
  "agents": [
    {
      "id": "bob",
      "name": "Bob",
      "personality": "You're Bob. Energetic, funny, and quick-witted.",
      "voice": "verse",
      "theme": { "primary": "#818cf8" }
    }
  ],
  "basePrompt": "You are hanging out on a voice chat. Keep responses short and casual."
}
```

See the [Custom Agents Guide](docs/custom-agents.md) for details.

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Clone, configure, and run in 5 minutes |
| [Configuration](docs/configuration.md) | All env vars and `agents.config.json` schema |
| [API Reference](docs/api-reference.md) | REST API endpoints |
| [Embedding Widget](docs/embedding.md) | Add voice chat to any website |
| [React Guide](docs/react-guide.md) | React component and hook usage |
| [Vue Guide](docs/vue-guide.md) | Vue component and composable usage |
| [Custom Providers](docs/custom-providers.md) | Add a new LLM, TTS, or STT provider |
| [Custom Agents](docs/custom-agents.md) | Create agent personalities |
| [Rooms](docs/rooms.md) | Room management and multi-tenancy |
| [Deployment](docs/deployment.md) | Deploy to Railway, Render, Docker, VPS |
| [Architecture](docs/architecture.md) | System diagram, data flow, protocol spec |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Project Structure

```
agent-voice-chat/
├── server.js                 # Express + Socket.IO server
├── agents.config.json        # Agent personality definitions
├── agent-registry.js         # Dynamic agent management
├── room-manager.js           # Room isolation and multi-tenancy
├── providers/
│   ├── index.js              # Provider factory
│   ├── openai-realtime.js    # WebRTC provider
│   ├── openai-chat.js        # OpenAI Chat API provider
│   ├── claude.js             # Anthropic Claude provider
│   ├── groq.js               # Groq provider
│   ├── stt.js                # Speech-to-text (Whisper)
│   ├── tts.js                # Text-to-speech
│   └── conversation-history.js
├── public/
│   ├── index.html            # Landing page
│   ├── voice.html            # Dynamic agent page
│   └── js/                   # Client-side audio + Socket.IO logic
└── packages/
    └── widget/               # Embeddable widget package
```

## Community

- [**Discord**](https://discord.gg/YOUR_INVITE_CODE) — Ask questions, share what you've built, show off your deployments
- [**GitHub Discussions**](https://github.com/nirholas/xspace-agent/discussions) — Longer-form Q&A, ideas, and show & tell
- [**GitHub Issues**](https://github.com/nirholas/xspace-agent/issues) — Bug reports and feature requests

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and how to submit a pull request.

## License

[All Rights Reserved](LICENSE)


