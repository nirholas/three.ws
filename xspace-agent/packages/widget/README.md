# @xspace/widget

Embeddable chat widget for xspace-agent. Connects to your agent via Socket.IO and provides voice + text interaction.

## Installation

```bash
npm install @xspace/widget
```

## Quick Start (ESM)

```ts
import { XSpaceWidget } from '@xspace/widget'

const widget = new XSpaceWidget({
  serverUrl: 'http://localhost:3000',
  agentId: 'agent-1',
})

widget.mount(document.body)
```

## Quick Start (Script Tag)

```html
<script src="https://unpkg.com/@xspace/widget/dist/xspace-widget.umd.js"
        data-server-url="http://localhost:3000"
        data-agent-id="agent-1">
</script>
```

The widget auto-initializes from `data-*` attributes. For manual control:

```html
<script src="https://unpkg.com/@xspace/widget/dist/xspace-widget.umd.js"></script>
<script>
  const widget = window.XSpace.createWidget({
    serverUrl: 'http://localhost:3000',
    agentId: 'agent-1',
    theme: 'dark',
  })
</script>
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverUrl` | `string` | **required** | URL of the xspace-agent server |
| `agentId` | `string` | — | Agent to connect to |
| `roomId` | `string` | `'default'` | Chat room ID |
| `apiKey` | `string` | — | API key for authentication |
| `userName` | `string` | `'User'` | Display name for user messages |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'light'` | Color theme |
| `customTheme` | `Partial<Theme>` | — | Override specific theme colors |
| `position` | `Position` | `'bottom-right'` | Widget position on screen |
| `greeting` | `string` | `'Hello! How can I help you?'` | Welcome message |
| `placeholder` | `string` | `'Type a message...'` | Input placeholder text |
| `title` | `string` | `'Chat'` | Header title |
| `enableVoice` | `boolean` | `true` | Enable voice input button |
| `enableText` | `boolean` | `true` | Enable text input |
| `persistMessages` | `boolean` | `true` | Save messages to localStorage |
| `onMessage` | `(msg) => void` | — | Callback when message received |
| `onConnect` | `() => void` | — | Callback on connection |
| `onDisconnect` | `() => void` | — | Callback on disconnect |

### Position Values

`'bottom-right'` | `'bottom-left'` | `'top-right'` | `'top-left'`

## Methods

| Method | Description |
|--------|-------------|
| `mount(container?)` | Mount widget to DOM (defaults to `document.body`) |
| `unmount()` | Remove widget from DOM and disconnect |
| `open()` | Open the chat panel |
| `close()` | Close the chat panel |
| `toggle()` | Toggle open/close |
| `sendMessage(text)` | Programmatically send a message |
| `clearHistory()` | Clear persisted message history |
| `isConnected()` | Check connection status |
| `destroy()` | Full cleanup (unmount + release resources) |

## Theming

### Built-in Themes

```ts
// Light theme (default)
new XSpaceWidget({ serverUrl: '...', theme: 'light' })

// Dark theme
new XSpaceWidget({ serverUrl: '...', theme: 'dark' })

// Auto (follows system preference, updates dynamically)
new XSpaceWidget({ serverUrl: '...', theme: 'auto' })
```

### Custom Theme

```ts
new XSpaceWidget({
  serverUrl: '...',
  theme: 'light',
  customTheme: {
    primaryColor: '#6366f1',
    primaryHoverColor: '#4f46e5',
    borderRadius: '8px',
  },
})
```

### CSS Variables

The widget uses these CSS variables (scoped to shadow DOM):

| Variable | Description |
|----------|-------------|
| `--xw-primary` | Primary/accent color |
| `--xw-primary-hover` | Primary hover state |
| `--xw-bg` | Background color |
| `--xw-surface` | Surface/card color |
| `--xw-text` | Primary text color |
| `--xw-text-secondary` | Secondary text color |
| `--xw-user-bubble` | User message bubble background |
| `--xw-agent-bubble` | Agent message bubble background |
| `--xw-border` | Border color |
| `--xw-input-bg` | Input field background |
| `--xw-radius` | Panel border radius |
| `--xw-bubble-radius` | Message bubble border radius |

## Voice

Voice input requires browser support for `MediaRecorder` and `getUserMedia`.

```ts
import { VoiceInput } from '@xspace/widget'

if (VoiceInput.isSupported()) {
  console.log('Voice input available')
}
```

The widget automatically shows a microphone button when voice is supported and `enableVoice: true`.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Escape` | Close widget |

## Accessibility

- Full ARIA labels and roles
- Screen reader announcements for new messages (`aria-live`)
- Focus management on open/close
- Keyboard navigation support
- `prefers-reduced-motion` respected (disables animations)

## Events

```ts
const widget = new XSpaceWidget({
  serverUrl: 'http://localhost:3000',
  onMessage: (msg) => {
    console.log(`${msg.name}: ${msg.text}`)
  },
  onConnect: () => {
    console.log('Connected to server')
  },
  onDisconnect: () => {
    console.log('Disconnected from server')
  },
})
```

## License

MIT


