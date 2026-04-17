# 14 — Idle animation loop module

## Why

An avatar that stands perfectly still reads as dead. Breathing + occasional head glance + micro-blink makes the agent feel alive. Currently inline hacks in multiple files; this consolidates it.

## Parallel-safety

Pure utility module. No wiring into existing code. Sibling prompts/code can opt in by importing.

## Files you own

- Create: `src/idle-animation.js`

## Read first

- [src/agent-avatar.js](../../src/agent-avatar.js) — the current avatar scene graph wrapper.
- Skim for existing idle logic to avoid double-breathing.

## Deliverable

```js
export class IdleAnimation {
    constructor({ root, bones = null, intensity = 1.0 })
    // root: THREE.Object3D (the avatar scene or armature root).
    // bones: optional override map { spine, head, leftShoulder, rightShoulder } of THREE.Bone refs.
    //        If null, auto-detect by common names (Hips, Spine, Spine1, Spine2, Head, Neck, mixamorigSpine, etc).
    // intensity: 0..1 multiplier on all oscillations.
    start(clock)       // clock: THREE.Clock or any getElapsedTime()-like.
    stop()
    update(deltaSeconds) // call from your render loop if you prefer manual ticking.
}
```

Behavior:
- **Breathing**: scale spine on Y by ±1% at 0.25Hz (~4s per breath).
- **Micro-sway**: ±0.5° rotation on spine root at 0.08Hz.
- **Head glance**: every 4–9s (random), rotate head yaw ±8° over 500ms, hold 200ms, return over 800ms.
- **Blink**: if the avatar has a morph target named `eyesClosed` / `blink` / `Fcl_EYE_Close` (VRM), drive a 120ms blink every 3–7s.
- All adds to existing bone transforms, never overwrites. On `stop()`, restore exact original transforms.

Honor `window.matchMedia('(prefers-reduced-motion: reduce)').matches` → skip the module entirely (start() becomes a no-op).

## Constraints

- No new deps. Three.js already present.
- Zero allocations inside `update()` — reuse Vector3/Quaternion temporaries.
- Guard against missing bones — if neither auto-detect nor overrides find a spine, log once and become a no-op.

## Acceptance

- `node --check src/idle-animation.js` clean.
- `npm run build` clean.
- Scratch-mount on a Mixamo rig: breathing visible, occasional glances visible, blink if morph present.

## Report

- Which bone-name heuristics matched on the default avatar.
- Benchmark: `update()` cost per frame (`console.time` over 300 frames).
