# Feature: Confidence Signaling via Avatar Body Language

## Goal
When the LLM's response is hedged or uncertain ("I think", "not sure", "might be", "probably"), the avatar should visually signal low confidence — a subtle fidget, slight head tilt, softer posture. When the response is assertive and confident, the avatar should reflect that too. Users unconsciously read this and calibrate their trust appropriately.

## Context

**`src/agent-avatar.js`** — The emotion system currently has: `neutral`, `concern`, `celebration`, `patience`, `curiosity`, `empathy`. All are continuous weighted blends.

The `_onSpeak` handler already does sentiment analysis via `_analyzeSentiment(text)` (valence + arousal) and injects stimuli. This is the right place to also detect confidence.

The morph targets already driven each frame (in `_tickEmotion` around line 490–510):
- `mouthSmile` ← celebration
- `mouthFrown` ← concern  
- `browInnerUp` ← concern + empathy
- `browOuterUp` ← curiosity
- `eyeSquint` ← empathy

**`src/idle-animation.js`** — `_tickWeightShift()` drives hip bone Y rotation on a slow sine wave. The amplitude is fixed. This could be modulated by confidence level.

**`src/runtime/animation-slots.js`** — `DEFAULT_ANIMATION_MAP` maps slot names to clip names. A `fidget` slot could be added here.

## What to build

### 1. Add `uncertain` to the emotion state

In `AgentAvatar` constructor and `attach()` reset:
```js
this._emotion = {
    neutral: 1.0,
    concern: 0,
    celebration: 0,
    patience: 0,
    curiosity: 0,
    empathy: 0,
    uncertain: 0,   // ← add this
};
```

In `DECAY` constant at the top of the file:
```js
uncertain: 0.10,  // half-life ~7s
```

### 2. Hedge vocabulary detection

Add to the `VOCAB` object at the top of `agent-avatar.js`:
```js
uncertain: [
    "i think", "not sure", "might be", "probably", "possibly",
    "i believe", "i'm not certain", "could be", "maybe", "roughly",
    "approximately", "unclear", "uncertain", "hard to say", "it depends",
    "i'd guess", "seems like", "appears to", "not entirely sure",
],
```

Note: `_analyzeSentiment()` already scans text for vocab keywords. Check whether it handles multi-word phrases or only single tokens — if single tokens, add the single-word variants and skip phrases.

### 3. Inject `uncertain` stimulus from `_onSpeak`

In `_onSpeak()`, after the existing valence checks:
```js
const uncertainScore = this._scoreVocab(text, 'uncertain');
if (uncertainScore > 0) this._injectStimulus('uncertain', Math.min(uncertainScore * 0.4, 0.8));
```

### 4. Wire `uncertain` to morph targets in `_tickEmotion()`

Add to the morph target section:
```js
// Uncertain: slight lip press, raised inner brow (questioning look)
this._setMorphTarget('mouthPressLeft', w.uncertain * 0.35);
this._setMorphTarget('mouthPressRight', w.uncertain * 0.35);
this._setMorphTarget('browInnerUp', 
    Math.max(w.concern * 0.6, w.uncertain * 0.45, w.empathy * 0.5)
);
```

### 5. Modulate idle weight-shift amplitude

In `src/idle-animation.js`, `_tickWeightShift()` currently has a fixed amplitude. Add an `_uncertaintyBias` field to `IdleAnimation` that the avatar can set:

```js
// In IdleAnimation constructor:
this._uncertaintyBias = 0;  // 0..1, increases hip drift amplitude

// In IdleAnimation, add setter:
setUncertainty(value) {
    this._uncertaintyBias = Math.max(0, Math.min(1, value));
}

// In _tickWeightShift(), multiply amplitude:
const amplitude = (0.018 + this._uncertaintyBias * 0.025) * DEG2RAD;
```

In `AgentAvatar._tickEmotion()`, after computing `w`:
```js
this._idle?.setUncertainty(w.uncertain);
```

### 6. Add `fidget` slot to DEFAULT_ANIMATION_MAP (optional)

In `src/runtime/animation-slots.js`, add:
```js
fidget: 'Fidget',
```
Only matters if a Fidget clip exists in the animation library. Skip if not — the morph targets cover the visual signal.

## Testing
- Send a message that produces a hedging response ("what's the capital of France?" shouldn't trigger it; "explain quantum entanglement" likely will)
- Watch for subtle brow raise + lip press during hedged sentences
- Hip drift should increase slightly during uncertain passages

## Conventions
- ESM only, tabs 4-wide
- `uncertain` should never sum with other emotions to push `neutral` negative — `_injectStimulus` already clamps, but verify `_tickEmotion()` normalization handles the new bucket
- Update `src/CLAUDE.md` Empathy Layer tables with `uncertain` decay rate and morph mapping
