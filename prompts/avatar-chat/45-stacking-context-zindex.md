# 45 — Stacking context: thought bubble z-index in floating and embedded contexts

## Status
Layout bug risk — the thought bubble uses `z-index: 4`. In shadow DOM this is scoped to the shadow tree, so it doesn't leak. But in floating mode (`z-index: 2147483000` on the host), any child element with its own stacking context could stack incorrectly.

## File
`src/element.js` — `BASE_STYLE`

## What to verify

### Shadow DOM z-index scoping
Inside the shadow DOM, z-index values only compete with siblings. The current stacking order from bottom to top:
1. `.stage` (canvas) — `position: absolute; inset: 0` — z-index auto
2. `.poster` — `position: absolute; inset: 0` — z-index auto
3. `.chrome` — `position: absolute; inset: 0` — z-index auto
   - `.chat` — in flow
   - `.avatar-anchor` — in flow
     - `.thought-bubble` — `position: absolute; z-index: 4`
   - `.input-row` — in flow
4. `.tool-indicator` — `position: absolute; z-index: 3`
5. `.alert-banner` — `position: absolute; z-index: 3`
6. `.drag-handle` — `position: absolute; z-index: 15`
7. `.pill-btn` — `position: absolute; z-index: 10`

**Issue**: `.tool-indicator` and `.alert-banner` are `z-index: 3`. The thought bubble is `z-index: 4`. But `.tool-indicator` is positioned relative to the shadow root (not inside `.avatar-anchor`), so it participates in the same stacking context as `.thought-bubble`. The bubble correctly appears above the tool indicator. ✅

**Issue**: `.drag-handle` is `z-index: 15` and covers the top of the element in floating mode. The thought bubble is `z-index: 4`. If the bubble tracked the head up near the drag handle area, it would be hidden behind it. Fix:
```css
.thought-bubble { z-index: 16; } /* above drag handle */
```

### backdrop-filter and stacking contexts
`.chat` uses `backdrop-filter: blur(12px)`. This creates a new stacking context. Since `.thought-bubble` is NOT a child of `.chat`, it is not affected. ✅

### iframe embedding
When the element is inside an iframe, the shadow DOM z-index is scoped to the iframe's document. No issues.

## What to change

Update `.thought-bubble` z-index from 4 to 16 to ensure it always renders above the drag handle:
```css
.thought-bubble {
    ...
    z-index: 16;
}
```

## Verification
In floating mode with the drag handle visible, trigger a thought bubble. The bubble should appear above the drag handle, not behind it.
