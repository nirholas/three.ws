# Task: Make the hero avatar track the cursor (gaze-follow)

## Context

Repo: `/workspaces/3D`. The `/features` hero renders a `<model-viewer>` avatar at [features.html:74-92](../../features.html#L74-L92) with `camera-orbit="20deg 68deg 3.4m"` and `auto-rotate` enabled.

We want the avatar to feel alive and aware — when the user moves the cursor over the hero, the camera orbit gently rotates toward the cursor so the avatar appears to "look at" the user. This is the tasteful, low-risk version of cursor interaction — contrast with [task 04](./04-dragon-mode.md) which makes the avatar itself chase the cursor.

This task does **not** depend on Pretext. It is scheduled in the Pretext series because it pairs well with [task 02's](./02-hero-text-wrap.md) static text wrap: the avatar subtly tracks while the copy wraps around it.

## Goal

With `?pretext=3` (or `?gaze=1` — choose one, document it), hovering the hero rotates the avatar's camera orbit toward the cursor with eased smoothing. On `mouseleave`, the avatar smoothly returns to its default orbit and resumes `auto-rotate`.

## Deliverable

1. **Extend [src/features/hero-pretext.js](../../src/features/hero-pretext.js)** (or add a small sibling `src/features/gaze-follow.js` and import it — your call, document the choice):
   - `enableGazeFollow()` method triggered by the flag.
   - Attach `pointermove` (throttled to rAF) on `.hero` — convert cursor position to a pair of offsets relative to the avatar center, normalized to `[-1, 1]` per axis.
   - Map to orbit deltas: max ±15° on theta (horizontal), max ±8° on phi (vertical). Feel free to tune, but keep magnitudes subtle.
   - Disable `auto-rotate` while tracking; re-enable after 1.2s of idle (no pointer movement) or on `pointerleave`.
   - Smooth toward target with a critically-damped spring or `lerp` with `alpha ≈ 0.12` per frame — no stuttering, no overshoot.
   - Honor `prefers-reduced-motion: reduce` — if set, skip the entire feature and leave `auto-rotate` on.
2. **No CSS changes** required. If you need to hint interactivity (e.g. `cursor: none` or a subtle reticle), propose it in the reporting section but do not ship it.

## Audit checklist

- [ ] Cursor on the left of the avatar → avatar looks left; cursor on the right → looks right. Up/down similarly.
- [ ] No `<model-viewer>` attribute thrash — update `camera-orbit` at most once per frame.
- [ ] `pointermove` is throttled/coalesced with `requestAnimationFrame` — never scheduled from the event handler directly.
- [ ] `mouseleave` / `pointerleave` transitions back over ~400ms with easing, not an instant snap.
- [ ] `auto-rotate` stops during tracking and resumes after idle or leave.
- [ ] `prefers-reduced-motion: reduce` fully disables the behavior.
- [ ] Works with touch: on touch devices, do nothing (no `pointermove` without hover). Detect via `matchMedia('(hover: hover)')`.
- [ ] No layout thrash — cursor→orbit math uses only the cached `.hero-avatar` rect, refreshed on resize.

## Constraints

- Do not load Three.js directly or reach into `model-viewer`'s shadow DOM. Use only the public `camera-orbit` attribute / property.
- No new deps.
- Scoped to `features.*` and `src/features/`. No changes to [src/viewer.js](../../src/viewer.js), [src/app.js](../../src/app.js), or `style.css`.
- Must coexist with task 02's static wrap — both can be on at the same time (`?pretext=3` implies tasks 01–03 are active).

## Verification

1. `node --check` the new/modified JS file.
2. `npx vite build` completes.
3. Dev server, `/features?pretext=3`:
   - Move cursor in a slow circle over the hero → avatar head tracks smoothly.
   - Flick the cursor left↔right fast → no stutter, no snap-back.
   - Leave the hero → ~400ms eased return → auto-rotate resumes within ~1.2s.
4. `prefers-reduced-motion: reduce` set in OS or DevTools → feature disabled, auto-rotate unchanged.
5. Touch device (DevTools device emulation) → feature disabled.
6. DevTools Performance → `pointermove`-driven frames stay under 16ms.

## Scope boundaries — do NOT do these

- Do not make the avatar translate or chase the cursor — that's [task 04](./04-dragon-mode.md).
- Do not adjust `field-of-view`, `exposure`, or lighting reactively.
- Do not add a cursor reticle, trail, or parallax effect on background elements. Propose in reporting only.
- Do not write new environment maps or change the avatar model.

## Reporting

- Chosen smoothing method (lerp vs spring) and the tuned constants.
- How idle is detected and the idle timeout actually used.
- Any flicker or `camera-orbit` parsing edge cases you hit.
- Interaction feel — 1-2 sentences on whether the magnitude and easing felt right. If it felt creepy or robotic, flag for design review.
- Confirmation that reduced-motion and touch paths were exercised.
