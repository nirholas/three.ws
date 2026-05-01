# 49 — CSS will-change for animated elements

## Status
Performance — the thought bubble animates `opacity` and `transform` frequently. Adding `will-change` hints to the browser promotes these elements to their own compositor layer, reducing main-thread paint work during animation.

## File
`src/element.js` — `BASE_STYLE`

## What to add

```css
.thought-bubble {
    will-change: opacity, transform;
    ...
}

.thought-bubble .dot {
    will-change: transform, opacity;
}
```

## Important caveats

`will-change` should NOT be applied to elements that are always present but rarely animated. The thought bubble is hidden (opacity: 0) most of the time — promoting it permanently wastes GPU memory.

Better pattern: add `will-change` only when animation is about to start, and remove it after:

```js
// In _streamToBubble / before bubble becomes active:
if (this._thoughtBubbleEl) {
    this._thoughtBubbleEl.style.willChange = 'opacity, transform';
}

// In _clearThoughtBubble, after the hide transition completes:
setTimeout(() => {
    if (this._thoughtBubbleEl) {
        this._thoughtBubbleEl.style.willChange = 'auto';
    }
}, 300); // match the transition duration
```

Apply the same pattern to the walk animation — Three.js handles its own GPU layers so no action needed there.

## What NOT to do

Do not add `will-change` to `.chrome`, `.chat`, or `.avatar-anchor` — these are not animated and adding `will-change` would waste resources.

## Verification
Open Chrome DevTools → Rendering → Paint flashing. Send a message. The thought bubble should not cause green paint flashes on the surrounding page elements. Only the bubble itself should repaint.
