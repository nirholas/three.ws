# Vue Guide

Use the `@agent-voice-chat/vue` package for Vue 3 integration with components and composables.

## Installation

```bash
npm install @agent-voice-chat/vue
```

Peer dependencies: `vue >= 3.3`

## Quick Start

```vue
<template>
  <VoiceChat server="https://your-server.com" agent="bob" />
</template>

<script setup>
import { VoiceChat } from '@agent-voice-chat/vue';
</script>
```

This renders a full voice chat UI with mic control, chat transcript, and agent status.

## VoiceChat Component

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `server` | string | Yes | — | Server URL |
| `agent` | string | No | First agent | Agent ID |
| `room` | string | No | `"default"` | Room ID |
| `theme` | `"dark"` \| `"light"` | No | `"dark"` | Color scheme |
| `showTranscript` | boolean | No | `true` | Show text chat panel |
| `showStatus` | boolean | No | `true` | Show agent status |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message` | `Message` | Fired on each new message |
| `status-change` | `string` | Fired on status change |
| `error` | `Error` | Fired on errors |

### Example

```vue
<template>
  <div class="support-page">
    <h1>Need help?</h1>
    <VoiceChat
      server="https://api.example.com"
      agent="support-bot"
      :room="`support-${userId}`"
      @message="onMessage"
      @error="onError"
    />
  </div>
</template>

<script setup>
import { VoiceChat } from '@agent-voice-chat/vue';

const userId = 'user-123';

function onMessage(msg) {
  console.log(`${msg.name}: ${msg.text}`);
}

function onError(err) {
  console.error('Voice chat error:', err);
}
</script>
```

## useVoiceChat Composable

For custom UIs, use the composable directly:

```vue
<template>
  <div>
    <p>Status: {{ status }}</p>

    <div class="messages">
      <div v-for="msg in messages" :key="msg.id">
        <strong>{{ msg.name }}:</strong> {{ msg.text }}
      </div>
    </div>

    <button @click="toggleMic">
      {{ isMicActive ? 'Stop' : 'Start' }} Mic
    </button>

    <input
      v-model="textInput"
      @keyup.enter="sendMessage(textInput); textInput = ''"
      placeholder="Type a message..."
    />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useVoiceChat } from '@agent-voice-chat/vue';

const textInput = ref('');

const {
  status,
  messages,
  isConnected,
  isMicActive,
  currentAgent,
  connect,
  disconnect,
  toggleMic,
  sendMessage,
} = useVoiceChat({
  server: 'https://your-server.com',
  agent: 'bob',
  room: 'my-room',
});
</script>
```

### Composable Options

```typescript
useVoiceChat({
  server: string;          // Required
  agent?: string;          // Agent ID (default: first agent)
  room?: string;           // Room ID (default: "default")
  autoConnect?: boolean;   // Connect on mount (default: true)
  onMessage?: (msg: Message) => void;
  onStatusChange?: (status: Status) => void;
  onError?: (error: Error) => void;
})
```

### Return Values

All return values are Vue `ref()`s (reactive):

| Property | Type | Description |
|----------|------|-------------|
| `status` | Ref\<string\> | Current status |
| `messages` | Ref\<Message[]\> | Conversation history |
| `isConnected` | Ref\<boolean\> | Socket connected |
| `isMicActive` | Ref\<boolean\> | Mic is capturing |
| `currentAgent` | Ref\<Agent \| null\> | Connected agent info |
| `connect` | function | Connect to server |
| `disconnect` | function | Disconnect |
| `toggleMic` | function | Toggle mic capture |
| `sendMessage` | function | Send text message |

## Nuxt Integration

```vue
<!-- pages/chat.vue -->
<template>
  <div>
    <h1>Voice Chat</h1>
    <ClientOnly>
      <VoiceChat
        :server="runtimeConfig.public.voiceServer"
        agent="bob"
      />
    </ClientOnly>
  </div>
</template>

<script setup>
import { VoiceChat } from '@agent-voice-chat/vue';

const runtimeConfig = useRuntimeConfig();
</script>
```

Add to `nuxt.config.ts`:
```typescript
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      voiceServer: 'https://your-server.com'
    }
  }
});
```

> **Note:** The voice chat component uses browser APIs (microphone, audio playback), so it must render client-side only. Wrap it in `<ClientOnly>` in Nuxt.


