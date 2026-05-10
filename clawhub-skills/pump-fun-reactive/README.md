# pump-fun-reactive

Monitor the live [pump.fun](https://pump.fun) token feed and drive `<agent-3d>` avatar gestures, emotes, and speech from real market activity — no LLM in the loop, no wallet required.

## Overview

`pump-fun-reactive` connects to the [PumpPortal](https://pumpportal.fun) WebSocket API (`wss://pumpportal.fun/api/data`) and subscribes to two real-time event streams:

- **New token launches** (`subscribeNewToken`)
- **Token migrations to AMM** (`subscribeMigration`)

Events are aggregated in 2-second windows and translated into avatar protocol actions — gestures, emotes, and speech — that the `<agent-3d>` web component consumes directly.

**This skill is read-only.** It makes no on-chain transactions and requires no wallet or signing.

| Property      | Value                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------- |
| name          | pump-fun-reactive                                                                            |
| description   | Live pump.fun market events → agent-3d avatar reactions, read-only WebSocket feed            |
| allowed-tools | Read, Edit, Write, Bash(node:*)                                                              |
| runtime       | Browser (native WebSocket) or Node.js (with `ws` polyfill)                                   |

## Install

```
openclaw skills install pump-fun-reactive
```

Or via direct URL:

```
Install the skill https://raw.githubusercontent.com/nirholas/3D-Agent/main/clawhub-skills/pump-fun-reactive/SKILL.md
```

## Quick start

```js
import { AgentProtocol } from '@three-ws/agent-sdk';
import { registry } from '@three-ws/skill-registry';

const protocol = new AgentProtocol();

await registry.install({ uri: 'pump-fun-reactive' });
const skill = registry.findSkillForTool('enable_live_reactions');

// Start listening — avatar reacts to every token event in real time
await skill.invoke('enable_live_reactions', {}, { protocol });

// Later: stop cleanly
await skill.invoke('disable_live_reactions', {}, {});
```

## Event logic

The skill batches all WebSocket events in a 2-second window and emits exactly one priority-ordered action set per window:

| Priority | Condition                           | Avatar actions                                                 |
| -------- | ----------------------------------- | -------------------------------------------------------------- |
| 1        | Any migration event                 | `gesture: celebrate` · `emote: celebration` · `speak: "<name> graduated!"` |
| 2        | Biggest opener > 5 SOL              | `emote: curiosity` · `speak: "<name> just opened with X.XX SOL."` |
| 3        | 0 creates in window                 | `emote: patience`                                              |
| 4        | 1–2 creates                         | `emote: curiosity` · `look-at: user`                           |
| 5        | 3–9 creates                         | `gesture: wave` · `emote: curiosity`                           |
| 6        | 10+ creates                         | `gesture: wave` · `emote: celebration` · `speak: "Pump.fun is on fire — N launches in 2 seconds."` |

## Avatar event types

All events are emitted onto the shared `AgentProtocol` bus using the standard action schema:

```json
{ "type": "gesture",  "payload": { "name": "celebrate", "duration": 1.5 } }
{ "type": "emote",    "payload": { "trigger": "celebration", "weight": 0.95 } }
{ "type": "speak",    "payload": { "text": "...", "sentiment": 0.9 } }
{ "type": "look-at",  "payload": { "target": "user" } }
```

The `<agent-3d>` web component subscribes to this bus automatically — no extra wiring needed.

## Node.js setup

The skill uses the browser-native `WebSocket` API. In Node.js, polyfill it at the entry point of your project:

```bash
npm install ws
```

```js
import { WebSocket } from 'ws';
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}
```

## Reconnection

If the WebSocket drops, the skill reconnects automatically using exponential backoff (up to 10 attempts, capped at 30 seconds between retries). Call `disable_live_reactions` to stop cleanly and prevent reconnection.

## Tools reference

### `enable_live_reactions(args, ctx)`

| Parameter    | Required | Description                                              |
| ------------ | -------- | -------------------------------------------------------- |
| `ctx.protocol` | yes    | An `AgentProtocol` instance or any object with `.emit(action)` |

Returns `{ ok: true, started: true }` on first call, `{ ok: true, already: true }` if already running.

### `disable_live_reactions(args, ctx)`

No parameters required.

Returns `{ ok: true, stopped: true }`.

## Common patterns

### React to high-activity windows only

```js
// Only enable during peak hours — disable overnight
const now = new Date();
const hour = now.getUTCHours();

if (hour >= 13 && hour <= 21) {
  await skill.invoke('enable_live_reactions', {}, { protocol });
} else {
  await skill.invoke('disable_live_reactions', {}, {});
}
```

### Pair with agent-3d

```html
<script type="module" src="https://cdn.three.ws/agent-3d.js"></script>
<agent-3d src="agent://base/42"></agent-3d>

<script type="module">
  import { protocol } from 'https://cdn.three.ws/protocol.js';
  import { registry }  from 'https://cdn.three.ws/registry.js';

  await registry.install({ uri: 'pump-fun-reactive' });
  const skill = registry.findSkillForTool('enable_live_reactions');
  await skill.invoke('enable_live_reactions', {}, { protocol });
</script>
```

## Security

- **No credentials required.** The PumpPortal WebSocket is public and unauthenticated.
- **No transactions.** The skill never builds, signs, or sends any on-chain transaction.
- **No wallet access.** The skill has no dependency on any wallet adapter or signing library.
- The skill runs in a sandboxed Web Worker by default (`trust: any`). It can only call `ctx.*` methods — it cannot access `window`, `document`, or `localStorage`.

## Source

Implementation: [`pump-fun-skills/reactive/handlers.js`](https://github.com/nirholas/3D-Agent/blob/main/pump-fun-skills/reactive/handlers.js)

Full skill spec: [`pump-fun-skills/reactive/SKILL.md`](https://github.com/nirholas/3D-Agent/blob/main/pump-fun-skills/reactive/SKILL.md)
