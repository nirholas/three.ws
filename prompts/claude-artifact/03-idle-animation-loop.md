# Task: Idle animation loop for the Artifact avatar

## Context

Repo: `/workspaces/3D`. Claude.ai Artifacts render in a sandboxed iframe and — in most current hosts — do NOT give the embedded content keyboard focus, and often swallow pointer events (wheel, drag) to preserve the chat scroll. That means our normal interactive `OrbitControls` avatar is dead-looking in an Artifact: no mouse-over, no gaze-follow, just a frozen T-pose.

The Empathy Layer in [../../src/agent-avatar.js](../../src/agent-avatar.js) is already a continuous blend of `{ neutral, concern, celebration, patience, curiosity, empathy }` driven by protocol events. **Without events, the blend stays at `neutral = 1.0`** — avatar looks asleep.

This task specifies an idle-loop driver that lives inside the bundle from [./02-zero-dep-viewer-bundle.md](./02-zero-dep-viewer-bundle.md) and makes the avatar look alive without any user input.

Relevant existing files:
- [../../src/agent-avatar.js](../../src/agent-avatar.js) — Empathy Layer. The `_injectStimulus(emotion, weight)` method is the right entry point for injecting synthetic stimuli (see `_onSpeak`, `_onSkillDone` etc. for patterns).
- [../../src/agent-protocol.js](../../src/agent-protocol.js) — the bus. Idle-loop stimuli can be fired through `protocol.emit()` so the Empathy Layer reacts naturally rather than directly poking `_emotion`.

## Goal

