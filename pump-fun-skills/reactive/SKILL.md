---
name: pump-fun-reactive
version: 0.1.0
author: nirholas
description: Drives live avatar movement from the real pump.fun PumpPortal feed.
trust: any
---

# pump-fun-reactive

Connects to the real PumpPortal WebSocket feed and drives `<agent-3d>` avatar reactions
from live pump.fun events — no LLM in the loop.

## Tools

### `enable_live_reactions`

Opens a WebSocket to `wss://pumpportal.fun/api/data`, subscribes to new token launches
and migrations, and starts emitting avatar events every 2 seconds based on market activity.

- Returns `{ ok: true, started: true }` on first call.
- Returns `{ ok: true, already: true }` if already running.
- Reconnects automatically on disconnect (exponential backoff, up to 10 attempts).

**Requires** `ctx.protocol` — an `AgentProtocol` instance (or any object with an `emit(action)` method).

### `disable_live_reactions`

Closes the WebSocket and stops the aggregator. Returns `{ ok: true, stopped: true }`.

## Event logic (2-second aggregator window)

Priority order within each window:

1. **Any migration (`txType: 'migrate'`)** → `gesture: celebrate` + `emote: celebration` + `speak: "<name> graduated!"`
2. **Big initial buy** (highest-`solAmount` create event has `solAmount > 5 SOL`) → `emote: curiosity` + `speak: "<name> just opened with a X.XX SOL buy."`
3. **Count of `txType: 'create'` events:**
    - 0 → `emote: patience`
    - 1–2 → `emote: curiosity` + `look-at: user`
    - 3–9 → `gesture: wave` + `emote: curiosity`
    - 10+ → `gesture: wave` + `emote: celebration` + `speak: "Pump.fun is on fire — N new launches in 2 seconds."`

## Usage

```js
// Install the skill and call enable
await registry.install({ uri: './pump-fun-skills/reactive/' });
const skill = registry.findSkillForTool('enable_live_reactions');
await skill.invoke('enable_live_reactions', {}, { protocol });

// Stop later
await skill.invoke('disable_live_reactions', {}, {});
```
