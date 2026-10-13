# three.ws Agent (Webflow Code Component)

A Webflow [Code Component](https://developers.webflow.com/designer/docs/code-components) that
embeds [`<agent-3d>`](../../docs/web-component.md): a live, animated 3D AI agent in one script
tag.

## Layout

| File | Role |
|---|---|
| [`webflow.json`](webflow.json) | The devlink library manifest (`library.id`, `library.name`, `library.description`). Components are auto-discovered by the CLI's default glob (`**/*.webflow.tsx`); no explicit file list needed. |
| [`src/pinned-release.ts`](src/pinned-release.ts) | **Generated.** The `<agent-3d>` version, CDN URL and SRI hash this component ships against. Run `npm run build:site-builder-embeds` from the repo root to regenerate after a new `npm run release:lib`. Never edit by hand. |
| [`src/Agent3DView.tsx`](src/Agent3DView.tsx) | The actual rendering logic: loads the pinned CDN script once per page, mounts `<agent-3d>`, and drives its attributes from props. Deliberately has no `"@webflow/react"` import, so it can be rendered and tested with plain React outside Webflow's runtime. |
| [`src/Agent3D.webflow.tsx`](src/Agent3D.webflow.tsx) | The Webflow-specific wrapper: `declareComponent()` over `Agent3DView`, with `props.Text`/`props.Variant`/`props.Image`/`props.Boolean` for On-chain URI, Agent ID, Chain ID, Model URL, Background, Framing, Poster and Autoplay. |

## Why split the component in two

`@webflow/react`'s `declareComponent` and `@webflow/data-types`'s `props` only resolve inside
Webflow's own devlink bundler/runtime. Splitting the real rendering logic into
`Agent3DView.tsx` (no Webflow import) means that logic can be typechecked and rendered in a real
browser outside Webflow, while `Agent3D.webflow.tsx` stays a thin wrapper that only Webflow's
bundler ever has to resolve.

## SRI pin

`src/pinned-release.ts` is one of three files [`scripts/build-site-builder-embeds.mjs`](../../scripts/build-site-builder-embeds.mjs)
writes from [`data/agent-3d-releases.json`](../../data/agent-3d-releases.json) (the other two are
the WordPress plugin's `pinned-release.php` and the Framer component's `pinned-release.ts`).
`npm run check:site-builder-embeds` fails the build if any of the three has drifted from the
ledger; it is wired into `npm run gate`.

## Testing

No Webflow account is needed to verify this component locally. `devlink bundle` is the real,
official Webflow CLI command for compiling a Code Components library for local development; it
reads `webflow.json`, discovers `src/Agent3D.webflow.tsx`, and bundles it with the real
`@webflow/react`/`@webflow/data-types` packages:

```bash
# from the repo root
npm install --prefix integrations/webflow   # once, or after a dependency change
npm run typecheck --prefix integrations/webflow
npx webflow devlink bundle --no-input --prefix integrations/webflow 2>/dev/null || (cd integrations/webflow && npx webflow devlink bundle --no-input)
npx playwright test tests/e2e/agent-3d-webflow-component.spec.js
```

`devlink bundle` prints "Code Library bundled successfully!" on success and writes the compiled
bundle to `integrations/webflow/dist/` (gitignored). The Playwright spec separately starts this
package's own `vite.config.mjs` (a standalone dev server; the repo root's `vite.config.js` sets
its own static-site JSX factory, which would break real React JSX) and mounts the real
`Agent3DView` with plain `ReactDOM` at [`harness/index.html`](harness/index.html), proving the
shared rendering logic actually boots a WebGL canvas inside `<agent-3d>`'s shadow DOM against the
real pinned CDN release and a real production avatar GLB (no mocks).

## Using it in Webflow

1. Run `npx webflow auth login` (owner account; see the submission doc below) from
   `integrations/webflow/`, then `npx webflow devlink import` to publish this library into a
   Webflow Workspace.
2. In the Webflow Designer, drag the "three.ws Agent" component from the Components panel onto
   the canvas. Set an On-chain URI (`agent://base/42`), an Agent ID, or a Model URL.
3. Pick a Background and Framing, and optionally a Poster image and Autoplay.

No three.ws account or API key is required to render a public agent or a bare model URL.

## Webflow account and marketplace listing

Logging into a Webflow account (`webflow auth login`) and publishing the library (`webflow
devlink import`) are owner actions: see
[`marketing/growth/submissions/site-builders.md`](../../marketing/growth/submissions/site-builders.md).
