# Feature: Phoneme-Based Lip Sync

## Goal
Replace the current blunt `mouthOpen` hint (triggered once per `speak` event, held for word-count duration) with per-frame viseme-driven mouth morphs that actually match the spoken audio. The avatar's mouth should move with the words, not just hang open while talking.

## Context

**Current state in `src/agent-avatar.js`:**
- `_onSpeak()` calls `_triggerOneShot('talk', duration)` which sets `_isPlayingOneShot = true`
- In `_tickEmotion()`, `mouthOpen` is set to `0.4` when `_isPlayingOneShot && _oneShotAction === 'talk'`
- That's the entire lip sync system — a flat morph hold

**`src/runtime/speech.js`** — Two TTS providers:
1. `BrowserTTS` — uses `window.SpeechSynthesis`. The `SpeechSynthesisUtterance` fires `boundary` events with word/sentence markers but no viseme data natively (Chrome 98+ has `onboundary` but not phoneme events).
2. `ElevenLabsTTS` — streams MP3 audio via fetch. No viseme stream in the current implementation.

**Morph targets already plumbed** in `src/agent-avatar.js`:
- `_morphMeshes` cache is built in `attach()`
- `_setMorphTarget(name, weight)` and `_morphLerpAll(dt)` are already called each frame
- Common ReadyPlayerMe/Mixamo viseme morph names: `viseme_PP`, `viseme_FF`, `viseme_TH`, `viseme_DD`, `viseme_kk`, `viseme_CH`, `viseme_SS`, `viseme_nn`, `viseme_RR`, `viseme_aa`, `viseme_E`, `viseme_I`, `viseme_O`, `viseme_U`

## Approach: OVR Lip Sync via Web Audio API (no external API needed)

Use the browser's `AnalyserNode` to get frequency data from the playing audio, then map frequency bands to viseme groups. This works for both BrowserTTS and ElevenLabs audio without any API changes.

This is an approximation (not true phoneme detection), but it's frame-accurate, zero-latency, and works offline.

### 1. Create `src/lip-sync-analyser.js`

```js
/**
 * LipSyncAnalyser — drives viseme morph weights from live audio via AnalyserNode.
 *
 * Frequency band → viseme group mapping (rough phoneme clustering):
 *   Low  (0–500 Hz)   → open vowels: viseme_aa, viseme_O
 *   Mid  (500–2k Hz)  → mid vowels + nasals: viseme_E, viseme_I, viseme_nn
 *   High (2k–8k Hz)   → sibilants + fricatives: viseme_SS, viseme_FF, viseme_CH
 *   Closure (any gap) → bilabials: viseme_PP (mapped from amplitude dips)
 */
export class LipSyncAnalyser {
    constructor() {
        this._ctx = null;
        this._analyser = null;
        this._source = null;
        this._freqBuf = null;
        this._active = false;
    }

    /**
     * Connect an HTMLAudioElement or MediaStreamSource to the analyser.
     * @param {HTMLAudioElement|MediaStream} audioSource
     */
    connect(audioSource) { ... }

    /** Disconnect and release. */
    disconnect() { ... }

    /**
     * Call every frame. Returns a viseme weight map or null if inactive.
     * @returns {Record<string,number>|null}
     */
    sample() { ... }
}
```

Implementation notes:
- Use `FFT_SIZE = 256`, `smoothingTimeConstant = 0.7`
- `getByteFrequencyData()` into a `Uint8Array` — no allocations per frame
- Map bin ranges to the three frequency groups, normalize 0–255 → 0–1
- Apply a `0.15` silence threshold — below it, return all-zero (mouth closed)
- Smooth output values with a simple `lerp(prev, new, 0.25)` — the `AnalyserNode` already smooths internally but the output can still jitter

### 2. Integrate into `ElevenLabsTTS`

`ElevenLabsTTS` plays audio via an `<audio>` element or `AudioContext`. Find where the audio is created and:
1. Create/reuse an `AudioContext`
2. Create a `MediaElementAudioSourceNode` from the audio element
3. Connect to an `AnalyserNode`
4. Connect the analyser to `ctx.destination`
5. Expose the analyser node: `tts.analyserNode`

### 3. Integrate into `BrowserTTS` (best-effort)

`SpeechSynthesis` audio is not exposed to the Web Audio API in most browsers (security restriction). For `BrowserTTS`, fall back to a word-boundary-driven simulation:
- On each `boundary` event (word), pick a random viseme sequence of 2–4 frames (100ms each)
- Simulate a consonant → vowel → consonant arc using `_scheduleVisemeSequence()`

### 4. Wire into `AgentAvatar`

Add a `_lipSync: LipSyncAnalyser | null` field.

In `_tickEmotion(dt)`, after existing morph updates:
```js
if (this._lipSync) {
    const visemes = this._lipSync.sample();
    if (visemes) {
        for (const [name, weight] of Object.entries(visemes)) {
            this._setMorphTarget(name, weight);
        }
        // Suppress the blunt mouthOpen when real visemes are active
        this._setMorphTarget('mouthOpen', 0);
    }
}
```

Add public method:
```js
connectLipSync(analyserOrTTS) {
    this._lipSync?.disconnect();
    this._lipSync = new LipSyncAnalyser();
    this._lipSync.connect(analyserOrTTS);
}
```

### 5. Activate from wherever TTS is started

In `src/element.js` or wherever `BrowserTTS`/`ElevenLabsTTS` is wired to the avatar:
```js
tts.onStart = () => avatar.connectLipSync(tts.analyserNode ?? tts);
tts.onEnd   = () => avatar._lipSync?.disconnect();
```

## Fallback behavior
If the avatar's model has no `viseme_*` morph targets (e.g. a custom non-RPM model), `_setMorphTarget` silently no-ops (it already does — the morph cache just won't have those indices). No defensive code needed.

## Conventions
- ESM only, tabs 4-wide
- `LipSyncAnalyser` must not allocate in `sample()` — pre-allocate all buffers in constructor
- Test with both BrowserTTS and ElevenLabs paths
- Don't remove the existing `mouthOpen` hint path — it serves as the fallback when `_lipSync` is null
