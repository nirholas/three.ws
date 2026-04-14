# Task: Add a Custom Element wrapper for the Viewer

## Context

Repo: `/workspaces/3D`. The current embed flow requires JavaScript:

```js
import { Viewer } from './viewer.js';
const viewer = new Viewer(document.getElementById('viewer'), options);
viewer.load(url, rootPath, assetMap);
```

Goal: allow a declarative one-line embed:

```html
<mv-viewer src="model.glb" auto-rotate exposure="1.2" environment="neutral"></mv-viewer>
```

This dramatically lowers the barrier to embedding the viewer on third-party pages, makes the API consumable from static HTML, and is the direct analogue of Google's `<model-viewer>`.

## Goal

Create a `HTMLElement` subclass that wraps `Viewer`, observes relevant attributes, and dispatches lifecycle events.

## Deliverable

1. New file `src/components/ModelViewerElement.js` exporting class `ModelViewerElement`.
2. Registration side-effect: `customElements.define('mv-viewer', ModelViewerElement)` — but guarded with `if (!customElements.get('mv-viewer'))`.
3. A small demo HTML page at `examples/web-component.html` (create the `examples/` folder) that shows the element in use with three variants: minimal, auto-rotating, with poster.
4. Updated [src/app.js](../../src/app.js) or a new entry to import the component module once, so the element registers. Do not remove existing drag-and-drop app behavior.

## Element name

Use `mv-viewer`. Do **not** use `model-viewer` — that's Google's element and taking their tag name in the same process would collide if their library is also loaded.

## Attributes to support (initial set)

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `src` | URL | — | glTF or GLB URL. Setting/changing triggers load. |
| `environment` | string | `"neutral"` | Matches `environments.js` IDs. |
| `exposure` | number | `1.0` | Renderer exposure. |
| `tone-mapping` | `"aces" \| "linear"` | `"aces"` | |
| `background-color` | CSS color | `"#191919"` (match existing default) | |
| `auto-rotate` | boolean attr | off | Presence-toggle. |
| `camera-controls` | boolean attr | **on** | Enable OrbitControls. |
| `reveal` | `"auto" \| "interaction"` | `"auto"` | `"interaction"` defers GLB fetch until first click or pointer enter. |
| `poster` | URL | — | Image shown before reveal. |
| `disable-zoom` | boolean attr | off | |
| `disable-pan` | boolean attr | off | |

Implement `observedAttributes` and `attributeChangedCallback` for all of these.

## Events to dispatch

Bubbling, composed `CustomEvent`s on the element:

- `load` — `detail: { src }` once the model finishes loading.
- `progress` — `detail: { loaded, total, src }` during load.
- `error` — `detail: { error, src }` on load failure.
- `camera-change` — fires on OrbitControls `change`. Throttle to animation frame.
- `ar-status` — **skip for now**; AR is a separate task.

## Lifecycle

**`connectedCallback`:**
- Create a light-DOM `<div class="mv-viewer__stage">` sized to fill the element.
- Instantiate `new Viewer(stageEl, opts)` where `opts` is derived from current attributes.
- If `reveal === "interaction"`, do **not** call `viewer.load` yet. Show the poster (if any) or an empty stage. Attach a one-shot click/pointerenter listener that removes the poster and calls `viewer.load(src)`.
- Otherwise, call `viewer.load(src)` immediately (if `src` is set).
- Wire viewer events → element events.

**`disconnectedCallback`:**
- Call `viewer.dispose()` (**depends on [01-dispose.md](./01-dispose.md)** shipping first).
- Null out references.
- Disconnect any observers created by the element.

**`attributeChangedCallback(name, old, next)`:**
- If the viewer hasn't been created yet (element not yet connected), stash the change on a pending-options object.
- Otherwise, translate to a `viewer.*` method call:
  - `src` → `viewer.clear(); viewer.load(next, '', new Map())`
  - `environment` → `viewer.state.environment = …; viewer.updateEnvironment(); viewer.invalidate?.()`
  - `exposure` → `viewer.renderer.toneMappingExposure = Number(next); viewer.invalidate?.()`
  - `tone-mapping` → map to three.js constants (`ACESFilmicToneMapping` | `LinearToneMapping`); `viewer.invalidate?.()`
  - `background-color` → `viewer.state.bgColor = next; viewer.updateBackground(); viewer.invalidate?.()`
  - `auto-rotate` → `viewer.state.autoRotate = this.hasAttribute('auto-rotate'); viewer.controls.autoRotate = …; viewer.invalidate?.()`
  - `camera-controls` → `viewer.controls.enabled = this.hasAttribute('camera-controls')` (default true if unset)
  - `disable-zoom` → `viewer.controls.enableZoom = !this.hasAttribute('disable-zoom')`
  - `disable-pan` → `viewer.controls.enablePan = !this.hasAttribute('disable-pan')`
  - `reveal` / `poster` → only meaningful at connect time; ignore runtime changes, or log a warning.

> Several `viewer.invalidate?.()` calls above are hedged because [02-render-on-demand.md](./02-render-on-demand.md) hasn't shipped yet. The optional-chaining means this code works both before and after that lands.

## Poster behavior

- If `poster` attr is set, render it as an `<img>` absolutely positioned over the stage, `object-fit: cover`.
- If `reveal="auto"`, fade out the poster once the viewer fires its first render or `load` event.
- If `reveal="interaction"`, the poster stays until the user interacts, then removes.

Keep this simple — a CSS fade is fine. No animation library.

## Styling

The element defines its own size via CSS. Default stylesheet, inlined into the element via a scoped `<style>` tag appended once to `document.head`:

```css
mv-viewer { display: block; position: relative; width: 100%; height: 480px; background: #191919; }
mv-viewer .mv-viewer__stage { width: 100%; height: 100%; }
mv-viewer .mv-viewer__poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity .3s; }
mv-viewer .mv-viewer__poster[data-hidden] { opacity: 0; pointer-events: none; }
```

Do not use Shadow DOM. Light DOM is simpler for this case and integrates with the site's CSS.

## Constraints

- No new dependencies.
- No breaking change to the existing `Viewer` class API.
- The element must work without `dispose()` (task 01), degrading to "disconnecting leaks resources" — just log a warning in that case.
- The element must work without `invalidate()` (task 02), degrading to continuous render — the `viewer.invalidate?.()` optional-chains handle this.

## Verification

1. `node --check src/components/ModelViewerElement.js`.
2. Open `examples/web-component.html` in a browser (via `npx vite --port 3000` with the example added to the Vite entry or served as a static file).
3. Test each variant:
   - Minimal `<mv-viewer src="sample.glb">` loads and renders.
   - `auto-rotate` attribute → model rotates. Remove attribute → stops.
   - `reveal="interaction"` + `poster` → poster visible; click → poster fades, model loads.
   - Change `exposure` attribute from DevTools → lighting updates immediately.
4. Confirm events fire: attach `el.addEventListener('load', …)` in the demo and log.
5. Remove the element from the DOM (`el.remove()`) → no uncaught errors.

## Scope boundaries — do NOT do these

- Do not implement AR. That's its own task.
- Do not implement hotspots/slotted-annotations. Current annotation system is auto-generated; keep it as-is.
- Do not refactor viewer.js into modules (that's task 03) beyond what's needed here.
- Do not implement shared renderer pooling.
- Do not add TypeScript types.

## Reporting

- File list created/modified.
- Attributes supported and any you chose to defer.
- Events dispatched and their payloads.
- Any decisions that diverged from this spec and why.
