# Task: Wire TalkingHead viseme lipsync into the agent runtime speak event

## Context

The project is three.ws — a platform for creating 3D AI agents with WebGL avatars, emotional presence, and an LLM brain.

The repo is at `/workspaces/3D-Agent`.

**What exists today:**

- `src/runtime/speech.js` — TTS providers: `BrowserTTS`, `ElevenLabsTTS`, `createTTS()`. When the runtime calls `speak(text)`, these fire audio but have no concept of mouth/jaw animation.
- `src/agent-avatar.js` — The Empathy Layer. Drives morph targets per-frame (`mouthSmile`, `mouthFrown`, etc.). Handles emotion blends but has **no lipsync** — the mouth does not move in sync with speech audio.
- `experiments/talking-head/` — An upstream clone of `met4citizen/TalkingHead`. Its `modules/talkinghead.mjs` implements full viseme lipsync: phoneme tables, viseme morph weights, and an animation loop that drives mouth shapes in sync with audio. The relevant exported API is `TalkingHead.speakText(text, avatar, callbacks)` which drives visemes from text + audio concurrently.
- `src/agent-protocol.js` — The event bus. The `speak` event shape is `{ text, sentiment }`.
- `src/runtime/index.js` — The LLM brain loop. It calls `speech.speak(text)` directly. Max tool iterations: 8.
- `src/runtime/scene.js` — `SceneController` wraps the Viewer. Has `setExpression(name, weight)`, `playClipByName(name, opts)`, and direct access to `this.viewer`.

**The problem:** When the agent speaks, audio plays but the avatar's mouth is completely static. The morph targets for mouth shapes (`mouthOpen`, `mouthSmile`, `jawOpen`, `viseme_*` for ARKit-style avatars) exist on the mesh but nothing drives them during speech.

**The goal:** During any `speak` event, drive jaw/mouth morph targets in sync with the speech audio so the avatar visibly lip-syncs.

---

## Scope

**In scope:**
- A `LipsyncDriver` module at `src/runtime/lipsync.js` that:
  - Accepts a reference to the Three.js scene (to find morph targets)
  - Accepts a `text` string
  - Drives jaw/mouth morph targets while audio plays
  - Uses a simple energy-based approach (phoneme-to-viseme lookup from the TalkingHead experiment as a reference) — not a full neural lipsync
  - Cleans up (resets all mouth morphs to 0) when speech ends or is cancelled
- Wiring `LipsyncDriver` into `src/runtime/speech.js` as an optional add-on — if lipsync is enabled, it runs alongside `speak()`. If no suitable morph targets are found, it noops silently.
- Integration with `BrowserTTS` and `ElevenLabsTTS` via the `onStart`/`onEnd` callbacks both already support.

**Out of scope:**
- Full neural lipsync (Rhubarb, wav2vec, etc.)
- Importing the `experiments/talking-head/` module directly (it has its own three.js instance and render loop — don't entangle it)
- Any changes to `agent-avatar.js` emotion logic
- TTS provider changes beyond hooking `onStart`/`onEnd`

---

## Reference: viseme morph targets

Ready Player Me avatars (the most common avatar type in this project) use ARKit-style morph targets. The relevant ones for lipsync:

```
viseme_aa  — "ah" sound (father)
viseme_CH  — "ch/sh" (church, she)
viseme_DD  — "d/t/n/l" (dog, top)
viseme_E   — "eh" (bed)
viseme_FF  — "f/v" (farm, very)
viseme_I   — "ee" (see)
viseme_kk  — "k/g" (cat, go)
viseme_nn  — "n/ng" (now, sing)
viseme_O   — "oh" (go, hope)
viseme_PP  — "b/m/p" (back, map)
viseme_RR  — "r" (red)
viseme_sil — silence
viseme_SS  — "s/z" (see, zoo)
viseme_TH  — "th" (the, think)
viseme_U   — "oo" (you, new)
```

Fallback for non-ARKit avatars: `jawOpen`, `mouthOpen`.

---

## Approach

**Text-to-phoneme heuristic (no audio analysis required):**

Map character runs to approximate phoneme buckets. This is intentionally rough — the goal is plausible mouth movement, not perfect accuracy:

```js
const CHAR_TO_VISEME = {
  a: 'viseme_aa', e: 'viseme_E', i: 'viseme_I', o: 'viseme_O', u: 'viseme_U',
  b: 'viseme_PP', m: 'viseme_PP', p: 'viseme_PP',
  f: 'viseme_FF', v: 'viseme_FF',
  d: 'viseme_DD', t: 'viseme_DD', n: 'viseme_DD', l: 'viseme_DD',
  k: 'viseme_kk', g: 'viseme_kk',
  s: 'viseme_SS', z: 'viseme_SS',
  r: 'viseme_RR',
  'th': 'viseme_TH',
  'ch': 'viseme_CH', 'sh': 'viseme_CH',
};
```

Tokenize `text` into a sequence of `{ viseme, durationMs }` pairs by splitting on whitespace + estimating ~80ms per phoneme. Then drive them as a timed sequence using `setTimeout` while audio plays.

**Morph target resolution:** Walk `scene.traverse()` once to find all meshes with `morphTargetDictionary`. Build a lookup table `{ visemeName → [{ mesh, index }] }`. Reuse it for the lifetime of the driver.

**Integration point in `speech.js`:**

```js
// BrowserTTS.speak() — modified
async speak(text, { onStart, onEnd, scene } = {}) {
  // ... existing code ...
  utter.onstart = () => {
    this._speaking = true;
    if (scene) this._lipsync = startLipsync(text, scene);
    onStart?.();
  };
  utter.onend = () => {
    this._speaking = false;
    this._lipsync?.stop();
    onEnd?.();
    resolve();
  };
}
```

Pass `scene` from `SceneController` when calling `speech.speak()` in `runtime/index.js`.

---

## Files to create/edit

**Create:**
- `src/runtime/lipsync.js` — `startLipsync(text, scene)` → returns `{ stop() }`. All logic here.

**Edit:**
- `src/runtime/speech.js` — pass `scene` through to lipsync in `BrowserTTS.speak()` and `ElevenLabsTTS.speak()`. Don't break the existing API — `scene` is optional.
- `src/runtime/index.js` — pass `scene` from `SceneController` when calling `speech.speak()`.

**Do not touch:**
- `src/agent-avatar.js` — don't change emotion blend logic
- `experiments/talking-head/` — read for reference only, don't import
- Any viewer files

---

## Acceptance criteria

1. Load any Ready Player Me GLB in the viewer. Start the agent. Have it speak a sentence.
2. The avatar's mouth visibly moves during speech — not just the smile/frown from emotion, but distinct phoneme-shaped movements.
3. When speech ends, all mouth morphs return to 0 within 200ms.
4. If the scene has no ARKit morph targets (e.g. a Mixamo character without visemes), the code noops — no errors, no broken morphs.
5. `npx vite build` passes with no new warnings.
6. `node --check src/runtime/lipsync.js` passes.

## Constraints

- ESM only. Tabs, 4-wide. Match existing style in `src/runtime/`.
- No new npm dependencies — use the Three.js `Object3D.traverse` and `Mesh.morphTargetDictionary` APIs already available.
- Don't import anything from `experiments/`.
- The lipsync must stop and reset if `speech.cancel()` is called mid-utterance.
