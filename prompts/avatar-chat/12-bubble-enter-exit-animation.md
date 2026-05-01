# 12 — Thought bubble enter/exit animation (scale + fade)

## Status
Enhancement — the bubble currently appears/disappears with only an opacity transition (`transition: opacity 0.25s`). A subtle scale-up on enter and scale-down on exit makes it feel alive and natural.

## File
`src/element.js` — `BASE_STYLE`, `.thought-bubble` rule

## What to change

Replace the current transition with a combined opacity + transform transition and add `transform-origin`:

```css
.thought-bubble {
    ...existing styles...
    opacity: 0;
    transform: translateX(-50%) scale(0.85);
    transform-origin: center bottom;
    transition:
        opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
        transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.thought-bubble[data-active="true"] {
    opacity: 1;
    transform: translateX(-50%) scale(1);
}
```

The `cubic-bezier(0.34, 1.56, 0.64, 1)` is a "spring" curve — it slightly overshoots then settles. `transform-origin: center bottom` makes it feel like the bubble inflates upward from the tail toward the avatar's head.

## Note
The existing `transform: translateX(-50%)` on `.thought-bubble` must be merged into the transition states — otherwise `translateX(-50%)` and `scale()` fight each other. Both states above include `translateX(-50%)`.

## Verification
Send a message. Watch the bubble appear — it should scale up with a light spring overshoot. When it disappears it should scale back down simultaneously with fading out.
