# three.ws Agent (Framer code component)

A Framer code component that embeds [`<agent-3d>`](../../docs/web-component.md): a live, animated
3D AI agent in one script tag. No build step beyond Framer's own canvas bundler.

## Layout

| File | Role |
|---|---|
| [`src/pinned-release.ts`](src/pinned-release.ts) | **Generated.** The `<agent-3d>` version, CDN URL and SRI hash this component ships against. Run `npm run build:site-builder-embeds` from the repo root to regenerate after a new `npm run release:lib`. Never edit by hand. |
| [`src/Agent3DView.tsx`](src/Agent3DView.tsx) | The actual rendering logic: loads the pinned CDN script once per page, mounts `<agent-3d>`, and drives its attributes from props. Deliberately has no `"framer"` import, so it can be rendered and tested with plain React outside Framer's canvas. |
| [`src/Agent3D.tsx`](src/Agent3D.tsx) | The Framer-specific wrapper: `addPropertyControls()` over `Agent3DView`, exposing On-chain URI, Agent ID, Chain ID, Model URL, Background, Framing, Poster and Autoplay in the Properties panel. |

## Why split the component in two

The `framer` npm package (the one that exports `addPropertyControls`/`ControlType`) ships types
only; its import only resolves inside Framer's own canvas bundler, never in Node, Vite, or
Playwright. Splitting the real rendering logic into `Agent3DView.tsx` (no `"framer"` import) means
that logic can be typechecked and rendered in a real browser outside Framer, while `Agent3D.tsx`
stays a thin wrapper that only Framer ever has to resolve.

## SRI pin

`src/pinned-release.ts` is one of three files [`scripts/build-site-builder-embeds.mjs`](../../scripts/build-site-builder-embeds.mjs)
writes from [`data/agent-3d-releases.json`](../../data/agent-3d-releases.json) (the other two are
the WordPress plugin's `pinned-release.php` and the Webflow component's `pinned-release.ts`).
`npm run check:site-builder-embeds` fails the build if any of the three has drifted from the
ledger; it is wired into `npm run gate`.

## Testing

```bash
# from the repo root
npm install --prefix integrations/framer   # once, or after a dependency change
npm run typecheck --prefix integrations/framer   # tsc --noEmit against the real "framer" types
npx playwright test tests/e2e/agent-3d-framer-component.spec.js
```

The Playwright spec starts this package's own `vite.config.mjs` (a standalone dev server; the
repo root's `vite.config.js` sets its own static-site JSX factory, which would break real React
JSX) and mounts the real `Agent3DView` with plain `ReactDOM` at
[`harness/index.html`](harness/index.html). It loads the real pinned CDN script from
`https://three.ws/<version>/agent-3d.js` and a real production avatar GLB (no mocks), and asserts
a WebGL canvas actually renders inside `<agent-3d>`'s shadow DOM.

## Using it in Framer

1. Open a Framer project, open the code file panel (or a Code Component file), and paste in
   `src/pinned-release.ts`, `src/Agent3DView.tsx`, and `src/Agent3D.tsx` (in that order, as three
   files of those names).
2. Drag the "three.ws Agent" component onto the canvas. Set an On-chain URI (`agent://base/42`),
   an Agent ID, or a Model URL in the Properties panel.
3. Pick a Background and Framing, and optionally a Poster image and Autoplay.

No three.ws account or API key is required to render a public agent or a bare model URL.

## Framer Marketplace submission

Submission (publishing under an owner-controlled Framer account) is an owner action: see
[`marketing/growth/submissions/site-builders.md`](../../marketing/growth/submissions/site-builders.md).