Design and implement an idle animation loop that makes the Artifact-embedded avatar look subtly alive — continuous breathing, occasional head glances, very rare blinks — without being distracting and without requiring any user interaction. The loop must be layered *on top of* the existing Empathy Layer so that real stimuli (from task 04's chat-message postMessage bridge) still override it cleanly.

## Deliverable

1. **File created** — `artifact-bundle/src/idle-loop.js` (lives under the bundle directory from task 02). Exports `class IdleLoop`:

    ```js
    new IdleLoop({ avatar, protocol, viewer }).start()
    idle.stop()
    ```

2. Integration point in `artifact-bundle/src/index.js` (from task 02) — when `opts.idle !== false`, instantiate and start the loop at the end of `mount()`.

3. Tests / measurement — document the feel in a short section of the bundle's own README (NOT in `src/`): frame budget, how often head-glance fires, what emotion weights are used.

## Behaviour specification

### Breathing (continuous)
- Apply a sine-wave scale to the root bone's Y position (or chest bone if found): `amplitude = 0.006` in world units, `period = 4.0 s`. This is pure kinematics — do NOT route through the emotion blend.
- Find-the-bone logic: traverse scene for a bone named `Spine`, `Spine1`, `Chest`, or `mixamorigSpine`, case-insensitive. Fall back to animating the root of the skinned mesh if no bone found.
- Budget: &lt;0.05 ms per frame.

### Head glance (occasional)
- Every `randBetween(6, 14)` seconds, pick a random off-axis look target within a cone of ±30° horizontal, ±15° vertical, at distance 2m in front of the avatar. Hold for `randBetween(1.2, 2.5)` seconds, then glance back to center for a random hold `randBetween(2, 5)` seconds.
- Drive this through the Empathy Layer by calling `avatar.setLookTarget(vec3)` — existing API. Do NOT bypass.
- While a glance is active, inject a very small `curiosity` stimulus (`weight: 0.15`) on glance-start so the avatar's face subtly engages.

### Blink (rare — only when model supports it)
- Detect if any morph target named `eyeBlinkLeft` / `eyeBlinkRight` / `eyesClosed` exists on any mesh. If not, skip entirely.
- Every `randBetween(3, 7)` seconds, play a 120 ms blink: ramp closed→0.95, hold 40 ms, ramp open→0.0. Apply directly to morph targets, do NOT route through the blend map.
- Never fire mid-glance (skip if glance just started).

### Ambient emotion drift (very subtle)
- Every `randBetween(15, 40)` seconds, inject one of `{ curiosity: 0.20, empathy: 0.15, celebration: 0.18 }` — choose uniformly. Let the Empathy Layer's existing decay handle fade-out. Never inject concern from the idle loop.
- Skip injection entirely if the current blended weight of that emotion is already &gt; 0.3 (don't pile on).

### First-encounter behaviour
- The existing Empathy Layer already does a curiosity burst at attach-time (see [src/agent-avatar.js:120-126](../../src/agent-avatar.js)). The idle loop must NOT duplicate it. Add a 2-second grace period after `start()` before the idle loop fires its first stimulus.

## Audit checklist — must handle all of these

- `IdleLoop.stop()` cancels all pending timers (store `setTimeout` ids on the instance) and restores the breathing offset to zero before returning.
- `stop()` is idempotent.
- The loop uses `setTimeout` scheduled on self-rescheduling intervals, NOT a `setInterval` — so jitter in the browser's timer accuracy doesn't accumulate drift.
- The loop pauses automatically when `document.hidden` (visibilitychange) — Artifacts can be scrolled off-screen within Claude's chat.
- When paused, no stimuli fire and no breathing updates run. When resumed, the first schedule fires after the normal random delay, not instantly.
- No allocation inside the per-frame breathing update (re-use a single `Vector3`).
- All randomness uses `Math.random()` — no extra deps.
- Head-glance target is computed in avatar-local space then transformed to world. If the avatar is reparented, the glance still aims correctly. (Use the avatar root's `.localToWorld()`).
- The loop respects a chat-message override: task 04 will fire `protocol.emit('speak', ...)` via postMessage bridge. When a real speak event fires, the idle loop should skip its next scheduled ambient-drift injection (single skip is enough — don't build a full state machine).

## Constraints

- No new deps.
- Don't modify `src/agent-avatar.js` or `src/agent-protocol.js` — they're shared with the main app. If you absolutely need a new hook, stop and report.
- Don't introduce a separate RAF — piggy-back on the mini-viewer's render loop from task 02 via an `onFrame` callback.
- Don't emit `gesture` events from the idle loop — gestures are one-shots and will fight with real user-triggered animations.
- Don't play baked-in idle clips from the GLB even if present — many agent GLBs don't have them, and switching behaviour based on clip availability is inconsistent UX.

## Verification

1. `node --check artifact-bundle/src/idle-loop.js`.
2. `npm run build:artifact` — bundle still under budget (150 KB gzipped excluding three.js).
3. Open `public/artifact/index.html` locally, watch the avatar for 2 minutes. Note: breathing visible, head glance ~every 10s, no aggressive movement.
4. Paste the task-01 snippet into a real Claude Artifact. Watch for 2 minutes. Report whether it feels "alive but calm".
5. DevTools Performance profile: record 30s, confirm per-frame cost of idle loop &lt;0.2 ms on a mid-tier laptop.
6. Send a `postMessage` with a `speak` action from the parent (task 04 will wire this but you can test manually via browser console: `window.postMessage({ type: 'speak', text: 'hello' }, '*')` in the Artifact frame). Confirm the idle loop defers its next ambient drift.

## Scope boundaries — do NOT do these

- Do not add any UI controls to toggle idle. The bundle's `opts.idle` already controls it.
- Do not implement gaze-follow-the-mouse. Pointer events are unreliable in Artifacts.
- Do not play speech or tts. Silent avatar only.
- Do not introduce a second Empathy Layer instance. Use the one the bundle already mounts.
- Do not change decay rates in [src/agent-avatar.js](../../src/agent-avatar.js).

## Reporting

At the end, summarise:
- File created (`artifact-bundle/src/idle-loop.js`), lines of code.
- Integration point changed in `artifact-bundle/src/index.js` (one line or a block).
- Bundle size delta (before/after gzipped).
- Your observation after watching the live Claude Artifact for 2 minutes: is it "alive but calm"?
- Any animation that felt wrong and what you tuned.
- Any Empathy Layer API you needed but didn't have — do NOT add it silently; flag it for a follow-up.
