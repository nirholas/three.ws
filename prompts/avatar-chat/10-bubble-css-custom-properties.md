# 10 — Thought bubble CSS custom properties

## Status
Enhancement — the thought bubble's visual appearance (background, text color, border radius, shadow) is hardcoded. Embedders need to be able to brand it.

## File
`src/element.js` — `BASE_STYLE`, `:host` block and `.thought-bubble` block

## What to add

Add to the `:host` CSS custom property block:
```css
:host {
    ...existing vars...
    --agent-bubble-bg: rgba(255, 255, 255, 0.95);
    --agent-bubble-color: #1a1a2e;
    --agent-bubble-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
    --agent-bubble-font-size: 13px;
}
```

Update `.thought-bubble` to consume them:
```css
.thought-bubble {
    background: var(--agent-bubble-bg);
    color: var(--agent-bubble-color);
    box-shadow: var(--agent-bubble-shadow);
    font-size: var(--agent-bubble-font-size);
    /* rest unchanged */
}
.thought-bubble::after {
    border-top-color: var(--agent-bubble-bg);
}
```

Update `.thought-bubble .text`:
```css
.thought-bubble .text {
    color: var(--agent-bubble-color);
}
```

## Embedder usage
```html
<agent-3d style="
    --agent-bubble-bg: rgba(30, 30, 50, 0.95);
    --agent-bubble-color: #ffffff;
" ...></agent-3d>
```

## Verification
Apply inline style overrides and confirm bubble color changes. The `::after` tail should match the bubble background.
