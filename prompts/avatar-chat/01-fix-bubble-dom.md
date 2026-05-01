# 01 — Fix thought bubble DOM: add `.text` span

## Status
Bug — code calls `thoughtBubble.querySelector('.text')` and stores it as `this._thoughtTextEl`, but the innerHTML only creates three `.dot` spans. The text span is missing so streaming text never appears.

## File
`src/element.js` — `_renderShell()` around line 593

## Current code
```js
thoughtBubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
```

## Fix
```js
thoughtBubble.innerHTML =
    '<span class="text"></span>' +
    '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
```

The `.text` span must come first so flex layout renders text before dots. The CSS rules `.thought-bubble[data-streaming="true"] .text { display: block; }` and `.thought-bubble[data-streaming="true"] .dot { display: none; }` already toggle between modes correctly — this just adds the missing element.

## Verification
After the fix, open the app, send a message, and confirm the thought bubble shows streaming words rather than staying empty.
