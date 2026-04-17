# @3dagent/lobehub-plugin

A LobeHub plugin that renders a 3D agent avatar in the chat sidebar, reacting to assistant messages via the agent bridge protocol.

## Features

- **Embedded 3D Avatar** — Renders a glTF-based agent in a fixed 320×420 pane
- **Message Reaction** — Avatar speaks when the LLM generates responses
- **Zero Dependencies** — No external 3D libraries; uses the 3D Agent embed endpoint
- **Configurable** — Plugin settings for agent ID and API origin

## Installation

1. Clone this directory into your LobeHub fork at `plugins/@3dagent/lobehub-plugin/`
2. Install dependencies:
   ```bash
   cd lobehub-plugin
   npm install
   ```
3. Build:
   ```bash
   npm run build
   ```
4. Reference the plugin manifest in your LobeHub fork's plugin registry.

## Usage

In LobeHub's plugin settings, configure:

- **Agent ID** (required): The UUID or identifier of the agent you want to embed (e.g., `agent-xyz-123`)
- **API Origin** (optional): The base URL of your 3D Agent server (defaults to `https://3dagent.vercel.app`)

The plugin will render an iframe pointing to `${apiOrigin}/agent/${agentId}/embed` and listen for chat messages.

## Configuration

Plugin settings are defined in [`src/config-schema.ts`](src/config-schema.ts) and exposed via the [`manifest.json`](manifest.json) schema section.

## Bridge Protocol

The plugin uses the **v1 bridge protocol** (FROZEN) from `public/agent/embed.html`:

### Host → Iframe

```json
{
  "type": "agent:hello",
  "agentId": "agent-id",
  "host": "optional-origin"
}
```

```json
{
  "type": "agent:action",
  "agentId": "agent-id",
  "action": {
    "type": "speak",
    "payload": { "text": "Hello, world!" }
  }
}
```

### Iframe → Host

```json
{
  "type": "agent:ready",
  "agentId": "agent-id",
  "version": "1",
  "capabilities": ["speak", "gesture", "look-at", "emote", "present-model"],
  "name": "Agent Name"
}
```

```json
{
  "type": "agent:resize",
  "agentId": "agent-id",
  "height": 500
}
```

## Lobe Hook Integration

### Current Status

The plugin currently **mocks** the Lobe hook API with a custom event emitter. To integrate with a real LobeHub fork, you must:

1. **Find the actual SDK**: Check `@lobehub/ui@latest` or `lobehub-plugin-sdk` for the real `usePluginStore` and `onAssistantMessage` hooks.
2. **Update `src/AgentPane.tsx`**: Replace the `lobe:assistantMessage` custom event listener with the real hook:

```typescript
// Example (adjust based on actual SDK):
import { usePluginStore } from '@lobehub/ui';

export const AgentPane: React.FC<AgentPaneProps> = ({ settings }) => {
  // ... existing code ...

  const { onAssistantMessage } = usePluginStore();

  useEffect(() => {
    if (onAssistantMessage) {
      const unsubscribe = onAssistantMessage((msg) => {
        if (msg.content && bridgeRef.current) {
          bridgeRef.current.speak(msg.content);
        }
      });
      return unsubscribe;
    }
  }, [onAssistantMessage]);

  // ... rest of component ...
};
```

### Placeholder Implementation

If the Lobe SDK is not available, you can emit a custom event from your LobeHub fork:

```javascript
// In your chat message handler:
window.dispatchEvent(new CustomEvent('lobe:assistantMessage', {
  detail: { content: 'Assistant message text' }
}));
```

## Development

```bash
npm install
npm run dev         # Watch build (tsc + esbuild)
npm run type-check  # Check TypeScript without emitting
npm run build       # Production bundle
```

The build outputs to `dist/bundle.js` (ESM module).

## Structure

```
src/
├── index.ts          # Entry point (exports AgentPane, AgentBridge, settingsSchema)
├── AgentPane.tsx     # Main React component with iframe and hooks
├── bridge.ts         # PostMessage bridge (v1 protocol implementation)
├── config-schema.ts  # Settings schema and defaults
manifest.json         # LobeHub plugin manifest
```

## License

MIT
