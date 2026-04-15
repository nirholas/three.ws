# Task 02 — Parameterized embed snippet generator

## Why this exists

The iframe snippet from task 01 is a good default but embedders want knobs — size, theme, autoplay, variant, camera. A tiny generator UI that mutates the snippet as they flip options costs little and prevents the most common "how do I make it bigger?" support thread.

## Files you own

- Edit: `src/agent-page/share-panel.js` from task 01 — add a "Customize" toggle under the iframe snippet.
- Create: `src/agent-page/embed-builder.js` — the builder logic (pure: inputs → snippet strings).
- Edit: `public/agent/embed.html` — accept the new query params defined here.

## Deliverable

### Supported params

| Param | Values | Default |
|---|---|---|
| `height` | `<css length>` | `480px` |
| `width` | `<css length>` | `100%` |
| `theme` | `light` / `dark` / `auto` | `auto` |
| `autoplay` | `0` / `1` | `1` |
| `rotate` | `0` / `1` | `1` |
| `bg` | `transparent` / `solid` / `gradient` | `transparent` |
| `variant` | `<slug>` | — |
| `camera` | `"20deg 68deg 3.4m"` etc. | — |

The embed page honors these by setting `<model-viewer>` attributes. CSS-injected values are validated with `safeCssValue` / `safeCssLength` helpers that already exist in `api/mcp.js` — lift them into a shared module `src/shared/safe-css.js` that both files import.

### Builder UI

Inline under the snippet: labeled inputs for each param. As the user flips them, the snippet above updates live. No save button — copy pulls the current state.

### Snippet formats

Offer three:
1. **iframe** — the default.
2. **Web component** — `<script src=".../agent-3d.js" />` + `<agent-3d id="…" height="…" …>`.
3. **oEmbed URL** — a link embedders paste into platforms that auto-resolve oEmbed (Slack, Notion, etc.).

## Constraints

- All attribute values are sanitized server-side too. Never trust the param dictionary.
- `theme=dark` sets a dark background AND a neutral environment map lighting if the model-viewer supports it; `auto` reads `prefers-color-scheme` from the embedder's frame context.
- Do not add analytics that fire per-embed-view. That belongs in a separate opt-in task.

## Acceptance test

1. Flip each control → snippet text updates in <16ms.
2. Copy an iframe with `height=600px&theme=dark` → paste into blank HTML → renders with those settings.
3. `oEmbed` URL, when fetched, returns valid oEmbed JSON for the customized view (if the oEmbed endpoint is wired).
4. Invalid values (e.g. `height=1;drop table users`) are rejected client and server side.

## Reporting

- Which params ended up validated where (client vs server).
- Any `<model-viewer>` attributes that silently no-op so we can set user expectations.
