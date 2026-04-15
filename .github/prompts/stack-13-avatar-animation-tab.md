---
mode: agent
description: "Animation tab — pick idle + gesture animations from Mixamo bundle"
---

# Stack Layer 3: Animation Tab

## Problem

Avatars ship with a skeleton but no default animations. We need a UI to pick: (1) idle animation, (2) greeting animation, (3) thinking animation, (4) celebration animation. Bundled via `npm run fetch-animations` (Mixamo).

## Implementation

### Animation inventory

[src/animation-manager.js](src/animation-manager.js) already handles loading/blending. List available clips via `GET /api/animations/catalog` — reads from wherever fetch-animations puts them (`public/animations/` or similar).

Catalog response:
```json
[
  { "id": "idle-breathing", "name": "Breathing Idle", "tags": ["idle"], "durationMs": 3200, "previewGif": "/previews/idle-breathing.gif" },
  ...
]
```

### UI

Four slots:
| Slot | Purpose |
|---|---|
| Idle | Plays when agent is passive (default loop) |
| Greet | Plays on `greet` skill or avatar home load |
| Think | Plays during async actions (sign, fetch, compute) |
| Celebrate | Plays on `celebration` emotion peak |

Each slot shows current selection, "Change" button opens a picker modal with previews.

### Preview

Picker shows animation name + a looping preview. If GIF previews don't exist, render a tiny canvas that plays the clip on the user's current avatar rig (more work but nicer).

### Persistence

`avatars.animations` jsonb column:
```json
{ "idle": "idle-breathing", "greet": "waving", "think": "thinking-scratch", "celebrate": "fist-pump" }
```

`PATCH /api/avatars/:id/animations` endpoint.

### Retarget compatibility

Not all Mixamo clips retarget cleanly to every rig. If a selected clip fails to retarget at runtime ([src/animation-manager.js](src/animation-manager.js)), fall back to the default idle and log a warning — don't crash the viewer.

### Live bridge

On change, emit `animation.set` event on agent protocol → preview pane swaps immediately.

## Validation

- Change idle → preview loops the new idle within 1s.
- Change greet → hitting greet skill plays the new animation.
- Pick an incompatible clip → warning, falls back to default, preview still works.
- Persists across refresh.
- `npm run build` passes.

## Do not do this

- Do NOT upload arbitrary user-provided FBX/GLB animations in v1 — catalog only.
- Do NOT regenerate preview GIFs client-side — ship them with the animation bundle.
