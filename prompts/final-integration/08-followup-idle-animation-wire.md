# 08 — Follow-up: Wire IdleAnimation into AgentAvatar

## Origin

Surfaced by QA smoke test (07). Flow F failed static analysis: `src/idle-animation.js` exports `IdleAnimation` but it is never imported or instantiated anywhere.

## Defect

`src/idle-animation.js:39` — `IdleAnimation` class implements blink, head-drift, and glance FSM but has zero consumers. The per-frame `_tickEmotion` in `src/agent-avatar.js` does not call it.

## Smallest-possible fix

In `src/agent-avatar.js`:

1. Add import at top: `import { IdleAnimation } from './idle-animation.js';`
2. In the constructor (after `this._tickBound` is assigned), add: `this._idle = null;`
3. In `setAvatar(viewer)` (or wherever the avatar skeleton is first available), instantiate: `this._idle = new IdleAnimation({ root: viewer.scene, bones: viewer.bones });`
4. In `_tickEmotion(dt)`, at the end of Stage 1 (after decay), add: `if (this._idle) this._idle.tick(dt);`

That is ≤ 8 lines of change across one file.

## Acceptance

- `IdleAnimation` is imported and instantiated in `src/agent-avatar.js`.
- On `/agent/<id>`, watching for 10 seconds: blink morph fires on eyes, subtle head drift occurs.
- Performance tab: average frame time < 16.7ms.
- `npm run verify` still exits 0.
