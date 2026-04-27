# @3dagent/lobehub-plugin

Render an embodied 3D avatar in the LobeChat sidebar. The avatar reacts to the LLM's tool calls — speaking, gesturing, and emoting — in real time.

> **Icon/screenshot note:** `assets/icon-256.svg` is a placeholder. Replace with a designed 256×256 PNG before submitting to the LobeHub plugin registry.

---

## One-click install (LobeChat ≥ 1.x)

1. In LobeChat, open **Plugins → Plugin Store → Custom plugins**.
2. Paste the manifest URL:
    ```
    https://three.ws/.well-known/lobehub-plugin.json
    ```
3. Click **Install**. LobeChat will show the plugin settings dialog.
4. Enter your **Agent ID** (UUID from the three.ws dashboard at `https://three.ws/dashboard`).
5. Click **Save**. The 3D avatar appears in the right sidebar.

---

## Configuration

| Setting     | Type     | Required | Default                      | Description                            |
| ----------- | -------- | -------- | ---------------------------- | -------------------------------------- |
| `agentId`   | `string` | Yes      | —                            | Agent UUID from the three.ws dashboard |
| `apiOrigin` | `string` | No       | `https://three.ws/` | Override for self-hosted instances     |

---

## How it works

```
LobeChat host
  │  postMessage({ type: 'LobePlugin.renderPlugin', payload: { apiName, arguments } })
  ▼
AgentPane (React sidebar component)
  │  v1 bridge request: { v:1, source:'agent-host', kind:'request', op:'speak', payload }
  ▼
/lobehub/iframe/ (boot.js)
  │  el.say(text, { sentiment })
  ▼
<agent-3d> web component — avatar speaks
```

When the LLM calls one of the plugin's tools (`speak`, `gesture`, `emote`, `render_agent`), LobeChat sends the tool args as a postMessage to the plugin iframe. `AgentPane` receives it, translates it into a bridge request, and the iframe's `boot.js` dispatches it to the `<agent-3d>` element.

### LobeChat message format

LobeChat (and `@lobehub/chat-plugin-sdk` internally) sends:

```json
{
	"type": "LobePlugin.renderPlugin",
	"payload": {
		"apiName": "speak",
		"arguments": "{\"text\":\"Hello!\",\"sentiment\":0.5}",
		"identifier": "3d-agent"
	}
}
```

`AgentPane` listens for this on `window.addEventListener('message', ...)`. When `@lobehub/chat-plugin-sdk` ships a stable `usePluginStore` / `useWatchPluginMessage` hook that is directly callable for sidebar plugins, replace the listener with that hook so the React render cycle drives the effect.

### Wire protocol (v1)

Bridge envelope:

```json
{
	"v": 1,
	"source": "agent-host",
	"id": "<uuid>",
	"inReplyTo": "<request-id>",
	"kind": "request | response | event",
	"op": "speak | gesture | emote | look | setAgent | ping | subscribe",
	"payload": {}
}
```

Full spec: [`01-embed-bridges.md`](../prompts/final-integration/01-embed-bridges.md).

---

## Available tool ops

| Op             | Payload                             | Description                           |
| -------------- | ----------------------------------- | ------------------------------------- |
| `render_agent` | `{ agentId }`                       | Swap the agent in the sidebar         |
| `speak`        | `{ text, sentiment? [-1,1] }`       | Avatar speaks with emotional valence  |
| `gesture`      | `{ name: wave\|nod\|point\|shrug }` | Trigger a named gesture               |
| `emote`        | `{ trigger, weight? [0,1] }`        | Inject emotion into the Empathy Layer |

---

## Dev harness

To test the plugin without running LobeChat:

```bash
# From repo root:
npm run build:lib   # produces dist-lib/agent-3d.js (the <agent-3d> web component)
npm --prefix lobehub-plugin install
npm --prefix lobehub-plugin run build

# Serve the repo root:
python3 -m http.server 8080

# Open in browser:
open http://localhost:8080/lobehub-plugin/dev/?agent=<your-agent-id>
```

The harness shows the agent iframe on the left and a control panel on the right. Click **Inject speak** to fire a fake assistant message and verify the avatar reacts.

---

## Build

```bash
cd lobehub-plugin
npm install
npm run build        # → dist/bundle.js
npm run type-check   # TypeScript strict check
```

Output: `dist/bundle.js` — tree-shaken, browser-targeted. React and react-dom are external (provided by LobeChat at runtime).

---

## Troubleshooting

| Symptom                | Likely cause                         | Fix                                                                              |
| ---------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| Avatar never appears   | Wrong `agentId`                      | Copy UUID from dashboard; ensure agent has an avatar                             |
| "Loading agent…" stuck | Bridge handshake failed              | Check browser console for `[3d-agent]` messages; verify `apiOrigin` is reachable |
| `speak` does nothing   | LobeChat hasn't installed the plugin | Confirm plugin is active in LobeChat Plugin Store                                |
| CORS error             | Self-hosted origin not allowed       | Add origin to `CORS_ORIGINS` in your three.ws deployment                         |
| Timeout errors         | Network latency                      | The bridge has a 10 s timeout; the iframe may still be loading the web component |

---

## Source note

`src/config-schema.ts` uses `placeholder` as a property name — these are form input hint strings shown in LobeChat's settings UI (standard HTML `<input placeholder="...">` semantics), not implementation stubs.

---

## License

MIT — see [LICENSE](LICENSE).
