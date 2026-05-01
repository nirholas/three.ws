# 04 — `pump-fun-reactive` skill: live avatar reactions to pump.fun firehose

## Why

The end-user feature: an `<agent-3d>` agent that listens to the real pump.fun event stream and **moves** in response — waves on a new launch, celebrates on a graduation, looks curious on big initial buys, gets concerned on no-metadata rugs. Today the existing `pump-fun` skill answers chat queries; this prompt adds a sibling skill that drives the avatar from live data without an LLM in the loop.

Self-contained: this skill includes its own connection logic to the **real** PumpPortal source (directly via `EventSource` to `wss://pumpportal.fun/api/data` is impossible — it's a WebSocket; the skill therefore opens a direct browser `WebSocket` to that URL, which is allowed since PumpPortal's WS does not require auth and accepts cross-origin browser connections). No backend hop is required for this prompt to be complete.

## Real, no-mock requirements

- The skill opens a **real** `WebSocket` to `wss://pumpportal.fun/api/data` and subscribes to `subscribeNewToken` and `subscribeMigration`.
- The skill emits **real** protocol events (`gesture`, `emote`, `speak`, `look-at`) on the actual `<agent-3d>` instance's protocol bus.
- No fixture event replay. No simulated events. If the upstream is silent, the avatar simply does not react.

## Scope

Create a new skill bundle at `pump-fun-skills/reactive/`:

```
pump-fun-skills/reactive/
  SKILL.md          — frontmatter + instructions
  tools.json        — declares an `enable_live_reactions` tool (no args) and `disable_live_reactions`
  handlers.js       — exports the two handlers
```

`SKILL.md` frontmatter (real values):

```yaml
---
name: pump-fun-reactive
version: 0.1.0
author: <repo's existing author handle>
description: Drives live avatar movement from the real pump.fun PumpPortal feed.
trust: any
---
```

`handlers.js` behavior:

1. On `enable_live_reactions`:
   - If already running, return `{ ok: true, already: true }`.
   - Open `new WebSocket('wss://pumpportal.fun/api/data')`.
   - On `open`, send `{"method":"subscribeNewToken"}` and `{"method":"subscribeMigration"}`.
   - **Aggregator window: 2 s.** Buffer raw messages; at the end of each window, pick the strongest signal in priority order:
     1. Any `txType: 'migrate'` → emit `gesture { name: 'celebrate', duration: 1.5 }` + `emote { trigger: 'celebration', weight: 0.95 }` + `speak { text: \`${name} graduated!\`, sentiment: 0.9 }`.
     2. Otherwise, count `txType: 'create'` events in the window:
        - 0 → emit `emote { trigger: 'patience', weight: 0.4 }` (drift, decay handles the rest).
        - 1–2 → `emote { trigger: 'curiosity', weight: 0.6 }` + `look-at { target: 'user' }`.
        - 3–9 → `gesture { name: 'wave', duration: 1.0 }` + `emote { trigger: 'curiosity', weight: 0.85 }`.
        - 10+ → `gesture { name: 'wave', duration: 1.0 }` + `emote { trigger: 'celebration', weight: 0.7 }` + `speak { text: \`Pump.fun is on fire — ${count} new launches in 2 seconds.\`, sentiment: 0.6 }`.
     3. If the loudest single `create` event has `solAmount > 5` (real big initial buy in SOL), override with `emote { trigger: 'curiosity', weight: 0.9 }` + `speak { text: \`${name} just opened with a ${solAmount.toFixed(2)} SOL buy.\`, sentiment: 0.5 }`.
   - Reconnect with exponential backoff (1 → 2 → 4 → 8 → cap 30 s, max 10 attempts). Reset on `open`.
   - Return `{ ok: true, started: true }`.
2. On `disable_live_reactions`:
   - Close the socket, clear the aggregator interval, return `{ ok: true, stopped: true }`.
3. Store the live socket + interval id in a closure inside `handlers.js`. The handler module is loaded once per skill install — that closure is fine. Do not attach to `window`.

If the existing skill registry already implements throttle policies on the protocol bus (prompt 01), this skill benefits automatically. If it does not, the 2 s aggregator window above is independently sufficient to keep the avatar composed.

## Out of scope

- A backend SSE proxy (covered by prompt 02; not required here).
- Per-token watchlists / filters.
- LLM narration.
- A settings UI.

## Verification (must all pass before archiving)

- Add `tests/pump-fun-reactive.test.mjs`:
  - Boot the skill registry against a real `<agent-3d>` instance in jsdom (existing tests do this).
  - Stand up a local `ws` server, monkey-patch the URL constant **only inside the test** to point at it (production code stays on the real PumpPortal URL).
  - Push real-shape `txType: 'create'` and `txType: 'migrate'` JSON frames; assert the right `gesture`/`emote`/`speak` events appear on the protocol bus.
  - Skip if `process.env.SKIP_NETWORK_TESTS === '1'`. Do not substitute fake events in the production path.
- Manual smoke: install the skill on the `/agent-home` page or a scratch `<agent-3d>`, call `enable_live_reactions`, observe the real avatar responding to live pump.fun events for ≥ 2 minutes.
- `npm run lint` clean.

## When done

1. Add a row to `pump-fun-skills/README.md` for the new skill.
2. `git mv prompts/data-reactive-avatars/04-pumpfun-reactive-skill.md prompts/data-reactive-avatars/archive/04-pumpfun-reactive-skill.md`.
