# 19 — Mobile pill mode compatibility

## Status
Gap — on narrow viewports (< 500px), floating mode collapses to a 56×56px pill. When expanded, it becomes a bottom-sheet. The vertical chrome column must work in both collapsed and expanded states.

## File
`src/element.js` — `BASE_STYLE`, pill expand/collapse logic

## What to verify

### Pill state (56×56px)
When `this._pillActive = true`, the element is tiny. The chrome (`inset: 0`) tries to render inside 56px × 56px. This is fine because `.chat:empty { display: none }` hides the chat, and the `.avatar-anchor` and `.input-row` will be hidden by the pill overflow.

Verify: add `overflow: hidden` check — it should already be inherited from the floating `overflow: hidden`. If not:
```css
:host([data-pill="true"]) .chrome { display: none; }
```

Check whether the pill state uses `data-pill` or class. Look at `_collapsePill()` and `_expandPill()` in element.js for the actual attribute/class toggled.

### Expanded bottom-sheet state
When expanded from pill, the element stretches to the bottom sheet size. The chrome column must fill this correctly.

The chat should show at the top of the sheet, avatar anchor in the middle, input at the bottom. This is the default behavior of the vertical column — should work without changes.

### Swipe handle
The `.pill-drag` element is at `top: 8px`. Add padding to match floating mode fix from prompt 18:
```css
:host([mode="floating"][data-expanded]) .chrome {
    padding-top: 20px;
}
```

(Check the exact attribute set on the host when the pill is expanded — it may be a class or data attribute.)

## Verification
On a mobile viewport (375px wide), open the floating agent. Collapse to pill — chrome should be hidden. Expand — chrome column should appear correctly with chat, avatar window, and input.
