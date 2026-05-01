# 48 — Coordinate walk animation with agent-avatar.js think clip

## Status
Conflict risk — `src/agent-avatar.js` plays a `think` clip (1.5–2s one-shot) when the empathy layer detects curiosity or when a `load-start` event fires. The AnimationManager handles both the walk loop and the think one-shot. If think fires while walk is playing, or walk starts while think is mid-play, the crossfade may create a jarring transition.

## Files
`src/agent-avatar.js` — find `think` clip usage
`src/element.js` — `_onStreamChunk()`

## Background

In agent-avatar.js, `_triggerOneShot('think', 1.5)` is called for:
- `load-start` → patience + curiosity triggers `think` clip
- Curiosity weight > 0.6 → `think` clip

The AnimationManager's `crossfadeTo()` handles transitions, but a LoopOnce one-shot and a LoopRepeat walk compete for the mixer's weight.

## What to investigate

Read `agent-avatar.js` around the `_triggerOneShot` calls. Understand:
1. Does it use the same AnimationMixer as the walk? (Yes — same `viewer.animationManager`)
2. Does the one-shot get blended additively or does it replace the current action?

In AnimationManager, `playGesture` / `_triggerOneShot` likely uses a separate action channel with `LoopOnce`. Three.js blends all active actions. The walk (LoopRepeat) + think (LoopOnce) would blend — the think overlay plays on top of walk. This is actually the desired behavior for expressive motion.

## Potential issue

If the empathy layer calls `think` clip during a walk, the avatar will walk AND do the think gesture simultaneously. For a 1.5s clip, this looks fine — the character is clearly thinking while moving.

The real risk: when `think` finishes (LoopOnce + clampWhenFinished), the action stays frozen at its last frame (T-pose or raised hand) until explicitly stopped. This would override the walk animation visually.

## Fix

In `agent-avatar.js`, after `_triggerOneShot` actions, add a listener to reset the action:
```js
// After creating the LoopOnce action:
action.addEventListener('finished', () => {
    action.stop();
});
```

Check if this listener is already present. If not, add it.

## Verification
While the avatar is walking (mid-response), force curiosity high enough to trigger the think clip (use the debug console: `window.VIEWER.agent_avatar._emotions.curiosity = 0.8`). The think gesture should play briefly on top of walking, then return to clean walk. Avatar should not get stuck in the think pose.
