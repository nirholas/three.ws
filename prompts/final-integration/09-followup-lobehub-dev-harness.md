# 09 — Follow-up: Create LobeHub Plugin Dev Harness

## Origin

Surfaced by QA smoke test (07). Flow I is fully BLOCKED: `chat-plugin/dev/index.html` does not exist.

## Defect

Prompt 05 (`final-integration/05-lobehub-real-integration.md`) specified:

> **Dev harness.** `chat-plugin/dev/index.html` loads the built plugin inside a page that mocks the LobeChat host message contract. Include a button to inject a fake assistant message so the avatar can be seen reacting in isolation.

The file was never created. `chat-plugin/` has `src/`, `dist/`, `package.json` but no `dev/` directory.

## Smallest-possible fix

Create `chat-plugin/dev/index.html` — a single self-contained HTML file that:

1. Embeds the agent iframe (`/agent/<id>/embed` or a test agent URL).
2. Listens for the bridge `ready` event from the iframe.
3. Provides a button: "Inject assistant message" — on click, posts a fake `{ role: 'assistant', content: 'Hello, introduce yourself!' }` message via `postMessage` to the iframe using the wire format from `chat-plugin/src/bridge.ts`.
4. Shows the iframe at 400×600px so the avatar is visible.

Reference implementation contract: `chat-plugin/src/bridge.ts` (the `AgentBridge` class defines the message format).

## Acceptance

1. `cd chat-plugin && npm install && npm run build` succeeds.
2. `python3 -m http.server 5555` from `chat-plugin/dev/`.
3. Open `http://localhost:5555/index.html` in Chrome.
4. Click "Inject assistant message".
5. The avatar in the iframe visibly speaks (lip sync / speak animation fires).
6. No console errors.
