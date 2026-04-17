# 02 — Idle Animation Loop

## Context

A static avatar dies on screen. Without idle motion, users think the page froze; with it, the agent looks alive even when nothing is happening. Sprint-100 mapped an `idle-animation.js` module — a subtle continuous ambient loop (breathing, micro-saccades, weight-shifting, blink) — but **the file was never written**. The empathy layer in `src/agent-avatar.js` already handles _reactive_ morph blending; this prompt fills in the _baseline_ motion underneath.

This is the difference between a kiosk mannequin and something that looks embodied. It is table-stakes for every embed surface: Claude artifact, LobeHub plugin, CZ landing, dashboard preview, and the public viewer.

## Goal

Implement a tasteful, performant idle loop that runs whenever no other animation is overriding the avatar. The loop must be subtle (never distracting), cheap (runs in the per-frame update, must cost < 0.3ms on a mid-range laptop for a Mixamo-rigged avatar), and respectful of the empathy layer (additive, not replacing).

## Files you own

Create:

- `src/idle-animation.js`

Edit (inside uniquely-named anchor only):

- `src/agent-avatar.js` — add a single anchor block `// BEGIN:IDLE_LOOP ... // END:IDLE_LOOP` and a matching import block `// BEGIN:IDLE_LOOP_IMPORT ... // END:IDLE_LOOP_IMPORT`. Wire the idle controller in once per avatar mount; tick it from the existing per-frame update. **No edits outside these anchors.**

## Files read-only

- `src/agent-avatar.js` — understand the existing empathy blend, morph target traversal, and per-frame hook. Find the method that runs every frame (likely `update(dt)` or similar).
- `src/agent-protocol.js` — `ACTION_TYPES` tells you which actions should _pause_ idle (e.g. when the avatar is actively speaking or gesturing).
- `src/runtime/scene.js` — `SceneController` for context.

## Design — what "idle" means

Four independent, additive channels (ordered by weight in the final blend):

1. **Breathing** — sinusoidal chest/shoulder bone rotation (if bones exist) or `mouthOpen`/`browInnerUp` morph micro-modulation as fallback. Period ~4s. Amplitude ~1% of neutral. Never clip.
2. **Micro-saccades** — small random eye/head yaw/pitch offsets (±1.5°) with dwell times in [0.8, 2.4]s. Smoothed (critically damped spring, zeta≈1). Pause when `AgentProtocol` emits a `look` action; resume 500ms after the look target is cleared.
3. **Blink** — close both eyelid morphs (`eyeBlinkLeft`, `eyeBlinkRight` if present) to 1.0 over 80ms, hold 40ms, open over 120ms. Random interval uniformly in [2.5, 6.0]s. Skipped during `speak` actions (blink feels weird mid-phoneme).
4. **Weight shift** — slow hip bone yaw drift (±0.5°) with 8s period, different phase per avatar (seeded by agent id hash) so multiple avatars on a page do not sync.

Every channel defaults to `enabled: true` but can be toggled individually via a `setChannels({...})` method.

Critical constraint: **empathy layer must win**. If the blended morph weight for `mouthOpen` from the empathy layer is > 0.2 (user is talking), the breathing channel stops touching `mouthOpen`. The idle module reads the current frame's empathy weights before applying; never overwrite, always add.

## API surface (`src/idle-animation.js`)

```js
export class IdleAnimation {
    /**
     * @param {object} opts
     * @param {THREE.Object3D} opts.root          Avatar root (skinned mesh hierarchy).
     * @param {object} opts.protocol              AgentProtocol instance (to observe speak/gesture).
     * @param {string} [opts.seed]                Stable seed for per-avatar phase (use agent id).
     * @param {Partial<{breathing,saccade,blink,weightShift}>} [opts.channels]
     */
    constructor(opts) { ... }

    /** Call every frame with elapsed seconds since last tick. */
    update(dt) { ... }

    /** Toggle channels at runtime. Accepts partial — unmentioned channels unchanged. */
    setChannels(partial) { ... }

    /** Stop all timers and detach protocol listeners. */
    dispose() { ... }
}
```

Internals:

- Collect eyelid, brow, mouth morph indices once in constructor; cache them.
- Collect head/neck/hip bones by name (search Mixamo + RPM + generic — try `Head`, `mixamorig:Head`, `neck`, etc). Log once if none found; fail soft (no errors at runtime).
- No `setInterval` / `setTimeout` — everything is dt-driven from `update()`. This keeps the module pausable, scrubbable, and test-friendly.
- No allocations in `update()`. Reuse `THREE.Euler` / `Quaternion` scratch buffers kept as instance fields.

Deterministic jitter via a small mulberry32 PRNG seeded by `opts.seed` — do NOT use `Math.random()`.

## Wiring into `src/agent-avatar.js`

Find the constructor and the per-frame update method. Add:

```js
// BEGIN:IDLE_LOOP_IMPORT
import { IdleAnimation } from './idle-animation.js';
// END:IDLE_LOOP_IMPORT
```

In the constructor (or wherever the avatar root object becomes available — possibly a `setAvatar`/`onLoad` method):

```js
// BEGIN:IDLE_LOOP
this._idle = new IdleAnimation({
    root: <theAvatarRoot>,
    protocol: this._protocol,  // or however it's referenced in this class
    seed: this._agentId ?? 'default',
});
// END:IDLE_LOOP
```

In the per-frame update method (within the same or a neighbouring anchor, depending on file layout):

```js
// Inside BEGIN:IDLE_LOOP ... END:IDLE_LOOP
this._idle?.update(dt);
```

In the avatar disposal/unmount path: `this._idle?.dispose();`.

If the anchor block layout gets awkward because the constructor and the update method are far apart, use three separate anchor pairs with unique suffixes: `IDLE_LOOP_IMPORT`, `IDLE_LOOP_INIT`, `IDLE_LOOP_TICK`, `IDLE_LOOP_DISPOSE`. Log exactly which ones you used in the report.

## Deliverables checklist

- [ ] `src/idle-animation.js` created, ~200–350 LOC, JSDoc typed.
- [ ] Four channels implemented: breathing, micro-saccades, blink, weight-shift. Each independently toggleable.
- [ ] Empathy-layer deference: idle never overwrites, always adds; breathing backs off `mouthOpen` when empathy weight > 0.2.
- [ ] No `setTimeout`/`setInterval`. Pure dt-driven.
- [ ] No allocations in hot path (`update()`).
- [ ] Deterministic seeded jitter (mulberry32).
- [ ] Wired into `src/agent-avatar.js` via `IDLE_LOOP*` anchor blocks only.
- [ ] `dispose()` cleans up protocol listeners.
- [ ] Prettier pass on all touched files.

## Acceptance

- `node --check src/idle-animation.js` passes.
- `node --check src/agent-avatar.js` passes.
- `npm run build` succeeds with no new warnings.
- `git grep -n "IDLE_LOOP" src/agent-avatar.js` shows paired BEGIN/END anchors only.
- `git grep -n "setInterval\|setTimeout" src/idle-animation.js` returns zero matches.
- Manual smoke: load `localhost:3000/?m=<sample-glb>` with an avatar that has eyelid morphs — observe blinks within ~5s, subtle breathing rise/fall, head drifts during silence, breathing backs off when the avatar speaks.

## Report + archive

Post the report block from `00-README.md`, then:

```bash
git mv prompts/final-integration/02-idle-animation.md prompts/archive/final-integration/02-idle-animation.md
```

Commit: `feat(avatar): idle animation loop — breathing, saccade, blink, weight-shift`.
