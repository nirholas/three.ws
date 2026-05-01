# Feature: Gaze at User When Speaking

## Goal
When the user is actively speaking (mic input) or has just sent a message, the avatar should bias its gaze toward the camera (i.e., "look at" the user) instead of drifting with saccades. When the agent is thinking/processing, the avatar should break eye contact and look slightly down or away — exactly as humans do.

## Context

**File to edit: `src/agent-avatar.js`**

The avatar already has a continuous gaze system:
- `this._mouseGaze { x, y }` — normalised -1..1 mouse position drives head yaw when `followMode === 'mouse'`
- `this._currentYaw` / `this._targetYaw` — horizontal gaze, lerped each frame in `_updateHeadTransform()`
- `this._currentTilt` / `this._targetTilt` — vertical lean
- `_lookTarget` — a `Vector3 | null`; when null, avatar looks at camera

**File to edit: `src/idle-animation.js`**

The idle animation already has:
- `_saccPauseTimer` — when > 0, saccade micro-movements pause (already wired to LOOK_AT events)
- `_blinkPauseTimer` — when > 0, blink is suppressed (already wired to SPEAK events)

**Protocol events already available** (from `src/agent-protocol.js` `ACTION_TYPES`):
- `speak` — agent is speaking (payload: `{ text, sentiment }`)
- `think` — agent is processing (payload: `{ thought }`)
- `load-start` / `load-end` — skill running

## What to build

### 1. Add a `_userSpeaking` flag to `AgentAvatar`

Wire it to whatever STT/input signal is available. For now, expose a public method:
```js
setUserSpeaking(active) {
    this._userSpeaking = active;
}
```

### 2. Gaze bias logic in `_updateHeadTransform()` (around line 615 in agent-avatar.js)

When `_userSpeaking === true`:
- Override `targetYaw` to 0 (face camera directly)
- Override `targetTilt` to slight upward (+0.04 rad) — attentive posture
- Suppress saccade drift by calling `this._idle?.setPauseSaccade(true)`

When agent is thinking (`this._emotion.patience > 0.3` or a new `_agentThinking` flag):
- Bias `targetYaw` to a small random offset (±0.15 rad) — looking away to "think"
- Bias `targetTilt` slightly downward (-0.06 rad)

When neither: restore normal follow-mode behavior.

### 3. Suppress saccade during user-speaking

In `src/idle-animation.js`, add a `setPauseSaccade(active)` method that sets `_saccPauseTimer` to a large value (e.g., 999) when active, and 0 when released. The existing `_tickSaccade()` already skips when `_saccPauseTimer > 0`.

### 4. Wire `think` protocol event

In `attach()` in agent-avatar.js, subscribe to `ACTION_TYPES.THINK` and set `this._agentThinking = true`. On `speak` events, set `this._agentThinking = false`. Decay `_agentThinking` after 3 seconds (track with a timer in `_tickEmotion()`).

## Conventions
- ESM only, tabs 4-wide, JSDoc for public methods, no TypeScript
- No new imports needed — `Vector3` and `MathUtils` already imported
- Don't touch `src/viewer.js` or `src/runtime/scene.js`
- All state in `AgentAvatar` instance fields, prefixed `_`
