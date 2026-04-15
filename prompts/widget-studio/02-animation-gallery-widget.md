# Prompt 02 — Animation Gallery Widget

**Branch:** `feat/widget-animation-gallery`
**Depends on:** `feat/studio-foundation` (Prompt 00) merged.
**Parallel with:** 01, 03, 04, 05.

## Goal

Ship the Animation Gallery widget: an embedded 3D experience that turns a rigged avatar's animation clips into labeled buttons the end user can click. "Idle / Wave / Dance / Run" becomes a visible, interactive demo instead of a hidden feature buried in dat.gui.

This is the widget that makes Mixamo-style rigs feel like *a product*. A rigged avatar with seven animations should ship as an interactive showcase in one click from Studio.

## Prerequisites

- Prompt 00 merged.
- `src/widget-types.js` contains an `animation-gallery` entry (currently `status: 'pending'`). Flip it to `'ready'` as part of this PR.

## Read these first

| File | Why |
|:---|:---|
| [src/viewer.js](../../src/viewer.js) — animation-related methods (`setAnimationDefs`, `playClip`, `stopClip`, `updateAnimations`) | The viewer already loads external animation GLBs via a manifest and can play them. Use this API; do not reinvent animation mixing. |
| [src/app.js:363–410](../../src/app.js#L363-L410) | `_configureAnimations()` — the existing animation manifest loading flow. Your widget must coexist with it. |
| [src/components/animation-panel.jsx](../../src/components/animation-panel.jsx) | Existing dat.gui animation UI. You're replacing this visually for the widget, but the logic is a reference. |
| [public/animations/manifest.json](../../public/animations/manifest.json) (if present) | See the default animation set. |
| Prompt 01 (`01-turntable-widget.md`) | Copy its runtime module pattern exactly — do not diverge. |

## Build this

### 1. Config schema

Extend `src/widget-types.js`:

```js
const ANIMATION_GALLERY_DEFAULTS = {
  clips:         [],           // optional allowlist of clip names to expose; [] = all
  startClip:     'idle',       // which clip plays on load (or '__none' for static)
  loopStart:     true,         // auto-loop start clip
  buttonStyle:   'pill',       // 'pill' | 'tab' | 'grid'
  buttonPosition: 'bottom',    // 'bottom' | 'top' | 'left' | 'right'
  showPlayingIndicator: true,
  allowCrossfade: true,        // smooth transitions between clips
  crossfadeDurationMs: 250,
  labels: {},                  // { clipName: "Custom Label" } overrides
};
```

Validation: `startClip` must be `'__none'` or one of `clips` if `clips` is non-empty. Clamp `crossfadeDurationMs` to [0, 2000].

### 2. Studio form controls

When `state.type === 'animation-gallery'`:

- After an avatar is selected, probe its animations. Load the GLB's clip names — cheapest path: temporarily load the GLB in the live preview and read `viewer.clips` via `iframe.contentWindow.VIEWER.viewer.clips`. Populate a checklist of clip names.
- **Clips to show** — multiselect; blank = all.
- **Start clip** — dropdown (clips + "None (static)" option).
- **Button style** — radio: pill / tab / grid.
- **Button position** — radio: bottom / top / left / right.
- **Show playing indicator** — checkbox.
- **Crossfade** — toggle + ms slider (0–2000).
- **Labels editor** — two-column list: "Original name" → "Display label" (text inputs). Only show for clips the user checked.

Validation: disable "Generate Embed" if the avatar has zero animations. Show a helpful "This avatar has no animation clips" message pointing to Mixamo.

### 3. Widget runtime

Create `src/widgets/animation-gallery.js`:

```js
export function mountAnimationGallery(viewer, config, container) {
  // 1. Hide all non-canvas UI (same as turntable).
  // 2. Read viewer.clips (built-in animations) and viewer.externalClips (from manifest).
  //    Filter to config.clips if non-empty.
  // 3. Render a button bar positioned per config.buttonPosition.
  //    Each button shows config.labels[name] || titleCase(name).
  // 4. Highlight the active button. If showPlayingIndicator, show a small progress bar
  //    below it tracking the clip's normalized time (use mixer actions).
  // 5. On click: crossfade from current action to selected clip's action over
  //    config.crossfadeDurationMs (use THREE.AnimationAction.crossFadeTo).
  // 6. If config.startClip !== '__none', play it on mount with loop.
  // 7. Handle keyboard: left/right arrows cycle clips (a11y).
  // 8. Return { destroy, play, stop }.
}
```

### 4. Wire into `src/app.js`

Mirror the turntable dispatcher from Prompt 01:

```js
if (window.VIEWER.widget?.type === 'animation-gallery') {
  const { mountAnimationGallery } = await import('./widgets/animation-gallery.js');
  this.view(resolvedModel, '', new Map()).then(() => {
    // Wait for external animations manifest to resolve too:
    this.viewer.whenAnimationsReady().then(() => {
      this._widgetRuntime = mountAnimationGallery(this.viewer, window.VIEWER.widget.config, this.el);
    });
  });
}
```

Add a `whenAnimationsReady()` promise to `Viewer` if it doesn't exist — the `_configureAnimations()` flow resolves async, and we must wait for it.

### 5. Visual polish

- **Pill style:** rounded buttons with 8px radius, 1px accent border. Active button: filled accent background, inverse text color.
- **Tab style:** flat bottom bar, active tab has a thick accent underline.
- **Grid style:** wraps; for 3+ clips show in a wrapped flex grid. Good for avatars with 10+ clips.
- **Playing indicator:** a 2px progress bar under the active button tracking clip time from 0 to `clip.duration`. Use `requestAnimationFrame`.
- **Mobile:** buttons on left/right auto-collapse to an expandable drawer on viewport < 600px wide.

### 6. Crossfade correctness

- Keep a reference to the currently playing `AnimationAction`.
- On clip switch: call `currentAction.crossFadeTo(newAction, durationSec, true)` and call `newAction.play()` first.
- Reset weights if crossfade is interrupted mid-transition.
- If `allowCrossfade: false`, call `.stop()` on current and `.play()` on new. No fade.

### 7. a11y

- Button bar is a `role="tablist"`, buttons are `role="tab"` with `aria-selected`.
- Keyboard: arrow keys cycle; Enter/Space activates; Home/End jump.
- Playing indicator has `aria-live="polite"` announcing clip changes.
- `prefers-reduced-motion: reduce` → crossfade duration forced to 0.

## Do not do this

- Do not build a timeline scrubber. Buttons only in v1.
- Do not expose speed control. If someone wants a trick shot, they set `playbackRate` in config (add as an optional field if trivial).
- Do not autoload arbitrary external GLB animations from user input. Only use `viewer.externalClips` that the existing `_configureAnimations` flow resolves.
- Do not break the existing animation panel in the non-widget viewer.
- Do not change `_configureAnimations()` signature — only add to it.

## Deliverables

**New:**
- `src/widgets/animation-gallery.js`
- CSS for pill/tab/grid button styles (extend turntable's widget CSS).

**Modified:**
- `src/widget-types.js` — mark `animation-gallery` as `ready`, add schema.
- `src/app.js` — dispatcher.
- `src/viewer.js` — `whenAnimationsReady()` promise accessor.
- `public/studio/studio.js` — animation gallery fieldset.

## Acceptance criteria

- [ ] Selecting an avatar with 3+ animations shows them as checkboxes in Studio.
- [ ] Selecting an avatar with 0 animations shows a helpful empty state and disables Generate.
- [ ] Saved widget URL renders buttons in the chosen position and style.
- [ ] Clicking a button crossfades smoothly; indicator tracks progress.
- [ ] Keyboard navigation works (Tab into bar, arrows cycle, Enter plays).
- [ ] Screen reader announces clip changes.
- [ ] Config persists and round-trips correctly.
- [ ] `prefers-reduced-motion: reduce` disables crossfade.
- [ ] Works at 320px wide (mobile) and 1920px wide (desktop).
- [ ] No console errors.
- [ ] Bundle size increase < 10 KB gzipped.

## Test plan

1. Create a widget using the default CZ avatar or any Mixamo-rigged character.
2. Pick 4 clips, rename them, choose grid layout at bottom.
3. Open the public URL. Click each button. Verify crossfade is smooth (no T-pose flicker).
4. Tab through buttons with keyboard only. Enter plays. Arrow keys cycle.
5. Chrome DevTools → emulate iPhone SE. Buttons render. Drawer collapses on narrow width.
6. Enable reduced motion. Crossfade becomes instant.
7. Load an avatar with no animations. Studio shows the empty state.
8. Confirm the non-widget viewer (`/` with no `#widget=`) still shows dat.gui animation controls as before.
9. `npm run build` succeeds.

## When you finish

- PR with GIF showing button bar + crossfade.
- Flip `animation-gallery` status to `ready` in `src/widget-types.js`.
