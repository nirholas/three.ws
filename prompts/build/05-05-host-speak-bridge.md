# 05-05 — Host speak bridge: chat message → agent sentiment

**Pillar 5 — Host embed.**

## Why it matters

Both Claude Artifact and Lobehub can pipe the assistant's current reply into the agent iframe. What's missing is the *sentiment analysis* step — without it, the agent just mouths words silently. The Empathy Layer needs a valence + arousal signal per utterance.

## What to build

A tiny client-side sentiment scorer that the host bridge runs before calling `speak`. No server round-trip. No ML model. Heuristic + keyword dictionary.

## Read these first

| File | Why |
|:---|:---|
| [src/agent-avatar.js](../../src/agent-avatar.js) | The Empathy Layer's stimulus rules — what the avatar does with sentiment. |
| `src/lib/embed-bridge.js` (from 05-04) | Where this wires in. |
| [src/agent-protocol.js](../../src/agent-protocol.js) | `speak` event payload shape. |

## Build this

### 1. Scorer — `src/lib/sentiment-heuristic.js`

```js
export function score(text) {
  // returns { sentiment: -1..1, arousal: 0..1, tags: string[] }
}
```

Implementation sketch:
- Normalize: lowercase, strip punctuation except `!`, `?`.
- Bag-of-words counts against small positive/negative dictionaries (inline literals — no file I/O).
- Arousal: presence of `!`, ALL CAPS ratio, exclamation density.
- Tags: derive from dictionary hits (e.g. "celebrate", "concern", "curious"). These map to the Empathy Layer triggers.

Keep it <150 lines total. Accuracy doesn't matter — the signal is subtle; the avatar blend absorbs noise.

### 2. Bridge integration

Extend the `speak` method on `createHostBridge` (from 05-04):

```js
function speak(text, overrides = {}) {
  const { sentiment, arousal, tags } = score(text);
  post('speak', { text, sentiment, arousal, tags, ...overrides });
}
```

### 3. Agent-side wiring

Inside the iframe (embed.html / artifact / lobe-ui), when a `speak` message arrives:
- Always nudge emotion: positive `sentiment` → celebration weight; negative → concern; high `arousal` → curiosity.
- If `tags` include a direct emotion name, emit `emote` with that trigger + weight 0.4.
- Still log to timeline regardless.

### 4. Lobehub wiring

In `api/agents/[id]/lobe-ui.js` (from 05-03), the existing `lobe:message` listener calls `bridge.speak(content)` — this now auto-scores and drives emotion.

### 5. Claude Artifact wiring

The artifact (05-01) already accepts inbound `speak`; nothing to change beyond ensuring it reads `sentiment` / `arousal` / `tags` if present. Users driving the artifact from Claude chat can wire `frames[0].postMessage({type:'speak', ...})` themselves; the scoring runs wherever the host calls `bridge.speak()`. Artifacts that want to skip the bridge and send raw messages still work — server-side scoring is not required.

## Out of scope

- Do not add a real ML sentiment model.
- Do not call external sentiment APIs.
- Do not support non-English (mark it as a known limitation in the spec).
- Do not persist sentiment history server-side.

## Deliverables

**New:**
- `src/lib/sentiment-heuristic.js`

**Modified:**
- `src/lib/embed-bridge.js` (05-04) — auto-score on `speak`.
- Agent iframe runtimes (05-01, 05-03, embed.html) — honor `sentiment`/`arousal`/`tags`.

## Acceptance

- [ ] `score("This is amazing!!!")` → sentiment > 0.6, arousal > 0.5.
- [ ] `score("I don't know what's wrong")` → sentiment < -0.2.
- [ ] `score("Let me think about it.")` → sentiment ≈ 0, arousal low.
- [ ] Lobehub chat: positive assistant reply → agent visibly celebrates within 1s.
- [ ] Concerning reply → avatar shifts to concern.
- [ ] `npm run build` passes.

## Test plan

1. Unit-invoke `score()` with 20 sample strings (positive, negative, neutral, all caps, punctuation-heavy). Log the results, spot-check they're directionally right.
2. Open test harness from 05-04 → paste the samples via `speak` button → avatar reacts.
3. In Lobehub: converse → note emotion blend tracks the assistant's tone.
4. In Claude Artifact: from devtools post `{ type:'speak', text:'Great news!' }` → avatar celebrates.
