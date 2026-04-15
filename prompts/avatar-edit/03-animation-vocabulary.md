# Task 03 — Animation vocabulary

## Why

Every embodied agent needs movement: idle, wave, nod, shake-head, think, celebrate, concern. Users should pick which Mixamo clip the agent uses for each slot — otherwise every agent has identical body language.

## Read first

- [src/animation-manager.js](../../src/animation-manager.js) — Mixamo-style external animation bundle
- [src/viewer.js](../../src/viewer.js) — `setAnimationDefs`, `_setupAnimationPanel`
- `npm run fetch-animations` — script that populates the animation library
- [public/animations/](../../public/animations/) — existing GLB animation bundle
- [src/runtime/tools.js](../../src/runtime/tools.js) — `play_clip` tool

## Build this

### 1. Slot vocabulary

Fixed slot list (don't let users invent new ones):

```
idle, wave, nod, shake, think, celebrate, concern, bow, point, shrug
```

Each slot maps to one animation clip name from the library.

### 2. Patch shape

`agent_identities.meta.edits.animations`:

```json
{
  "idle":      "Mixamo/Breathing Idle",
  "wave":      "Mixamo/Waving",
  "celebrate": "Mixamo/Jump",
  …
}
```

Missing slots fall back to a default map defined in code.

### 3. `/agent/:id/edit` tab "Animations"

- Column A: the slot list.
- Column B: when a slot is clicked, list every clip in the library with a "Preview" button that plays it on the live avatar for its duration.
- Picking a clip assigns it and autosaves.

### 4. Runtime hook

In `src/runtime/tools.js`, when a tool says `play_clip('wave')`, look up the agent's mapping and pass the actual clip name to `viewer.animationManager.play(clipName)`.

In `src/agent-avatar.js`, the Empathy Layer already fires one-shot gestures on high emotion events. Route those through the same mapping:
- celebration > 0.6 → `play('celebrate')`
- concern > 0.6 → `play('concern')`
- curiosity > 0.6 + idle → small `play('think')`

### 5. Fallback

If the picked clip is not present in the current library (e.g. user picks via mobile, then we add animations), runtime warns once and uses the default map.

## Don't do this

- Do not allow uploading custom FBX / GLB clips. Library-only.
- Do not pre-cache every clip at agent boot. Lazy-load on first play.
- Do not touch the skeleton. Retargeting stays where it is in `animation-manager.js`.

## Acceptance

- [ ] Pick "Jump" for the celebrate slot → saving → triggering a celebration action (e.g. LLM says something positive) plays Jump.
- [ ] Unchanged slots fall back to the default map — nothing missing.
- [ ] `/agent/:id` embed reflects the choices.
- [ ] Changing a slot on the edit page immediately updates the live preview.
- [ ] `npm run build` passes.

## Reporting

- Final default-map JSON
- Screenshot of the tab
- Confirmation of runtime routing: pick a clip, trigger the emotion, observe playback
