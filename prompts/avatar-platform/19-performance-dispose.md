# Task: Performance, disposal correctness, and render-on-demand

## Context

Repo: `/workspaces/3D`. By this point the viewer loads VRMs, runs TalkingHead idle, TTS, STT, optional mirror / full-body / brain workloads. Without discipline, the tab will pin a CPU core, stutter on lower-end devices, and leak on model swap.

This task doesn't add features — it audits and fixes the compositional performance problems across the stack.

Should be scheduled **after** tasks 02, 09, 12, 14, 16 are in.

## Goal

1. Idle CPU with a VRM loaded and TalkingHead idling: avatar tab uses < 5% CPU on a mid-range laptop.
2. Model swap (load a new VRM over an existing one) frees the old GPU resources — `renderer.info.memory.geometries` and `.textures` return to baseline after GC.
3. Render-on-demand: when nothing is animating (no idle, no mirror, no TTS, no camera orbit), the render loop pauses and renders only on explicit `invalidate()` calls.
4. All feature modules have reliable `dispose()` paths; a full app teardown leaves zero detached event listeners, zero pending timers, zero leaked GPU buffers.

## Deliverable

1. **Dispose audit** — for each module added in tasks 02–17, confirm `dispose()` exists and is called on teardown. Write a `src/runtime/lifecycle.js` that owns the module registry:
   - `register(name, { start, stop, dispose })`.
   - `teardownAll()` calls `dispose` on each in reverse registration order.
2. **Render-on-demand** — adapt [src/viewer.js](../../src/viewer.js)'s render loop:
   - Replace the unconditional RAF loop with an `invalidate()` gate.
   - Invalidate on: camera orbit, window resize, texture/material updates, animation active, TalkingHead active, mirror mode active.
   - When nothing demands a frame, skip rendering.
3. **Animation reference counting** — many modules request continuous rendering (TalkingHead idle, mirror, TTS-driven lipsync). Introduce `viewer.requestContinuous(owner)` / `releaseContinuous(owner)`. Render only if count > 0 OR a one-shot invalidate is pending.
4. **Texture/geometry disposal** — on model swap, walk the old scene graph and call `.dispose()` on every `BufferGeometry`, `Material`, and `Texture`. Verify via `renderer.info.memory`.
5. **Throttle landmark detections** — mirror mode (task 12) runs MediaPipe at 30 Hz max; verify this instead of per-RAF.
6. **Web Worker offload** — move whisper-web (task 11) to a Web Worker if not already; move any heavy image processing (task 07 texture projection) to a Worker. Don't block the render thread.
7. **Idle detection** — add a global "user idle" detector (no mouse/keyboard for 60s): pause TalkingHead idle to a slow-blink-only mode, pause mirror mode processing.
8. **Performance budget doc** — `docs/PERFORMANCE.md` (one-time doc, OK here):
   - Budget: 16ms frame at 60 fps idle, 33ms frame budget for mirror/mocap.
   - GPU memory budget per loaded avatar.
   - Tactics (render-on-demand, workers, LOD, throttling).
   - How to profile (Chrome Performance, three.js stats, renderer.info).

## Audit checklist

- [ ] Idle CPU < 5% on a mid-range laptop with a VRM loaded and default animations.
- [ ] `renderer.info.memory` after model swap returns to within 10% of baseline.
- [ ] Tab in background (visibility hidden) → render loop pauses.
- [ ] `teardownAll()` disposes every registered module; a subsequent boot has no leaked listeners (count via `getEventListeners` on `window`).
- [ ] No `requestAnimationFrame` without a pairing cancellation path.
- [ ] Workers terminate on `dispose()`.
- [ ] `npx vite build` passes; bundle size delta documented.

## Constraints

- No new rendering dependencies.
- Do not change visual behavior — this is purely performance + correctness.
- Do not regress any feature. A render-on-demand bug is worse than a continuous-render waste.
- Keep profiling data in `docs/PERFORMANCE.md`, not scattered.

## Verification

1. Baseline measurement BEFORE this task (record fps, cpu%, memory).
2. Apply changes; repeat measurement. Deliver a before/after table.
3. Stress test: load avatar, swap 10 times, open mirror, run TTS 5 times, swap again. Memory returns to baseline after final GC.
4. Teardown: call `lifecycle.teardownAll()` in DevTools → confirm listeners, workers, timers all gone.
5. Background-tab test: open avatar, switch tab for 5 min → no CPU activity.

## Scope boundaries — do NOT do these

- No LOD / mesh simplification (separate future task).
- No texture atlasing (separate).
- No offscreen canvas rendering refactor (separate).
- No SharedArrayBuffer / SIMD work beyond what MediaPipe / Transformers already use.

## Reporting

- Before/after table: fps, cpu%, memory, bundle size.
- Any feature that needed redesign to cooperate with render-on-demand.
- Any intractable leaks (if found) — file as known issues with repro.
- Profiling screenshots (Chrome Performance flame chart) for the heaviest scenario.
