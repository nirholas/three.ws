# Prompt: Multi-Platform Support (Beyond X Spaces)

## Why This Is the Growth Hack
X Spaces is the starting point, but the core technology — browser-based audio bridge + AI pipeline — works on **any** live audio platform. Expanding to Discord Stage Channels, Telegram Voice Chats, and others multiplies the addressable audience 10x.

This is how you go from "X Spaces bot" to "the universal AI voice agent framework."

## Platform Abstraction Layer

The key insight: separate the **platform** (how to join and handle audio) from the **brain** (AI pipeline). The brain stays the same; only the platform adapter changes.

```typescript
// Platform interface — each platform implements this
interface PlatformAdapter {
  readonly name: string

  // Lifecycle
  connect(config: PlatformConfig): Promise<void>
  join(roomId: string): Promise<void>
  leave(): Promise<void>
  disconnect(): Promise<void>

  // Audio
  onAudioChunk(callback: (chunk: Float32Array, speaker?: string) => void): void
  injectAudio(audio: Buffer): Promise<void>

  // Status
  getStatus(): PlatformStatus
  on(event: string, callback: (...args: any[]) => void): void
}
```

### Current Architecture (X Spaces only)
```
XSpaceAgent → x-spaces/ → Puppeteer → X.com
                           ↕ audio
                        AI Pipeline
```

### Target Architecture (Multi-Platform)
```
XSpaceAgent → PlatformAdapter → x-spaces/    → Puppeteer → X.com
                               → discord/     → Discord.js → Discord
                               → telegram/    → Telegraf   → Telegram
                               → custom/      → User-defined
                                   ↕ audio
                                AI Pipeline (shared)
```

## Supported Platforms

### 1. X/Twitter Spaces (existing)
Already built. Wrap existing `x-spaces/` module as a `PlatformAdapter`.

### 2. Discord Stage Channels
Discord's equivalent of Spaces. Large audience, developer-friendly community.

```typescript
// platforms/discord/adapter.ts
import { Client, VoiceConnection } from 'discord.js'
import { joinVoiceChannel, createAudioPlayer, createAudioResource } from '@discordjs/voice'

class DiscordAdapter implements PlatformAdapter {
  readonly name = 'discord'
  private client: Client
  private connection: VoiceConnection | null = null

  async connect(config: DiscordConfig) {
    this.client = new Client({ intents: [...] })
    await this.client.login(config.botToken)
  }

  async join(channelId: string) {
    const channel = await this.client.channels.fetch(channelId)
    this.connection = joinVoiceChannel({
      channelId,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator
    })
    // Set up audio receive stream
    this.connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } })
  }

  async injectAudio(audio: Buffer) {
    const resource = createAudioResource(bufferToStream(audio))
    this.player.play(resource)
  }
}
```

**Advantages**: Native API (no Puppeteer), lower latency, proper audio codecs
**Challenge**: Need a Discord bot token, bot must be in the server

### 3. Telegram Voice Chats
Telegram groups can have live voice chats. Growing rapidly in crypto/Web3 communities.

```typescript
class TelegramAdapter implements PlatformAdapter {
  readonly name = 'telegram'
  // Uses tgcalls library for voice chat
  // Telegram Bot API for joining groups
}
```

**Note**: Telegram voice chat integration is more complex and may require `tgcalls` native library.

### 4. Generic WebRTC Room (Jitsi, LiveKit, etc.)
Support any WebRTC-based room:

```typescript
class WebRTCAdapter implements PlatformAdapter {
  readonly name = 'webrtc'
  // Connect to any WebRTC room via signaling server
  // Works with Jitsi, LiveKit, Daily.co, Livekit
}
```

### 5. Custom Platform (User-Defined)
Let users bring their own platform:

```typescript
const agent = new XSpaceAgent({
  platform: {
    adapter: {
      name: 'my-platform',
      async connect(config) { /* ... */ },
      async join(roomId) { /* ... */ },
      async leave() { /* ... */ },
      onAudioChunk(cb) { /* ... */ },
      async injectAudio(audio) { /* ... */ }
    }
  },
  ai: { /* same config as always */ }
})
```

## SDK Usage

```typescript
import { XSpaceAgent } from 'xspace-agent'
import { DiscordAdapter } from 'xspace-agent/platforms/discord'
import { XSpacesAdapter } from 'xspace-agent/platforms/x-spaces'

// Join X Space
const xAgent = new XSpaceAgent({
  platform: new XSpacesAdapter({ auth: { token: '...' } }),
  ai: { provider: 'openai', systemPrompt: '...' }
})
await xAgent.join('https://x.com/i/spaces/...')

// Same agent brain, different platform
const discordAgent = new XSpaceAgent({
  platform: new DiscordAdapter({ botToken: '...' }),
  ai: { provider: 'openai', systemPrompt: '...' }  // same AI config!
})
await discordAgent.join('channel-id-123')
```

The AI pipeline, middleware, memory, RAG — everything works the same regardless of platform. You're just swapping the audio transport.

## Package Structure
```
packages/
├── core/                          ← Platform-agnostic AI pipeline
├── platform-x-spaces/             ← X Spaces adapter (Puppeteer-based)
├── platform-discord/              ← Discord adapter (@discordjs/voice)
├── platform-telegram/             ← Telegram adapter (optional)
└── platform-webrtc/               ← Generic WebRTC adapter (optional)
```

Or as subpath exports:
```
xspace-agent                       ← core + x-spaces (default)
xspace-agent/platforms/discord     ← Discord adapter
xspace-agent/platforms/telegram    ← Telegram adapter
```

## Cross-Platform Scenarios

### Same Agent, Multiple Platforms Simultaneously
```typescript
const brain = {
  provider: 'claude',
  systemPrompt: 'You are a helpful community manager.'
}

const xAgent = new XSpaceAgent({ platform: new XSpacesAdapter({...}), ai: brain })
const discordAgent = new XSpaceAgent({ platform: new DiscordAdapter({...}), ai: brain })

// Agent is in both X Space and Discord simultaneously
await Promise.all([
  xAgent.join('https://x.com/i/spaces/...'),
  discordAgent.join('discord-channel-id')
])
```

### Bridge: X Space ↔ Discord
Forward audio between platforms:
```typescript
xAgent.on('transcription', ({ speaker, text }) => {
  // Someone spoke in X Space — forward to Discord
  discordAgent.say(`[X Space] ${speaker}: ${text}`)
})

discordAgent.on('transcription', ({ speaker, text }) => {
  // Someone spoke in Discord — forward to X Space
  xAgent.say(`[Discord] ${speaker}: ${text}`)
})
```

## Implementation Order
1. **Refactor**: Extract platform interface from existing x-spaces code
2. **Wrap**: Make x-spaces implement PlatformAdapter
3. **Test**: Ensure nothing breaks with the abstraction
4. **Discord**: Build Discord adapter (biggest audience demand)
5. **Custom**: Document custom adapter interface
6. **(Later)** Telegram, WebRTC adapters

## Validation
- [ ] Existing X Spaces functionality works through PlatformAdapter
- [ ] Discord adapter can join a voice channel and speak
- [ ] Same AI config works across both platforms
- [ ] Custom adapter interface is documented and usable
- [ ] Platform-specific dependencies are optional (not bundled in core)


