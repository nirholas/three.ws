# Fix `<agent-3d>` boot race in attributeChangedCallback

## Symptom

```
agent-3d.js:68935 [agent-3d] boot failed
TypeError: Cannot set properties of undefined (setting 'hidden')
    at HTMLElement._boot (agent-3d.js:68795:32)
    at HTMLElement.attributeChangedCallback (agent-3d.js:68591:14)
    at agent-3d.js:69344:50
```

## Cause

`attributeChangedCallback` fires before the element's internal DOM is initialized (i.e. before `connectedCallback` finishes / before `_boot` has assigned the referenced child). When `_boot` tries to set `.hidden` on that not-yet-created element, it throws.

## Task

In the `<agent-3d>` custom element source (compiled into `agent-3d.js`, source likely under [src/](../../src/) — check [src/element.js](../../src/element.js) and [src/agent-resolver.js](../../src/agent-resolver.js)):

1. Add a readiness guard. Either:
   - Defer `_boot` work until after `connectedCallback`, OR
   - In `attributeChangedCallback`, queue attribute changes and replay them once `_boot` has initialized the DOM, OR
   - Null-check the target element before setting `.hidden`.
2. Initialize the target element reference in the constructor or at the top of `_boot` *before* any attribute-driven mutation runs.
3. Add a regression test that constructs the element with attributes pre-set in HTML (so `attributeChangedCallback` runs before `connectedCallback`) and asserts no throw.

## Acceptance

- No `Cannot set properties of undefined (setting 'hidden')` error when loading `https://three.ws/chat`.
- `_boot` completes for an `<agent-3d agent-id="…">` placed in static HTML.
