---
mode: agent
description: "Visitors on /agent/:id can chat with the agent — text in, animated voice + text out"
---

# 04-05 · Visitor chat on /agent/:id

## Why it matters

The agent page is currently a museum piece — visitors see the avatar but can't interact. The killer demo of "embodied agent" requires visitors (not just the owner) to talk to the agent and watch it respond with lipsync, gesture, and voice. This is the v1 of interactivity that will travel into every host embed (Claude Artifact, Lobehub) once pillar 5 wires them up.

## Prerequisites

- 01-01 (wallet auth) merged — owners have a session.
- 04-01 (agent page polish) merged — page has structure.
- `NichAgent`, `AgentProtocol`, `AgentAvatar` exist in the repo ([src/nich-agent.js](../../src/nich-agent.js), [src/agent-protocol.js](../../src/agent-protocol.js), [src/agent-avatar.js](../../src/agent-avatar.js)).

## Read these first

- [src/nich-agent.js](../../src/nich-agent.js) — chat UI + speech I/O + skill router.
- [src/agent-avatar.js](../../src/agent-avatar.js) — Empathy Layer driver.
- [src/runtime/index.js](../../src/runtime/index.js) — the LLM brain runtime.
- [api/mcp.js](../../api/mcp.js) — existing MCP server (use as brain).
- [public/agent/index.html](../../public/agent/index.html) — where the chat mounts.

## Build this

### 1. Server — `api/agents/[id]/chat.js`

- `POST`. Streams SSE back. Accepts `{ message: string }`.
- Not session-authed (visitor traffic) but rate-limited by IP (`@upstash/ratelimit`): 8 msgs/min, 50/session.
- Looks up the agent by id. If `deleted_at` or not found → 404.
- Runs the message through the agent's configured brain. For v1, the brain is a single Claude call with a system prompt built from the agent's `description` + `skills`. Use the project's existing Anthropic proxy pattern (do **not** ship an API key to the client).
- Streams back deltas as SSE events of type `chunk` with `{ text }`, ending with `done`.
- Visitor messages cannot override the system prompt. Cap message length at 4000 chars.
- No persistence of visitor messages in v1 (explicit decision — adds privacy surface area).

### 2. Runtime proxy support

If [src/runtime/index.js](../../src/runtime/index.js) doesn't already have a `brain: { provider: 'proxy', url }` mode that POSTs to a URL and consumes SSE, add it. Do not refactor existing provider code; add the new branch only.

### 3. Client — chat UI on /agent/:id

In [public/agent/index.html](../../public/agent/index.html):

- Mount `NichAgent` in a scoped container (not `document.body`). Position it below / beside the avatar card per the responsive layout.
- Wire `NichAgent`'s runtime to the new `/api/agents/:id/chat` endpoint.
- First message from agent is the agent's configured greeting (fallback: "Hi — ask me anything.").
- When a `SPEAK` action fires, the avatar lipsyncs via existing Empathy Layer hooks + speaks with `speechSynthesis` (browser TTS, no new deps).
- Voice input with `SpeechRecognition` where supported. Show a mic button; fall back to text-only when unavailable.
- Rate-limit feedback: when the server returns 429, the chat shows "You're sending messages too quickly. Try again in a moment." — not a raw error.

### 4. Visitor safety

- HTML-strip every message before rendering (both directions). Use `textContent`, not `innerHTML`.
- CSP on the agent page includes `connect-src 'self'` so visitor data can't be exfiltrated by a misbehaving model output injection.
- No visitor message length > 4000 chars (client + server).

### 5. Owner override

- If the viewer is the agent's owner (session user matches `agent.user_id`), show an "Edit system prompt" pencil next to the chat. Clicking opens a small modal that PUTs to `/api/agents/:id`.

## Out of scope

- Persistent chat history across sessions for visitors.
- File / image upload in chat.
- Multi-turn tool use (the brain has a single system + user turn in v1).
- Memory writes from chat — the agent doesn't learn from strangers in v1.
- A "powered by 3D Agent" badge in the chat UI (covered elsewhere).

## Acceptance

1. Open `/agent/:id` in incognito. See the chat. Send "hi" → avatar responds with voice + text + subtle animation.
2. Response text does not execute as HTML (verify with `<img src=x onerror=alert(1)>`).
3. 9th message in one minute returns a rate-limit notice, not a 500.
4. Turn off mic permission → chat still works via text input; no console errors.
5. The agent's own owner sees the "Edit system prompt" pencil; visitors do not.
6. `prefers-reduced-motion: reduce` disables gesture animations, keeps voice/text.
7. No API keys in the network tab or bundle.
8. `npm run build` passes.

## Report

Include a screen capture or GIF showing a visitor chatting with the agent — voice + text + avatar response.
