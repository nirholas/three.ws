---
mode: agent
description: "postMessage bridge between host chat context and embedded agent (emotion + skills)"
---

# Stack Layer 5: Host Chat ↔ Agent Bridge

## Problem

When an agent is embedded in a host chat (Claude Artifacts, LobeHub, any site), it should *react* to the conversation, not just sit there. The host doesn't know about the agent's skill API; the agent doesn't see the chat content. We need a thin standardized bridge.

## Implementation

### Message protocol

Define in [specs/EMBED_SPEC.md](specs/EMBED_SPEC.md). Messages flow both ways via `postMessage`.

**Host → Agent:**
```js
{ type: '3dagent.context', turn: 'user' | 'assistant', text: string, id: string }
{ type: '3dagent.invokeSkill', skillId: string, input?: any, requestId: string }
{ type: '3dagent.setEmotion', blend: { curious?: 0-1, concern?: 0-1, ... }, durationMs?: number }
{ type: '3dagent.reload' }
```

**Agent → Host:**
```js
{ type: '3dagent.ready', avatarId: string }
{ type: '3dagent.skillResult', requestId: string, result: any, error?: string }
{ type: '3dagent.emotionChanged', blend: {...} }
{ type: '3dagent.actionLogged', action: { type, timestamp, payload } }
```

### Client implementation ([src/agent-protocol.js](src/agent-protocol.js))

- Add a `HostBridge` class that listens for allowed origins and translates `postMessage` ↔ agent protocol events.
- Origin allowlist pulled from the avatar's embed allowlist (stack-16 / [prompts/embed/03-embed-allowlist.md](prompts/embed/03-embed-allowlist.md)).
- If origin not allowed, ignore but log.

### Emotion from context

When host sends `3dagent.context` with text, pipe the text through the existing emotion-scoring heuristic in [src/agent-avatar.js](src/agent-avatar.js) Empathy Layer. The avatar then drifts its emotional blend toward the scored vector.

This is the key user-facing moment: **the agent visibly reacts to the chat it's embedded in**.

### Skill invocation

`3dagent.invokeSkill` triggers the skill, plays the matching animation, returns the result via `3dagent.skillResult`. Skills that require network/auth are rejected in artifact mode.

### Ready handshake

On mount, agent posts `3dagent.ready`. Host should wait for this before sending other messages.

### Security

- Never execute string code from the host.
- Skill invocation goes through the existing protocol bus — same safety as any user action.
- Rate-limit host messages: max 10/s per origin.

## Validation

- Test harness page with an iframe + buttons for each host→agent message.
- Send `3dagent.context` with "This is terrible news" → agent's emotion drifts toward concern within 1s.
- Send `3dagent.invokeSkill` with `greet` → agent greets, result returned with correct `requestId`.
- Send from disallowed origin → no response.
- `npm run build` passes.

## Do not do this

- Do NOT accept arbitrary JS from the host.
- Do NOT trust `event.origin === '*'`. Always validate against allowlist.
