# 44 — Empathy layer coordination: walk doesn't fight emotion blend

## Status
Design concern — the walk animation runs through `AnimationManager.crossfadeTo()` which drives the main animation mixer. The empathy layer in `agent-avatar.js` drives morph targets (facial expressions) and head bone rotation additively — it does NOT fight the body animation. However, one-shot gestures (wave, celebrate) DO use the same mixer and can conflict.

## Files
`src/agent-avatar.js` — `playGesture()`, `_tickEmotion()`
`src/element.js` — `_onStreamChunk()`

## What to verify

### Morph targets (facial expressions)
The empathy layer updates morph targets (`mouthSmile`, `eyeSquint`, etc.) every frame additively on top of any playing clip. Walk animation uses body bones only and does not touch morph targets. **No conflict** — verified by architecture.

### Head bone rotation
The empathy layer applies head lean/tilt/yaw by finding the Head or Neck bone and applying delta rotation. The walk animation bakes head motion into the clip (Mixamo walk includes head bob). The empathy layer's delta is added on top each frame.

**Potential conflict**: Walk clip may include strong head motion that fights the empathy layer's gaze tracking. Check visually — if the avatar's head looks like it's twitching during walk, reduce the walk clip's head influence.

**Fix if needed**: In `AnimationManager.play()` / `crossfadeTo()`, mask the head bone out of the walk action so only body bones are driven by the walk clip:
```js
// After creating the walk action in AnimationManager:
const headBone = model.getObjectByName('Head') || model.getObjectByName('Neck');
if (headBone) {
    walkAction.getMixer().setTime(0);
    // Weight the head bone to 0 in the walk clip
    // THREE.js doesn't have a bone mask API directly — skip head tracks
}
```
A simpler approach: in `build-animations.mjs`, strip head/neck tracks from the walk clip during build. Find the track filter step and exclude tracks matching `/head|neck/i`.

### One-shot gestures during walk
If `playGesture('wave')` fires while the avatar is walking, the gesture (LoopOnce) will blend with the walk (LoopRepeat). This is the correct behavior — gestures blend over the base animation. No conflict.

However, if `_stopWalkAnimation()` fires while a gesture is in progress, the crossfade to idle may interrupt the gesture. Fix: in `_stopWalkAnimation()`, check if a one-shot gesture is playing and delay the idle crossfade until the gesture finishes:
```js
_stopWalkAnimation() {
    if (!this._isWalking) return;
    this._isWalking = false;
    clearTimeout(this._walkStopDebounce);
    // Don't interrupt a one-shot gesture
    const am = this._viewer?.animationManager;
    const currentClip = am?.currentName;
    const isGesture = currentClip && currentClip !== 'walk' && currentClip !== 'idle';
    if (!isGesture) {
        this._scene?.playClipByName('idle', { loop: true, fade_ms: 500 });
    }
}
```

## Verification
While the avatar is walking, trigger a wave gesture (`element.wave()`). The wave should blend over the walk. Walk should stop after the wave finishes.
