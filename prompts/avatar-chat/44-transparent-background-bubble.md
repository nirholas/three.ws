# 44 — Transparent background: thought bubble visibility

## Status
Gap — when `background="transparent"` (the default), the canvas composites over the host page background. The white thought bubble is visible but may clash with a white page background — it becomes invisible. Also, the `.chat` and `.input-row` are `rgba(17, 24, 39, 0.92)` dark glass, which may not suit a light host page.

## File
`src/element.js` — `BASE_STYLE`

## What to do

### Thought bubble on transparent background

The bubble already has `box-shadow: 0 4px 24px rgba(0,0,0,0.25)` which creates a drop shadow separating it from a white background. But the border could be more visible:

```css
:host([background="transparent"]) .thought-bubble {
    border: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.12);
}
```

This subtle border ensures the white bubble is always discernible against both white and dark host pages.

### Chat panel on transparent background

When the host page is light and `background="transparent"`, the dark chat glass panel may look out of place. Expose a CSS variable for embedders to override:

```css
:host {
    --agent-surface: rgba(17, 24, 39, 0.92);
    ...
}
```

Already done (it's a custom property). Document in EMBED_SPEC that embedders should set `--agent-surface` to match their page theme when using `background="transparent"`.

No code change needed — just add a note to prompt 26 (EMBED_SPEC docs) to mention this variable.

### Dot color on transparent

On a dark host page, the blue dots (`background: var(--agent-accent)`) are visible. On a light page, they're also fine. No change needed.

## Verification
Embed the element on a white page with `background="transparent"`. The thought bubble should be visually distinct from the page background via shadow + border. On a dark page it should still look clean.
