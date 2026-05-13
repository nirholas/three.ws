# Embedding the Widget

Add AI voice chat to any website with a single `<script>` tag. No build tools or frameworks required.

## Basic Usage

```html
<script
  src="https://unpkg.com/agent-voice-chat/widget.js"
  data-server="https://your-server.com"
  data-agent="bob"
></script>
```

This renders a floating button in the bottom-right corner. When clicked, it opens a voice chat modal connected to your agent.

## Configuration via Data Attributes

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `data-server` | Yes | — | URL of your agent-voice-chat server |
| `data-agent` | No | First agent | Agent ID to connect to |
| `data-room` | No | `"default"` | Room ID for multi-tenancy |
| `data-position` | No | `"bottom-right"` | Button position: `bottom-right`, `bottom-left` |
| `data-theme` | No | `"dark"` | Color theme: `"dark"` or `"light"` |
| `data-open` | No | `false` | Start with the chat panel open |

### Example: Custom Position and Theme

```html
<script
  src="https://unpkg.com/agent-voice-chat/widget.js"
  data-server="https://your-server.com"
  data-agent="alice"
  data-position="bottom-left"
  data-theme="light"
></script>
```

## JavaScript API

For more control, initialize the widget programmatically:

```html
<script src="https://unpkg.com/agent-voice-chat/widget.js"></script>
<script>
  const widget = AgentVoiceChat.init({
    server: 'https://your-server.com',
    agent: 'bob',
    room: 'support-room-123',
    position: 'bottom-right',
    theme: 'dark',
    onMessage: (message) => {
      console.log('Agent said:', message.text);
    },
    onStatusChange: (status) => {
      console.log('Status:', status); // 'idle' | 'listening' | 'speaking'
    }
  });

  // Programmatic control
  widget.open();
  widget.close();
  widget.toggle();
  widget.destroy();
</script>
```

## Embedding in Specific Containers

By default, the widget floats over your page. To embed it inline:

```html
<div id="voice-chat-container" style="width: 400px; height: 600px;"></div>

<script src="https://unpkg.com/agent-voice-chat/widget.js"></script>
<script>
  AgentVoiceChat.init({
    server: 'https://your-server.com',
    agent: 'bob',
    container: '#voice-chat-container',
    mode: 'inline' // Fills the container instead of floating
  });
</script>
```

## Self-Hosted Widget

If you're running the server locally, the widget is served from the same origin:

```html
<script
  src="http://localhost:3000/widget.js"
  data-server="http://localhost:3000"
  data-agent="bob"
></script>
```

## Platform-Specific Examples

### WordPress

Add this to your theme's `footer.php` or use a "Custom HTML" block:

```html
<script
  src="https://unpkg.com/agent-voice-chat/widget.js"
  data-server="https://your-server.com"
  data-agent="bob"
></script>
```

### Shopify

Add to your theme's `theme.liquid` file, just before the closing `</body>` tag:

```html
<script
  src="https://unpkg.com/agent-voice-chat/widget.js"
  data-server="https://your-server.com"
  data-agent="bob"
></script>
```

### Next.js (Static HTML)

If you want the widget without using the React component:

```tsx
// app/layout.tsx
import Script from 'next/script';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Script
          src="https://unpkg.com/agent-voice-chat/widget.js"
          data-server="https://your-server.com"
          data-agent="bob"
          strategy="lazyOnload"
        />
      </body>
    </html>
  );
}
```

### Static HTML Site

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Site</title>
</head>
<body>
  <h1>Welcome to my site</h1>
  <p>Click the chat button in the corner to talk to our AI assistant.</p>

  <script
    src="https://unpkg.com/agent-voice-chat/widget.js"
    data-server="https://your-server.com"
    data-agent="bob"
  ></script>
</body>
</html>
```

## Styling

The widget uses Shadow DOM to avoid CSS conflicts with your site. To customize its appearance, use CSS custom properties:

```html
<style>
  agent-voice-chat {
    --avc-primary: #818cf8;
    --avc-bg: #1a1a2e;
    --avc-text: #ffffff;
    --avc-button-size: 56px;
    --avc-border-radius: 16px;
  }
</style>
```

## Security Notes

- The widget connects to your server via WebSocket (Socket.IO). Ensure your server has proper CORS configuration if hosting the widget on a different domain.
- Audio data is sent to your server (or directly to OpenAI via WebRTC). No audio is stored unless you configure it.
- The widget requests microphone permission from the browser. Users must explicitly grant access.


