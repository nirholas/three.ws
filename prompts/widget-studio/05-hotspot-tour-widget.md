# Prompt 05 — Hotspot Tour Widget

**Branch:** `feat/widget-hotspot-tour`
**Depends on:** `feat/studio-foundation` (Prompt 00) merged.
**Parallel with:** 01, 02, 03, 04.

## Goal

Ship the Hotspot Tour widget: an interactive 3D scene where the owner has pinned annotations to specific mesh points, and the visitor taps/clicks to read them. Optional guided tour mode steps through hotspots in order with camera transitions.

This is the "product explainer" widget — perfect for describing a rigged character's features, a product's parts, or an agent's capabilities.

## Prerequisites

- Prompt 00 merged.
- Familiarity with the existing `src/annotations.js` — the viewer already auto-generates annotations from model data (scene nodes tagged in glTF). Your widget extends this with **user-authored** hotspots placed via click-in-preview.

## Read these first

| File | Why |
|:---|:---|
| [src/annotations.js](../../src/annotations.js) | Existing auto-annotation system. Your widget reuses the projection math (world-space point → screen-space overlay). |
| [src/viewer.js](../../src/viewer.js) — `buildAnnotations`, `updateAnnotations`, `projectAnnotations` references | Understand how annotations attach to world positions and track the camera. |
| [src/viewer.js](../../src/viewer.js) — raycasting (look for `THREE.Raycaster`) | You need to cast rays from click points to find world-space mesh intersections. |
| Prompt 00 — Studio preview iframe + postMessage bridge | You'll extend the bridge to carry click events from the preview to the Studio authoring UI. |
| Prompt 01 | Copy the base widget runtime pattern. |

## Build this

### 1. Config schema

Extend `src/widget-types.js`:

```js
const HOTSPOT_TOUR_DEFAULTS = {
  hotspots: [],               // array of Hotspot objects (below)
  tourMode: 'free',           // 'free' = click-around | 'guided' = step through in order
  showDots:  true,            // always-visible dot markers
  dotStyle:  'numbered',      // 'numbered' | 'plain' | 'pulse'
  autoOpenFirst: false,       // opens first hotspot on load
  tourAutoAdvanceSec: 0,      // if >0, tour mode auto-advances
  showTourControls: true,     // prev/next buttons in tour mode
};

// Hotspot object:
{
  id: 'hs_abc123',            // short random id
  position: [x, y, z],        // world-space point on the model
  normal:   [nx, ny, nz],     // surface normal (helps orient the dot)
  title:    'Left arm',
  body:     'This is the articulated left arm with 4 degrees of freedom.',
  cameraFrame: [cx, cy, cz, tx, ty, tz],  // optional: camera position + target when viewing this hotspot
}
```

Validation: each hotspot has unique id, title ≤ 80 chars, body ≤ 500 chars. Max 20 hotspots per widget (v1 limit — room to raise later).

### 2. Studio authoring UI

This is the most complex Studio form of the set because it's a click-to-place flow.

Layout when `state.type === 'hotspot-tour'`:

- **Preview becomes authoring mode.** A "Place hotspot" button toggles. When active, clicking the preview model drops a hotspot at the clicked surface point.
- **Hotspot list sidebar:** shows all hotspots. Click one to:
  - Edit title, body.
  - "Recenter camera" — snapshots the current preview camera as this hotspot's `cameraFrame`.
  - Delete.
  - Reorder (drag handles).
- **Tour options:** free vs. guided, auto-advance, show controls, etc.

**The click-to-place flow requires cross-frame cooperation.** The Studio (parent) listens for a `widget:hotspot:place` message. The preview (child) runs in "author mode" when it receives `widget:author:enable { mode: 'place' }`. The preview enables a raycaster on canvas clicks, emits `{ point, normal, hitMeshName }` back up. Studio appends to `config.hotspots` and triggers a save draft.

### 3. Widget runtime

Create `src/widgets/hotspot-tour.js`:

```js
export function mountHotspotTour(viewer, config, container) {
  // 1. Hide non-canvas UI.
  // 2. For each hotspot, create a DOM element (dot + number).
  //    Project its world position to screen space each frame (mirror src/annotations.js).
  // 3. On hotspot click/tap:
  //    - Show a popover near the dot with title + body.
  //    - If hotspot.cameraFrame, animate viewer camera + target to that frame with an ease.
  //    - In guided tour mode, show prev/next buttons in the popover.
  // 4. If autoOpenFirst, trigger hotspot 0 on mount.
  // 5. In tourAutoAdvance mode, advance every N seconds; pause on user interaction.
  // 6. Handle occlusion: if a hotspot's world position is behind geometry from the camera's view,
  //    dim the dot to 40% opacity. Use a raycaster from camera to hotspot.position; if hit distance
  //    < distance to hotspot, it's occluded.
  // 7. Keyboard: arrow keys cycle hotspots in guided mode.
  // 8. Return { destroy, goto(index) }.
}
```

