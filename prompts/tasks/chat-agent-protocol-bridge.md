# Task: Bridge the standalone chat app to the agent runtime protocol bus

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

**Two separate apps exist:**

1. **`chat/`** — A full-featured standalone Svelte 4 chat UI. Multi-provider LLM chat (Anthropic, OpenAI, Ollama, etc.), tool calling, image generation. Independent of the 3D agent system. Entry: `chat/src/App.svelte`.

2. **`src/` (the main app)** — The 3D agent runtime. Has `agent-protocol.js` (event bus), `agent-avatar.js` (emotions + morph targets), `runtime/index.js` (LLM brain), and the `<agent-3d>` web component.

**The chat app already has a TalkingHead component** (`chat/src/TalkingHead.svelte`) — a 3D avatar that speaks using the TalkingHead library. But it's wired to the chat's own LLM responses, not to the `agent-protocol.js` event bus from `src/`.

**The problem:** When a user is on a three.ws agent page and using the embedded chat panel (`AgentPanel` from the SDK or `agent-home.js` in the runtime), the chat messages don't flow through the agent protocol bus. So the 3D avatar doesn't react to what's being said — no emotional response, no lipsync trigger, no gesture.

**The goal:** When a message is sent or received in the embedded chat panel, emit the corresponding events on the agent protocol bus so the avatar reacts in real time.

---

## Scope

This task is specifically about the **embedded chat panel** in `src/agent-home.js` (the UI that appears inside the `<agent-3d>` element), NOT about the standalone `chat/` app.

The standalone `chat/` app is a separate product — don't wire it to the protocol bus. That would be a much larger integration.

---

## What the embedded chat already does

Check `src/agent-home.js` (or `src/components/` if the chat UI is there) to understand:
- How user messages are displayed
- How agent responses are displayed
- Whether it calls `protocol.emit('speak', ...)` when the agent responds

The LLM runtime in `src/runtime/index.js` already emits `speak` events on the protocol bus when the agent generates a response. But the chat panel may display responses without waiting for the protocol event, or it may be bypassed in certain flows.

---

## What to audit and fix

### 1. User message → avatar reaction

When the user sends a message in the embedded chat, the avatar should look at the user (emit `look-at { target: 'user' }`) and show curiosity (emit `emote { trigger: 'curiosity', weight: 0.6 }`):

```js
// In the message-send handler of agent-home.js
protocol.emit('look-at', { target: 'user' });
protocol.emit('emote', { trigger: 'curiosity', weight: 0.6 });
```

### 2. Agent response → speak event

When the LLM returns a response, `runtime/index.js` should already emit `speak { text, sentiment }`. Verify this is happening. If it's not, add it.

### 3. Thinking indicator → patience emotion

When the LLM is processing (streaming hasn't started yet), emit:
```js
protocol.emit('think', { thought: 'processing your message...' });
protocol.emit('emote', { trigger: 'patience', weight: 0.5 });
```

### 4. Error → concern emotion

If the LLM call fails:
```js
protocol.emit('emote', { trigger: 'concern', weight: 0.8 });
```

### 5. Chat scroll / typing indicator visibility

These are UI concerns only — no protocol events needed.

---

## Files to audit and edit

1. Read `src/agent-home.js` (or wherever the embedded chat panel lives) in full.
2. Read `src/runtime/index.js` to see what protocol events it emits during the LLM loop.
3. Read `src/agent-protocol.js` to understand the event vocabulary.

Then add the missing `protocol.emit()` calls in the appropriate places.

**Do not touch:**
- `chat/src/App.svelte` or any file in `chat/` — the standalone chat is separate
- `src/agent-avatar.js` — it already handles all the emote/speak/look-at events correctly
- The LLM provider logic in `src/runtime/providers.js`

---

## Acceptance criteria

1. Send a message in the embedded chat panel. The avatar immediately turns to face the camera / user (look-at event fires).
2. While the LLM is streaming a response, the avatar shows a patience/thinking expression.
3. When the agent's response appears, the avatar shows emotion appropriate to the sentiment of the reply (celebration for positive, concern for negative).
4. If the LLM errors out, the avatar shows concern.
5. All of this works without breaking the text display in the chat panel.
6. `npx vite build` passes.

## Constraints

- Only emit events that are defined in the protocol vocabulary (see `src/CLAUDE.md` protocol bus table for the full list).
- Don't add direct method calls to `agent-avatar.js` — use the protocol bus only.
- Keep changes surgical — only add `protocol.emit()` calls, don't refactor the chat panel UI.
- If a `protocol` reference isn't available in `agent-home.js`, check how other modules get it (likely via constructor injection or module-level singleton).
