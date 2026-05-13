# @agent-voice-chat/react

React components and hooks for integrating AI voice chat into your application.

## Installation

```bash
npm install @agent-voice-chat/react @agent-voice-chat/core
```

## Quick Start

### Drop-in Component

```tsx
import { VoiceChat } from '@agent-voice-chat/react';

function App() {
  return (
    <VoiceChat
      server="http://localhost:3000"
      agent="bob"
      theme="dark"
      onMessage={(msg) => console.log(msg)}
      onConnect={() => console.log('connected')}
    />
  );
}
```

### Custom UI with Hook

```tsx
import { useVoiceChat, AudioVisualizer } from '@agent-voice-chat/react';

function CustomVoiceUI() {
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
  });

  return (
    <div>
      <button onClick={isConnected ? disconnect : connect}>
        {isConnected ? 'Disconnect' : 'Connect'}
      </button>
      <button onClick={isListening ? stopListening : startListening}>
        {isListening ? 'Stop' : 'Listen'}
      </button>
      <AudioVisualizer level={audioLevel} />
      {messages.map((m) => (
        <p key={m.id}>
          {m.name}: {m.text}
        </p>
      ))}
    </div>
  );
}
```

## API

### `<VoiceChat />` Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `server` | `string` | required | WebSocket server URL |
| `agent` | `string` | required | Agent identifier |
| `room` | `string` | — | Optional room to join |
| `theme` | `'light' \| 'dark'` | `'dark'` | Color theme |
| `agentName` | `string` | — | Display name override |
| `autoConnect` | `boolean` | `true` | Connect on mount |
| `pushToTalk` | `boolean` | `false` | Push-to-talk mode |
| `showTranscript` | `boolean` | `true` | Show message transcript |
| `onMessage` | `(msg) => void` | — | Message callback |
| `onConnect` | `() => void` | — | Connected callback |
| `onDisconnect` | `() => void` | — | Disconnected callback |
| `onError` | `(err) => void` | — | Error callback |
| `className` | `string` | — | CSS class |
| `style` | `CSSProperties` | — | Inline styles |

### `useVoiceChat(options)`

Returns an object with connection controls, state, and messages. See TypeScript types for full details.

### `<AudioVisualizer />`

A bar-style audio level visualizer. Pass `level` (0–1) and optional styling props.
