# 33 — Thought bubble tail direction: point toward avatar head

## Status
Enhancement — the thought bubble `::after` pseudo-element creates a downward-pointing triangle (`border-top` = solid). This assumes the bubble is always above the avatar's head, which is the default. But if the avatar is very tall or the camera is angled, the bubble may appear below or beside the head and the tail points wrong.

## File
`src/element.js` — `BASE_STYLE`, `_updateBubblePosition()` (from prompt 13)

## What to do

If prompt 13 (head tracking) is implemented: once we know the bubble's position relative to the head, determine whether the bubble is above or below the head, and dynamically set a data attribute:

```js
// In _updateBubblePosition():
const bubbleBottom = relY + this._thoughtBubbleEl.offsetHeight;
const isAbove = relY < pos.y; // bubble top is above head
this._thoughtBubbleEl.dataset.tailDir = isAbove ? 'down' : 'up';
```

CSS:
```css
/* Default (bubble above head): tail points down */
.thought-bubble::after {
    content: '';
    position: absolute;
    bottom: -8px;
    top: auto;
    left: 50%;
    transform: translateX(-50%);
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-top: 8px solid var(--agent-bubble-bg, rgba(255,255,255,0.95));
    border-bottom: none;
}

/* Bubble below head: tail points up */
.thought-bubble[data-tail-dir="up"]::after {
    bottom: auto;
    top: -8px;
    border-top: none;
    border-bottom: 8px solid var(--agent-bubble-bg, rgba(255,255,255,0.95));
}
```

If prompt 13 is NOT implemented (fixed position): keep the default downward tail as-is. The fixed `top: 12%` positioning means the bubble is almost always above the head for typical humanoid models in the anchor window.

## Verification
With head tracking active, test with a model where the avatar's head is near the bottom of the anchor window. The tail should point up when the bubble appears below the head.
