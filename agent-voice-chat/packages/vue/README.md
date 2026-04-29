# @agent-voice-chat/vue

Vue components and composables for integrating AI voice chat into your application.

## Installation

```bash
npm install @agent-voice-chat/vue @agent-voice-chat/core
```

## Quick Start

### Drop-in Component

```vue
<template>
  <VoiceChat
    server="http://localhost:3000"
    agent="bob"
    theme="dark"
    @message="onMessage"
    @connect="onConnect"
  />
</template>

<script setup>
import { VoiceChat } from '@agent-voice-chat/vue'

const onMessage = (msg) => console.log(msg)
const onConnect = () => console.log('connected')
</script>
```

### Custom UI with Composable

```vue
<template>
  <div>
    <button @click="isConnected ? disconnect() : connect()">
      {{ isConnected ? 'Disconnect' : 'Connect' }}
    </button>
    <button @click="isListening ? stopListening() : startListening()">
      {{ isListening ? 'Stop' : 'Listen' }}
    </button>
    <AudioVisualizer :level="audioLevel" />
    <p v-for="m in messages" :key="m.id">{{ m.name }}: {{ m.text }}</p>
  </div>
</template>

<script setup>
import { useVoiceChat, AudioVisualizer } from '@agent-voice-chat/vue'

const {
  connect,
  disconnect,
  sendMessage,
  startListening,
  stopListening,
  isConnected,
  isListening,
  isSpeaking,
  audioLevel,
  messages,
} = useVoiceChat({
  server: 'http://localhost:3000',
  agent: 'bob',
})
</script>
```

## API

### `<VoiceChat />` Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `server` | `string` | required | WebSocket server URL |
| `agent` | `string` | required | Agent identifier |
| `room` | `string` | — | Optional room to join |
| `theme` | `'light' \| 'dark'` | `'dark'` | Color theme |
| `agent-name` | `string` | — | Display name override |
| `auto-connect` | `boolean` | `true` | Connect on mount |
| `push-to-talk` | `boolean` | `false` | Push-to-talk mode |
| `show-transcript` | `boolean` | `true` | Show message transcript |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `@message` | `Message` | Fired on each new message |
| `@connect` | — | Fired when connected |
| `@disconnect` | — | Fired when disconnected |
| `@error` | `Error` | Fired on error |

### `useVoiceChat(options)`

Returns reactive refs and methods for connection, audio, and messages. See TypeScript types for full details.

### `<AudioVisualizer />`

A bar-style audio level visualizer. Pass `:level` (0–1) and optional styling props.
