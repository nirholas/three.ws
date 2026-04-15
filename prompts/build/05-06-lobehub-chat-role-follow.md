# 05-06 — Lobehub: agent follows chat roles (listen + respond posture)

**Pillar 5 — Host embed.**

## Why it matters

In a Lobehub chat, there are two speakers: user and assistant. A present agent should *look like* it's listening when the user types, and *speak* (animate) when the assistant replies. This is the sub-second cue that sells "present" over "rendered."

## What to build

Tap into Lobehub's chat lifecycle events (which the fork already emits) and translate them to agent bus events:

| Lobehub event | Agent effect |
|:---|:---|
| User starts typing | `emote:patience + look-at:user` |
| User sends message | `emote:curiosity` brief pulse |
| Assistant begins streaming | `gesture:speak-start` (subtle mouth pre-shape) |
| Assistant token arrives | continuous `emote:sentiment` from `05-05` scoring of the partial |
| Assistant finishes | `gesture:speak-end` (return to neutral gaze) |
| Error / rate limit | `emote:concern + look-at:user` |

## Read these first

| File | Why |
|:---|:---|
| `api/agents/[id]/lobe-ui.js` (from 05-03) | The iframe that runs inside Lobehub. |
| `src/lib/embed-bridge.js` (from 05-04) | Bridge API. |
| `src/lib/sentiment-heuristic.js` (from 05-05) | Score function. |
| User's Lobehub fork — `/chat` UI or plugin runtime | What `postMessage` events Lobehub actually emits into plugin UIs. **Grep the fork first**; do not assume an API. If the fork doesn't emit these, add the minimum bridge hook in the fork (separate PR against the fork) and document it here. |

## Build this

### 1. Audit Lobehub's plugin-UI message vocabulary

In the user's fork, grep for `postMessage` calls originating in the chat runtime targeted at plugin iframes. Document the shapes found. Common candidates:

- `{ type: 'lobe:userTyping', payload: { active: true } }`
- `{ type: 'lobe:userMessage', payload: { content, role: 'user' } }`
- `{ type: 'lobe:assistantDelta', payload: { content, role: 'assistant' } }`
- `{ type: 'lobe:assistantEnd', payload: { content, role: 'assistant' } }`
- `{ type: 'lobe:error', payload: { message } }`

If they don't exist, add them to the fork (a minimal patch — 10–30 lines in the chat component) and record the diff.

### 2. Lobehub listener

In `api/agents/[id]/lobe-ui.js`, add a message handler that translates Lobehub events to `bridge.post(...)` calls as per the table above.

### 3. Streaming scoring

While the assistant streams, call `score(partial)` on each delta. Throttle the resulting emote updates to 2 Hz so the agent blends smoothly (the Empathy Layer decay already smooths fast-arriving weights).

### 4. Resting gaze

When idle (no chat activity for 5s), gently look back to the camera and settle to neutral. This is a single call: `bridge.lookAt('camera'); bridge.post('emote', { trigger: 'neutral', weight: 0.2 })` in an idle timer.

## Out of scope

- Do not add TTS inside the iframe (it's a listening/responding visual cue; the host does the talking).
- Do not log per-token sentiments to our backend.
- Do not build a Lobehub-specific chat transcript view.
- Do not block on the upstream Lobehub project — target only the user's fork.

## Deliverables

**New:**
- If the fork needs a patch: `lobehub-patch.md` in this repo documenting the diff to apply in the Lobehub fork (separate checkout).

**Modified:**
- `api/agents/[id]/lobe-ui.js` — full listener + role follow behavior.

## Acceptance

- [ ] User starts typing in Lobehub chat → agent shifts to patience+user-gaze within 200 ms.
- [ ] Assistant begins streaming → avatar begins speak-pose.
- [ ] Positive assistant text → celebration blend grows.
- [ ] Stream ends → back to resting gaze within 1 s of end.
- [ ] 5 s idle → neutral + camera gaze.
- [ ] Error → concern + user gaze.
- [ ] `npm run build` passes.

## Test plan

1. Start Lobehub fork locally. Enable the 3D agent plugin for a chat.
2. Type slowly in the box → agent gaze follows, patience blend visible.
3. Send → user pulse brief.
4. Assistant streams a cheerful reply → celebration grows over tokens.
5. Stream ends → avatar settles.
6. Wait 5s doing nothing → agent returns to camera gaze, neutral.
