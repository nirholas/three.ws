# Feature: Spatial Audio for Multi-Agent Scenes

## Goal
In scenes with multiple agents (e.g. Bob + Alice side by side), each agent's voice should come from where their avatar is positioned in 3D space. Bob on the left sounds like he's on the left. Turning toward the camera makes the voice more center. This is a drop-in Three.js feature that requires no changes to the LLM or agent layers.

## Context

**`src/runtime/speech.js`** — `ElevenLabsTTS` plays audio via an `<audio>` element or `AudioContext`. This is the integration point. `BrowserTTS` uses `window.speechSynthesis` which doesn't support positional audio (browser limitation) — skip it for this feature.

**`src/viewer.js`** — contains the Three.js scene, camera, and renderer. The `camera` is accessible as `this.viewer.camera`. The `AudioListener` needs to be attached to the camera.

**`src/agent-avatar.js`** — has access to `this.viewer` and the loaded avatar model root (`this.viewer.content`). The head bone position is already discovered in `idle-animation.js` — reuse that or find the avatar root position.

**Three.js audio classes needed:**
- `THREE.AudioListener` — attached to camera once, shared across all agents
- `THREE.PositionalAudio` — one per agent, attached to a bone or the avatar root

## What to build

### 1. Singleton `AudioListener` on the camera

In `src/viewer.js` (or wherever camera setup happens), add once:
```js
if (!this._audioListener) {
    this._audioListener = new THREE.AudioListener();
    this.camera.add(this._audioListener);
}
```

Expose it: `viewer.audioListener`.

### 2. Add `PositionalAudio` support to `ElevenLabsTTS`

`ElevenLabsTTS` currently streams audio to an `<audio>` element. To make it positional, the audio needs to go through the Web Audio API graph.

Modify `ElevenLabsTTS` to accept an optional `positionalAudio: THREE.PositionalAudio`:

```js
constructor({ voiceId, proxyURL, positionalAudio = null } = {}) {
    ...
    this._positionalAudio = positionalAudio;
}
```

When `_positionalAudio` is set, route the audio source through it instead of playing directly:
```js
// Instead of: audioEl.play()
// Do:
const source = this._positionalAudio.context.createMediaElementSource(audioEl);
source.connect(this._positionalAudio.panner);
this._positionalAudio.play();
```

Three.js `PositionalAudio` wraps a `PannerNode`. You wire the source → panner → destination yourself.

### 3. Create and position `PositionalAudio` in `AgentAvatar`

In `AgentAvatar.attach()`, after the model loads:

```js
_initSpatialAudio() {
    if (!this.viewer.audioListener) return;
    if (this._positionalAudio) {
        this._positionalAudio.parent?.remove(this._positionalAudio);
    }
    this._positionalAudio = new THREE.PositionalAudio(this.viewer.audioListener);
    this._positionalAudio.setRefDistance(1.5);
    this._positionalAudio.setRolloffFactor(1.0);
    this._positionalAudio.setDistanceModel('inverse');

    // Attach to head bone if available, else avatar root
    const anchor = this._headBone ?? this.viewer.content;
    if (anchor) anchor.add(this._positionalAudio);
}
```

The `_headBone` is found in `idle-animation.js`. Either pass it up or re-traverse in `AgentAvatar` — `_buildMorphCache()` already traverses the model, so add bone discovery there.

### 4. Pass `PositionalAudio` to TTS

After `_initSpatialAudio()`, update the TTS instance:
```js
if (this._tts instanceof ElevenLabsTTS && this._positionalAudio) {
    this._tts.setPositionalAudio(this._positionalAudio);
}
```

Add `setPositionalAudio(pa)` to `ElevenLabsTTS`.

### 5. Teardown

In `AgentAvatar.detach()`:
```js
if (this._positionalAudio) {
    this._positionalAudio.stop();
    this._positionalAudio.parent?.remove(this._positionalAudio);
    this._positionalAudio = null;
}
```

## Positioning multiple agents

The spatial audio is automatic once each avatar's `PositionalAudio` node is attached to their head bone — Three.js handles panning based on world position relative to the camera/listener. No extra positioning code needed.

For Bob and Alice to sound spatially distinct, their avatar models just need to be at different X positions in the scene. Confirm the multi-agent scene layout does this.

## Fallback
- If `viewer.audioListener` is null (single-agent mode or BrowserTTS), `_initSpatialAudio()` returns early — existing audio path unchanged
- If no head bone is found, audio anchors to avatar root — still better than nothing

## Conventions
- ESM only, tabs 4-wide
- Import `AudioListener`, `PositionalAudio` from `'three'` (already a dependency)
- One `AudioListener` per page — check `viewer.audioListener` before creating
- Don't modify `BrowserTTS` — spatial audio via SpeechSynthesis isn't possible in browsers
