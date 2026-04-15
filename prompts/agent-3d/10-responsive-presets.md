# Task 10 — Responsive size + position presets

## Context

Per [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) the element supports `responsive` attribute and promises CSS `clamp()`-based shrinking. The element currently honors explicit `width` / `height` attributes but has no responsive adaptation — a 420px bubble is 420px on both desktop and mobile, which is wrong on mobile.

The embed editor ([src/editor/embed-editor.js](../../src/editor/embed-editor.js)) should also let users pick from responsive presets and preview them at simulated viewport sizes before copying the snippet.

## Goal

Ship responsive dimensions: the element adapts sensibly to viewport width when `responsive` is on, and the editor gains device-preview toggles (Desktop / Tablet / Mobile) with corresponding preset sizes.

## Deliverable

1. **Element-level responsive** — [src/element.js](../../src/element.js):
	 - When `responsive` attribute is present (default on), compute `width` / `height` as `clamp(min, preferred, max)` values. Preferred is what the user set; min/max derive from that preferred.
	 - For `mode="floating"`, shrink to a pill (mic-only, chat collapsed) when viewport width < 480px. User can tap to expand.
	 - For `mode="inline"`, scale height proportionally to width so the avatar doesn't stretch.
	 - Use a `ResizeObserver` on `this` so the layout reacts to container size, not just viewport.
2. **Floating pill mode** — when collapsed on mobile:
	 - Shows only the poster image + a tap target.
	 - Expands to a bottom-sheet (full width, ~70vh) on tap, not the full floating rect.
	 - Closes to pill on outside tap or swipe-down.
3. **Editor device preview** — [src/editor/embed-editor.js](../../src/editor/embed-editor.js):
	 - Add a toolbar: `[ Desktop | Tablet | Mobile ]` above the stage. Each resizes the stage wrapper to 1440×900 / 768×1024 / 390×844 (iPhone 14) and shows the agent at the corresponding computed size.
	 - Add a "Responsive preset" selector: `[ Fixed | Mobile-first | Desktop-first ]` — each generates different `width`/`height`/`offset` CSS rules in the snippet output.
	 - Snippet output gains a commented block showing the computed CSS:
		 ```html
		 <!-- generated responsive styles -->
		 <agent-3d ... style="--agent-width: clamp(280px, 30vw, 420px); --agent-height: clamp(360px, 40vh, 560px);"></agent-3d>
		 ```

## Audit checklist

- [ ] On a 320px-wide viewport, a floating agent collapses to a pill without overflowing the screen.
- [ ] On a 1440px-wide viewport, the same config renders at the designer's preferred size.
- [ ] `ResizeObserver` handles container-level changes (e.g. sidebar opening) without a full remount.
- [ ] Inline mode preserves aspect ratio — setting `width="100%"` gives a height calculated from a 3:4 portrait default.
- [ ] The pill-expand transition is smooth (CSS transition, not a JS animation frame loop).
- [ ] `prefers-reduced-motion: reduce` disables the pill expand animation (instant swap).
- [ ] Editor preview exactly matches runtime behavior at each device breakpoint.
- [ ] Copy-to-clipboard snippet is actually responsive — pasted into a bare HTML page it works on both desktop and mobile.

## Constraints

- CSS-first. No per-frame layout JS.
- No new deps.
- Do not change the default `mode="inline"` — preserve current rendering for existing embeds.
- The pill must be keyboard-reachable (Enter/Space to expand) and have `aria-expanded`.

## Verification

1. `npm run build:all` passes.
2. Playwright or manual: load `examples/minimal.html` in Chrome DevTools device mode, cycle through iPhone 14 / iPad / Desktop 1440; confirm expected behavior at each.
3. Copy a snippet from the editor at mobile-first preset, paste into a scratch HTML, reload on iPhone simulator — confirm the pill UX.

## Scope boundaries — do NOT do these

- Do not add gesture-based dismiss (pinch, two-finger swipe) — single swipe-down is enough.
- Do not add tablet-specific layout variants — tablet uses the desktop layout.
- Do not auto-hide on scroll — the bubble stays anchored.
- Do not introduce breakpoints beyond mobile/desktop; tablet is a preview mode only.

## Reporting

- The exact clamp formula you shipped for floating / inline modes.
- Whether the ResizeObserver added measurable performance cost (should be ~0).
- Any case where `container queries` would be more appropriate than viewport media queries.
- UX feedback on whether the mobile pill feels right. If not, propose alternatives for a follow-up.
