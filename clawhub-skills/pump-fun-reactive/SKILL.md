---
name: pump-fun-reactive
description: Monitor the PumpPortal WebSocket feed and translate live pump.fun token events into agent-3d avatar reactions — read-only, no wallet required.
allowed-tools: Read, Edit, Write, Bash(node:*)
---

# pump-fun-reactive

Connects to the real PumpPortal WebSocket at `wss://pumpportal.fun/api/data`, subscribes to new token launches and token migrations, and translates market activity into `<agent-3d>` avatar gestures, emotes, and speech via the AgentProtocol event bus.

**Read-only** — no transactions, no wallets, no signing.

## Tools

### `enable_live_reactions`

Opens the WebSocket, subscribes to `subscribeNewToken` and `subscribeMigration`, and starts a 2-second aggregator loop that emits avatar events based on market activity.

- Returns `{ ok: true, started: true }` on the first call.
- Returns `{ ok: true, already: true }` if already running.
- Reconnects automatically on disconnect (exponential backoff, up to 10 attempts).

**Requires** `ctx.protocol` — an `AgentProtocol` instance or any object with an `emit(action)` method.

### `disable_live_reactions`

Closes the WebSocket and stops the aggregator loop.

- Returns `{ ok: true, stopped: true }`.

## Event priority (per 2-second window)

1. **Migration** (`txType: 'migrate'`) → `gesture: celebrate` + `emote: celebration` + `speak: "<name> graduated!"`
2. **Big opener** (top `create` event has `solAmount > 5`) → `emote: curiosity` + `speak: "<name> just opened with X.XX SOL."`
3. **Create count:**
   - 0 events → `emote: patience`
   - 1–2 → `emote: curiosity` + `look-at: user`
   - 3–9 → `gesture: wave` + `emote: curiosity`
   - 10+ → `gesture: wave` + `emote: celebration` + `speak: "Pump.fun is on fire — N new launches in 2 seconds."`

## Usage

Install the skill into your agent runtime:

```js
await registry.install({ uri: 'https://github.com/nirholas/3D-Agent/tree/main/pump-fun-skills/reactive' });
const skill = registry.findSkillForTool('enable_live_reactions');

// Start — pass an AgentProtocol instance in ctx
await skill.invoke('enable_live_reactions', {}, { protocol });

// Stop when done
await skill.invoke('disable_live_reactions', {}, {});
```

## Integration with agent-3d

The events emitted by this skill are consumed directly by the `<agent-3d>` web component when it is backed by an `AgentProtocol` instance. No extra wiring is needed — just ensure the component and the skill share the same protocol bus.

## Setup

```bash
# No install needed — pure browser-native WebSocket.
# For Node.js environments, install a WebSocket polyfill:
npm install ws
```

Then polyfill at entry:

```js
if (typeof WebSocket === 'undefined') {
  global.WebSocket = (await import('ws')).default;
}
```
