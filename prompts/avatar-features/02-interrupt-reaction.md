# Feature: Interrupt Body Reaction

## Goal
When the user speaks while the agent is mid-response (interrupts the TTS), the avatar should physically react — a small startled head snap or "wait" gesture — before the LLM catches up. Makes the interaction feel alive instead of the avatar blankly continuing to talk while the audio cuts off.

## Context

**`src/runtime/speech.js`** — contains `BrowserTTS` and `ElevenLabsTTS`. Both have a `stop()` method and a `_speaking` getter. ElevenLabs streams audio and can be interrupted mid-stream.

**`src/agent-avatar.js`** — has `_triggerOneShot(slot, duration)` which plays a named gesture clip from the animation library. The slot system is in `src/runtime/animation-slots.js`. Existing slots include `talk`, `nod`, `wave`, `think`, `celebrate`.

**`src/agent-protocol.js`** — the event bus. To add a new event type, add it to `ACTION_TYPES` and emit/subscribe like the others.

**`src/idle-animation.js`** — has `_saccPauseTimer` for pausing saccades (already used by LOOK_AT events).

## What to build

### 1. Add `ACTION_TYPES.INTERRUPTED` to `src/agent-protocol.js`

```js
INTERRUPTED: 'interrupted',
```

### 2. Emit `interrupted` from wherever TTS is stopped mid-speech

In both `BrowserTTS.stop()` and `ElevenLabsTTS` cancel path — emit if `_speaking` was true when stop was called:
```js
// Only if we were actually speaking, not a clean end
if (this._speaking) {
    this._speaking = false;
    protocol.emit(ACTION_TYPES.INTERRUPTED, {});
}
```
The `protocol` reference needs to be passed in at construction or as a param to `stop()`. Check how it's currently wired in `src/runtime/index.js` or `src/element.js` to find the right injection point. Prefer passing it to `stop()` to avoid changing the constructor signature.

### 3. Subscribe in `AgentAvatar.attach()`

```js
this._sub(ACTION_TYPES.INTERRUPTED, this._onInterrupted.bind(this));
```

### 4. Implement `_onInterrupted()`

```js
_onInterrupted() {
    // Quick head snap — "oh, you're talking"
    this._triggerOneShot('startle', 0.6);
    // Drain patience, inject curiosity (they're taking over)
    this._emotion.patience = 0;
    this._injectStimulus('curiosity', 0.5);
}
```

The `startle` slot probably won't exist in the animation library. Add a fallback in `_triggerOneShot` or `_playSlot`: if the clip isn't found, do a quick morph-only reaction instead (raise `browInnerUp` to 0.8, decay over 0.5s). This avoids a hard dependency on a specific animation clip existing.

### 5. Morph-only fallback for missing `startle` clip

In `_onInterrupted()`, always fire the morph reaction regardless of clip availability:
```js
this._setMorphTarget('browInnerUp', 0.9);
this._setMorphTarget('mouthOpen', 0.3);
// These will lerp back to emotion-driven values naturally in _tickEmotion
```

## Testing
- Open the app, trigger a long agent response
- Speak/click interrupt before it finishes
- Avatar should snap brows up briefly, curiosity should spike (visible in face morph)

## Conventions
- ESM only, tabs 4-wide
- Don't add `startle` to DEFAULT_ANIMATION_MAP unless the clip actually exists in the animation library — the fallback handles the missing-clip case
- Update the event vocabulary table in `src/CLAUDE.md` with the new `interrupted` type