### 4. Camera ease

Use a smooth spring or `TWEEN.js`-style ease (do not pull in TWEEN — hand-roll a simple one):

```js
function easeCameraTo(camera, controls, target, position, durationMs = 700) {
  // lerp controls.target toward target, camera.position toward position, over durationMs.
  // Use easeInOutCubic.
}
```

Pause OrbitControls during the transition; resume after.

### 5. Dot style variants

- **Numbered:** accent-colored circle with the hotspot's index number.
- **Plain:** small accent-colored dot.
- **Pulse:** plain dot with a CSS pulsing ring animation (attention-grabbing).

Respect `prefers-reduced-motion` (disable pulse).

### 6. Popover positioning

- Popover appears adjacent to the clicked dot.
- Smart positioning: flip to the opposite side if near a viewport edge.
- Max width 320px. Auto-truncate body with "Read more" if it overflows.
- Close via X button, outside click, or Escape key.

### 7. Touch support

- Tap opens popover.
- Tap outside closes it.
- Two-finger pinch/pan still orbits the model in free mode; disabled during guided tour transitions.

### 8. Authoring safety

- In Studio, prevent hotspots from being placed more than ~N meters from the model bounds (invalid clicks on empty space should be rejected or snapped to closest mesh).
- Require at least 1 hotspot before enabling Generate Embed.
- Warn if two hotspots are within ~0.1m of each other (likely accidental double-click).

## Do not do this

- Do not integrate with the existing auto-annotation system in v1 — keep user-authored hotspots separate from glTF-derived ones. The widget should ignore the model's built-in annotations.
- Do not add freeform drawing or measurement tools.
- Do not support video/image attachments to hotspots (v2).
- Do not ship more than 20 hotspots per widget.
- Do not let the popover contain markdown links with arbitrary URLs; restrict to plain text + whitelisted safe URLs (`https://` only, rendered with `rel="noopener noreferrer"`).

## Deliverables

**New:**
- `src/widgets/hotspot-tour.js`
- Hotspot-related CSS (dots, popover, tour controls).

**Modified:**
- `src/widget-types.js` — mark `hotspot-tour` as `ready`, add schema.
- `src/app.js` — dispatcher + enable author-mode postMessage handling when a query param (e.g. `?author=1`) is present on the preview iframe.
- `public/studio/studio.js` — hotspot-tour authoring UI (click-to-place, list, editor).
- `src/viewer.js` — expose a public `raycastFromNDC(x, y)` helper if not already available, so the widget runtime and the Studio can share it.

## Acceptance criteria

- [ ] Studio supports: place, edit, delete, reorder, set camera frame.
- [ ] Saved widget URL renders dots at the correct world positions across window resizes and camera orbits.
- [ ] Clicking a dot opens the popover; clicking outside closes it.
- [ ] Guided tour mode walks through hotspots with smooth camera transitions.
- [ ] Occluded hotspots dim but do not disappear.
- [ ] Keyboard navigation works in tour mode.
- [ ] Popover is readable on mobile (320px wide).
- [ ] `prefers-reduced-motion` disables pulse and shortens camera transitions.
- [ ] No console errors.
- [ ] Bundle size increase < 15 KB gzipped.

## Test plan

1. Open Studio with a detailed model (e.g. DamagedHelmet or FlightHelmet).
2. Place 5 hotspots on different mesh regions. Add titles and bodies. Save a camera frame for each.
3. Drag to reorder. Delete one. Re-add elsewhere.
4. Save, open public URL.
5. Click each dot → popover appears with correct title/body.
6. Enable guided mode, autoOpenFirst, 5-second auto-advance. Reload URL → tour auto-plays.
7. Orbit the model — dots track correctly.
8. Orbit behind the model — dots on the far side dim (occlusion).
9. Resize the window — dots stay glued to mesh positions.
10. Mobile view — popover positions sensibly, pinch-zoom still works.
11. Try with `prefers-reduced-motion: reduce` — pulse disabled, transitions shortened.
12. `npm run build` succeeds.

## When you finish

- PR with a GIF showing: place in Studio → save → embed with guided tour.
- Flip `hotspot-tour` status to `ready`.
