# Getting Started

Get from zero to a working voice chat in under 5 minutes.

## Prerequisites

- **Node.js 18+** — [download](https://nodejs.org)
- **An API key** from at least one provider:
  - [OpenAI](https://platform.openai.com/api-keys) — for OpenAI Realtime, Chat, or TTS
  - [Anthropic](https://console.anthropic.com/) — for Claude
  - [Groq](https://console.groq.com/) — for Groq LLM or Whisper STT
- **A microphone** — voice chat requires mic access in your browser

## Step 1: Clone and Install

```bash
git clone https://github.com/anthropics/agent-voice-chat.git
cd agent-voice-chat
npm install
```

## Step 2: Configure

Copy the example environment file and add your API key:

```bash
cp .env.example .env
```

Open `.env` in your editor. At minimum, set one provider and its API key:

**OpenAI Realtime (lowest latency, ~200ms):**
```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-proj-your-key-here
```

**Claude (great quality, ~900ms):**
```bash
AI_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-your-key-here
STT_PROVIDER=groq
GROQ_API_KEY=gsk_your-key-here
TTS_PROVIDER=openai
OPENAI_API_KEY=sk-proj-your-key-here
```

**Groq (fast and cheap, ~400ms):**
```bash
AI_PROVIDER=groq
GROQ_API_KEY=gsk_your-key-here
TTS_PROVIDER=openai
OPENAI_API_KEY=sk-proj-your-key-here
```

> **Note:** Non-realtime providers (Claude, Groq, OpenAI Chat) need separate STT and TTS services. See [Configuration](configuration.md) for all options.

## Step 3: Start the Server

```bash
npm start
```

You should see:

```
Server running on port 3000
AI Provider: openai (webrtc)
```

## Step 4: Open in Browser

Go to [http://localhost:3000](http://localhost:3000).

You'll see the landing page with two agents — **Bob** and **Alice**. Click on either agent to open a voice chat session.

1. Click the **microphone button** to allow mic access
2. Start talking — the agent will listen and respond with voice
3. The conversation appears as text in the chat panel

## Step 5: Try Text Input

If `INPUT_CHAT=true` in your `.env` (the default), you can also type messages in the text box. The agent will respond with both text and voice.

## What Just Happened?

Here's what's going on under the hood:

1. Your browser captures audio from your microphone
2. **WebRTC path** (OpenAI Realtime): Audio streams directly to OpenAI's API via WebRTC, and response audio streams back — all in real time
3. **Socket path** (Claude/Groq/OpenAI Chat): Audio is sent to the server via Socket.IO, transcribed to text (STT), sent to the LLM, and the response is converted to speech (TTS) and played back
4. Agents take turns via a server-managed queue so they don't talk over each other

## Next Steps

- [Configure providers and environment](configuration.md)
- [Create custom agent personalities](custom-agents.md)
- [Embed the widget on your website](embedding.md)
- [Deploy to production](deployment.md)
- [Understand the architecture](architecture.md)
