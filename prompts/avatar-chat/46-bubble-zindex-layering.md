# 46 — Z-index layering: thought bubble above all UI elements

## Status
Gap — the thought bubble has `z-index: 4` (set in initial implementation). Other elements in the shadow DOM have various z-indices. Verify the bubble always renders on top of chat messages, tool indicators, and alert banners.

## File
`src/element.js` — `BASE_STYLE`

## Current z-index map

| Element | z-index |
|---|---|
| `.pill-btn` | 10 |
| `.pill-drag` | 20 |
| `.drag-handle` | 15 |
| `.alert-banner` | 3 |
| `.tool-indicator` | 3 |
| `.thought-bubble` | 4 |
| `.avatar-anchor` | (inherits, no z-index) |

## Issues to check

1. The `.thought-bubble` (z-index: 4) is inside `.avatar-anchor` which has `position: relative`. Z-index stacking contexts are scoped to positioned ancestors. Since `.chrome` has `position: absolute` (creating a stacking context), the bubble's z-index 4 competes within the chrome.

2. `.tool-indicator` is `position: absolute` on the shadow root (not inside .chrome). It has `z-index: 3`. If the thought bubble is inside .chrome and the tool indicator is a sibling of .chrome, they're in the same stacking context. Bubble at z-index 4 > tool indicator at z-index 3 — bubble wins. ✓

3. `.alert-banner` at z-index 3 — same analysis. ✓

4. `.pill-btn` at z-index 10 — this is higher than the bubble. But pill-btn is only visible when collapsed to pill. When expanded (the state where the bubble shows), pill-btn should be hidden. Verify this.

## What to fix

If layering issues are found visually:

```css
.thought-bubble {
    z-index: 10; /* raise above all chrome siblings */
}
.avatar-anchor {
    z-index: 2; /* establish stacking context so bubble z-index is scoped */
}
```

If `.avatar-anchor` needs `z-index` set, it also needs `position: relative` (already set) and an explicit z-index value.

## Verification
Trigger a thought bubble while also triggering the tool indicator. The bubble should render above the indicator. Trigger an alert banner — bubble should be above it.
