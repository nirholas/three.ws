# Task: Wrap hero copy around the avatar silhouette (static)

## Context

Repo: `/workspaces/3D`. The `/features` hero is a two-column grid — left column has `.hero-chip`, `.hero-title` (with a gradient `<em>`), `.hero-subtitle`, `.hero-cta`, `.hero-proof`; right column is `.hero-avatar` containing a `<model-viewer>` with a circular ring. See [features.html:37-102](../../features.html#L37-L102) and [features.css](../../features.css).

Task [01](./01-install-and-scaffold.md) installed `@chenglou/pretext` and scaffolded [src/features/hero-pretext.js](../../src/features/hero-pretext.js). The `?pretext=1` flag wires the hero to the controller.

This task uses Pretext to re-lay `.hero-subtitle` text so it visibly **parts around a circular exclusion zone centered on the avatar**, producing a magazine-style editorial wrap. The avatar stays in place; the exclusion is static (computed once per resize). Cursor tracking and per-frame reflow are for later tasks.

## Goal

With `?pretext=2`, the hero subtitle renders via Pretext with a round hole cut out of the text column that corresponds to the avatar's bounding circle. Lines near the avatar are short and stagger around it; lines above and below use full column width. The effect should be obvious but tasteful — readable, not gimmicky.

Default (`?pretext=1` or no flag) continues to use the CSS-only grid layout. The change must degrade gracefully on failure.

## Deliverable

1. **Extend [src/features/hero-pretext.js](../../src/features/hero-pretext.js)**:
   - Add `enableStaticWrap()` method triggered when the flag is `>= 2`.
   - Computes the avatar's bounding circle in page-space via `getBoundingClientRect()` (read once, cached).
   - Calls Pretext's layout API with the subtitle text + the avatar circle as an exclusion. **Verify the exact API by reading `node_modules/@chenglou/pretext/` + [chenglou.me/pretext](https://chenglou.me/pretext/) Dragon/Editorial demos before implementing.** If the public API doesn't support per-line exclusion, fall back to splitting the subtitle into a 2-column flow that flanks the avatar (see §Fallback).
   - Renders laid-out lines into an absolutely-positioned overlay `<div class="hero-subtitle-pretext">` inside `.hero-content`, replacing the original `.hero-subtitle` visually (keep the original in DOM as `aria-hidden="false"` for screen readers; mark the overlay `aria-hidden="true"`).
   - On `resize` (debounced ~120ms), recompute and re-render.
2. **Add CSS to [features.css](../../features.css)** under a new `/* ── Pretext overlay ─── */` section:
   - `.hero-subtitle-pretext` — absolute positioned, matches `.hero-subtitle` typography (font, size, color, weight, line-height) via CSS custom props or explicit rules.
   - When Pretext is active, hide the original `.hero-subtitle` via a `.pretext-active` class on `.hero` (`.pretext-active .hero-subtitle { visibility: hidden; }`). This keeps the layout reserved if Pretext fails to paint.
3. **No layout thrash** — all `getBoundingClientRect()` reads happen up front; writes follow. Use a single `requestAnimationFrame` to paint lines.

## Audit checklist

- [ ] Subtitle reads correctly top-to-bottom when laid out around the circle. Lines are not clipped.
- [ ] The avatar's bounding circle is derived from `.hero-avatar` rect (not the full `<model-viewer>` canvas, which includes transparent padding).
- [ ] Resize re-layouts correctly — debounced, no flicker, no jank.
- [ ] Font/color/weight of the re-rendered lines visually matches the original `.hero-subtitle`.
- [ ] Screen readers get the full subtitle (original DOM node preserved).
- [ ] `prefers-reduced-motion` — no effect on this static task, but document the decision in a comment.
- [ ] If Pretext layout throws, the original `.hero-subtitle` remains visible (class is not added).

## Fallback (use if Pretext lacks per-line exclusion)

If the Pretext public API only exposes rectangular layout, implement a simpler two-band approximation:

- Split the subtitle into an "above-avatar" band (full width, top of avatar rect) and a "below-avatar" band (full width, bottom of avatar rect) — Pretext lays out each band with `layout()` and you pick the split point by accumulating line heights until the avatar's top is reached.
- This still exercises the library and still produces a cleaner wrap than CSS alone.

Document which path you took in your reporting section.

## Constraints

- Do not modify [src/viewer.js](../../src/viewer.js), [src/app.js](../../src/app.js), or the `<model-viewer>` element attributes.
- Do not change the title, chip, CTAs, or proof-list — only the subtitle is re-laid.
- No new deps.
- No changes to the grid columns in `.hero` — the avatar keeps its current position.
- Scoped to `features.*` and `src/features/`. No other files.

## Verification

1. `node --check src/features/hero-pretext.js`.
2. `npx vite build` completes.
3. Dev server, `/features?pretext=2` — subtitle lines visibly stagger around the avatar; no visual regressions in title or CTAs.
4. Resize the window between 1440px → 768px → 1440px — wrap recomputes correctly; mobile breakpoint (below 768px, single column) must disable the overlay and fall back to the plain subtitle.
5. DevTools Performance — no long tasks >50ms triggered by resize.
6. Throw manually (e.g. `throw new Error('test')` at the start of `enableStaticWrap`) — page still renders with the plain subtitle.

## Scope boundaries — do NOT do these

- Do not add cursor tracking. That is [task 03](./03-gaze-follow.md).
- Do not add per-frame reflow. That is [task 04](./04-dragon-mode.md).
- Do not re-lay the title or any other element.
- Do not project the actual GLB silhouette — a bounding circle is enough.
- Do not change the hero CSS grid columns.

## Reporting

- Which API path you used (per-line exclusion vs. two-band fallback).
- The exact Pretext functions called and their signatures as observed.
- Measured resize cost (ms) from DevTools.
- Any visual gotchas (subpixel rounding, font metrics mismatch) and how you resolved them.
- A short note on readability — did the wrap help or hurt comprehension? If it hurt, flag it for design review.
