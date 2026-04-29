# API Reference

Complete API reference for the `xspace-agent` SDK.

## Core Classes

| Class | Description |
|-------|-------------|
| [XSpaceAgent](./xspace-agent.md) | Create and manage a single AI voice agent in X Spaces |
| [AgentTeam](./agent-team.md) | Manage multiple AI agents in a single X Space |

## Configuration Types

All configuration interfaces are documented in [Configuration](./configuration.md):

| Type | Description |
|------|-------------|
| [AgentConfig](./configuration.md#agentconfig) | Top-level agent configuration |
| [AuthConfig](./configuration.md#authconfig) | X authentication options |
| [AIConfig](./configuration.md#aiconfig) | LLM provider, model, and prompt settings |
| [VoiceConfig](./configuration.md#voiceconfig) | TTS provider and voice selection |
| [BrowserConfig](./configuration.md#browserconfig) | Headless browser options |
| [BehaviorConfig](./configuration.md#behaviorconfig) | Auto-respond, silence threshold, turn delay |
| [AgentTeamConfig](./configuration.md#agentteamconfig) | Multi-agent team configuration |
| [TeamAgentConfig](./configuration.md#teamagentconfig) | Individual agent within a team |
| [TurnManagementConfig](./configuration.md#turnmanagementconfig) | Turn-taking strategy |

## Event & Message Types

| Type | Description |
|------|-------------|
| [AgentStatus](./configuration.md#agentstatus) | Agent lifecycle status values |
| [Message](./configuration.md#message) | Conversation message shape |
| [TranscriptionEvent](./configuration.md#transcriptionevent) | Speech-to-text result |
| [ResponseEvent](./configuration.md#responseevent) | Agent response with optional audio |
| [SpeakerEvent](./configuration.md#speakerevent) | Speaker join/leave payload |
| [MiddlewareStage](./configuration.md#middlewarestage) | Pipeline middleware hook points |

## Provider Interfaces

| Type | Description |
|------|-------------|
| [LLMProvider](./configuration.md#llmprovider) | LLM provider contract |
| [STTProvider](./configuration.md#sttprovider) | Speech-to-text provider contract |
| [TTSProvider](./configuration.md#ttsprovider) | Text-to-speech provider contract |
| [CustomProvider](./configuration.md#customprovider) | Custom LLM integration |
| [ProviderMetrics](./configuration.md#providermetrics) | Provider health/usage metrics |

## Factory Functions

Documented in [Factories](./factories.md):

| Function | Description |
|----------|-------------|
| [createLLM](./factories.md#createllm) | Create an LLM provider instance |
| [createSTT](./factories.md#createstt) | Create a speech-to-text provider instance |
| [createTTS](./factories.md#createtts) | Create a text-to-speech provider instance |

## Audio Utilities

Documented in [Audio Utilities](./audio-utilities.md):

| Export | Description |
|--------|-------------|
| [VoiceActivityDetector](./audio-utilities.md#voiceactivitydetector) | Detect speech segments in audio streams |
| [pcmChunksToWav](./audio-utilities.md#pcmchunkstowav) | Convert PCM float32 buffers to WAV |
| [mp3ToPcmFloat32](./audio-utilities.md#mp3topcmfloat32) | Convert MP3 to PCM float32 |

## Quick Start

```ts
import { XSpaceAgent } from 'xspace-agent'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN, ct0: process.env.X_CT0 },
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    systemPrompt: 'You are a helpful voice assistant.',
  },
})

agent.on('transcription', ({ speaker, text }) => {
  console.log(`${speaker}: ${text}`)
})

agent.on('response', ({ text }) => {
  console.log(`Agent: ${text}`)
})

await agent.join('https://x.com/i/spaces/1eaKbrPAqbwKX')
```


