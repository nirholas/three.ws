# 11 — Thought bubble adaptation for light background

## Status
Gap — when `background="light"` is set, the canvas is white and the thought bubble (white background, dark text) becomes nearly invisible.

## File
`src/element.js` — `BASE_STYLE`

## What to add

Add a host selector override for light background:
```css
:host([background="light"]) {
    --agent-bubble-bg: rgba(30, 30, 50, 0.92);
    --agent-bubble-color: #f9fafb;
}
```

This inverts the bubble to dark when the canvas is light, matching the existing pattern where `.name-plate` gets different colors for light background.

If prompt 10 (CSS custom properties) is done first, this is two lines. If not, directly override `.thought-bubble` inside the host selector:
```css
:host([background="light"]) .thought-bubble {
    background: rgba(30, 30, 50, 0.92);
    color: #f9fafb;
}
:host([background="light"]) .thought-bubble::after {
    border-top-color: rgba(30, 30, 50, 0.92);
}
:host([background="light"]) .thought-bubble .text {
    color: #f9fafb;
}
:host([background="light"]) .thought-bubble .dot {
    background: #f9fafb;
}
```

## Verification
Add `background="light"` to the element. Send a message. Bubble should be dark with light text.
