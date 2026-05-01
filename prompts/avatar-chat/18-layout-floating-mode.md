# 18 — Floating mode layout compatibility

## Status
Gap — the new vertical column chrome layout (`inset: 0`, `flex-direction: column`) needs to work correctly in floating mode. Floating mode has `border-radius`, `overflow: hidden`, and fixed `width`/`height` — the avatar anchor must fill the center correctly.

## File
`src/element.js` — `BASE_STYLE`

## What to verify and fix

Floating mode spec: `position: fixed; width: 320px; height: 420px; border-radius: 16px; overflow: hidden`.

The vertical chrome column should work as-is since it uses `inset: 0` to fill the host. But verify these specific issues:

### Issue 1 — Border radius clip
The chrome's children should not overflow the rounded corners. `overflow: hidden` on the host handles this, but the `padding: 12px` on `.chrome` must ensure the chat and input don't visually clip at corners.

Verify: In floating mode, the chat bubbles and input pill should have comfortable padding from the rounded corners. If not, increase padding to `14px` in floating mode:
```css
:host([mode="floating"]) .chrome {
    padding: 14px;
}
```

### Issue 2 — Avatar anchor height in small floating window
In a 420px tall floating window with 38% max chat + input (~44px) + 12px×2 padding = ~52px overhead, the avatar anchor gets roughly 420 - 44*0.38 - 44 - 24 ≈ 320px. This is fine for most models.

If the floating window is custom-sized smaller than 300px tall, the anchor may collapse. Add:
```css
:host([mode="floating"]) .avatar-anchor {
    min-height: 60px;
}
```

### Issue 3 — Drag handle overlap
The `.drag-handle` (top 24px, z-index 15) overlaps the top of the chrome. The chrome starts at `top: 0` (inset: 0). Add top padding in floating mode to clear the drag handle:
```css
:host([mode="floating"]) .chrome {
    padding-top: 28px; /* clear the 24px drag handle */
}
```

## Verification
Open floating mode (`mode="floating"`). Chat messages, avatar anchor, and input should all be correctly positioned within the rounded floating card. The drag handle should not overlap the chat.
