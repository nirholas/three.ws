# React Guide

Use the `@agent-voice-chat/react` package for first-class React integration with components and hooks.

## Installation

```bash
npm install @agent-voice-chat/react
```

Peer dependencies: `react >= 18`

## Quick Start

```tsx
import { VoiceChat } from '@agent-voice-chat/react';

function App() {
  return (
    <VoiceChat
      server="https://your-server.com"
      agent="bob"
    />
  );
}
```

This renders a full voice chat UI — mic button, chat transcript, agent status indicator, and audio playback.

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
| `onMessage` | function | No | — | Called with each message |
| `onStatusChange` | function | No | — | Called on status change |
| `onError` | function | No | — | Called on errors |
| `className` | string | No | — | CSS class for wrapper |
| `style` | CSSProperties | No | — | Inline styles |

### Example: Customer Support Widget

```tsx
import { VoiceChat } from '@agent-voice-chat/react';

function SupportPage() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1>Need help?</h1>
      <p>Talk to our AI assistant:</p>

      <VoiceChat
        server="https://api.example.com"
        agent="support-bot"
        room={`support-${userId}`}
        onMessage={(msg) => {
          analytics.track('support_message', { agent: msg.name });
        }}
        onError={(err) => {
          console.error('Voice chat error:', err);
        }}
      />
    </div>
  );
}
```

## useVoiceChat Hook

For custom UIs, use the hook directly:

```tsx
import { useVoiceChat } from '@agent-voice-chat/react';

function CustomVoiceUI() {
  const {
    status,       // 'disconnected' | 'idle' | 'listening' | 'speaking'
    messages,     // Array of { id, agentId, name, text, isUser, timestamp }
    isConnected,
    isMicActive,
    currentAgent,
    connect,      // () => void
    disconnect,   // () => void
    toggleMic,    // () => void
    sendMessage,  // (text: string) => void
  } = useVoiceChat({
    server: 'https://your-server.com',
    agent: 'bob',
    room: 'my-room',
  });

  return (
    <div>
      <p>Status: {status}</p>

      <div>
        {messages.map((msg) => (
          <div key={msg.id}>
            <strong>{msg.name}:</strong> {msg.text}
          </div>
        ))}
      </div>

      <button onClick={toggleMic}>
        {isMicActive ? 'Stop' : 'Start'} Mic
      </button>

      <button onClick={() => sendMessage('Hello!')}>
        Send Text
      </button>
    </div>
  );
}
```

### Hook Options

```typescript
useVoiceChat({
  server: string;          // Required — server URL
  agent?: string;          // Agent ID (default: first agent)
  room?: string;           // Room ID (default: "default")
  autoConnect?: boolean;   // Connect on mount (default: true)
  onMessage?: (msg: Message) => void;
  onStatusChange?: (status: Status) => void;
  onError?: (error: Error) => void;
})
```

### Hook Return Values

| Property | Type | Description |
|----------|------|-------------|
| `status` | string | Current status |
| `messages` | Message[] | Conversation history |
| `isConnected` | boolean | Socket connected |
| `isMicActive` | boolean | Mic is capturing |
| `currentAgent` | Agent \| null | Connected agent info |
| `connect` | function | Connect to server |
| `disconnect` | function | Disconnect |
| `toggleMic` | function | Toggle mic capture |
| `sendMessage` | function | Send text message |

## Building a Language Tutor

```tsx
import { useVoiceChat } from '@agent-voice-chat/react';
import { useState } from 'react';

function LanguageTutor() {
  const [language, setLanguage] = useState('spanish');

  const { status, messages, toggleMic, isMicActive } = useVoiceChat({
    server: 'https://your-server.com',
    agent: `tutor-${language}`,
    room: `lesson-${userId}`,
  });

  return (
    <div>
      <h1>Language Tutor</h1>

      <select value={language} onChange={(e) => setLanguage(e.target.value)}>
        <option value="spanish">Spanish</option>
        <option value="french">French</option>
        <option value="japanese">Japanese</option>
      </select>

      <div className="transcript">
        {messages.map((msg) => (
          <div key={msg.id} className={msg.isUser ? 'user' : 'tutor'}>
            <strong>{msg.name}:</strong> {msg.text}
          </div>
        ))}
      </div>

      <button
        onClick={toggleMic}
        className={isMicActive ? 'recording' : ''}
      >
        {isMicActive ? 'Listening...' : 'Press to Speak'}
      </button>

      <p className="hint">
        {status === 'speaking' ? 'Tutor is speaking...' : 'Your turn!'}
      </p>
    </div>
  );
}
```

## Next.js Integration

```tsx
// app/chat/page.tsx
'use client';

import { VoiceChat } from '@agent-voice-chat/react';

export default function ChatPage() {
  return (
    <main>
      <VoiceChat
        server={process.env.NEXT_PUBLIC_VOICE_SERVER!}
        agent="bob"
      />
    </main>
  );
}
```

Add to your `.env.local`:
```
NEXT_PUBLIC_VOICE_SERVER=https://your-server.com
```

> The `VoiceChat` component uses browser APIs (mic, audio), so it must be a client component (`'use client'`).
