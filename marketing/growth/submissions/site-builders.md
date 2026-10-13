# Site-builder submissions: WordPress, Framer, Webflow

Targets: [WordPress.org plugin directory](https://wordpress.org/plugins/developers/add/),
[Framer Marketplace](https://www.framer.com/marketplace/), and the
[Webflow Apps marketplace](https://developers.webflow.com/apps/docs) (Code Components library
distribution via `webflow devlink import`).

Ready for owner order 938. Built and tested end to end in work order 094; each submission needs
a third-party account only the owner can create (a WordPress.org SVN account, a Framer account,
and a Webflow account), so creating the account and submitting are owner actions (CLAUDE.md
gate 2 and the "Never blocked" rule for a step that needs a third-party account). This Evolve
session confirmed no such accounts are referenced anywhere in this repository's env or config.

## What ships

- [`integrations/wordpress/three-ws-agent/`](../../../integrations/wordpress/three-ws-agent): a
  Gutenberg block (`three-ws/agent-3d`, server-rendered via `ServerSideRender` so the editor
  preview matches the front end exactly) and a `[three_ws_agent]` shortcode for the classic
  editor, widgets, and theme templates. Verified against a real local WordPress 7.1.3 in Docker:
  the official Plugin Check plugin reports "No errors found" (`scripts/wordpress-plugin-check.sh`).
  A `readme.txt` in the plugin directory's required format ships alongside the Markdown README.
- [`integrations/framer/`](../../../integrations/framer): a code component (`Agent3D.tsx` wraps
  the Framer-free `Agent3DView.tsx` with `addPropertyControls`) exposing On-chain URI, Agent ID,
  Chain ID, Model URL, Background, Framing, Poster and Autoplay. Verified in a real-React test
  harness (no Framer account exists in this environment) that boots a live WebGL canvas against
  the production CDN release: `npx playwright test tests/e2e/agent-3d-framer-component.spec.js`.
- [`integrations/webflow/`](../../../integrations/webflow): a Code Component
  (`Agent3D.webflow.tsx` wraps the same `Agent3DView.tsx` contract with `declareComponent`/
  `@webflow/data-types` props) exposing the same eight props. Verified two ways: the real,
  unmodified Webflow CLI (`npx webflow devlink bundle --no-input`, "Code Library bundled
  successfully!") and the same real-React harness pattern
  (`npx playwright test tests/e2e/agent-3d-webflow-component.spec.js`).
- Shared release pin: [`scripts/build-site-builder-embeds.mjs`](../../../scripts/build-site-builder-embeds.mjs)
  writes each package's `pinned-release.{php,ts}` from
  [`data/agent-3d-releases.json`](../../../data/agent-3d-releases.json);
  [`scripts/check-site-builder-embeds.mjs`](../../../scripts/check-site-builder-embeds.mjs) (in
  `npm run gate`) fails the build if any of the three drifts from the ledger.
- Docs: [`docs/wordpress-embed.md`](../../../docs/wordpress-embed.md),
  [`docs/embedding.md`](../../../docs/embedding.md#framework-integration). Changelog,
  `data/pages.json`, and `STRUCTURE.md` wired.

## WordPress.org plugin directory

### Step 1: create an SVN-enabled WordPress.org account

Go to <https://wordpress.org/plugins/developers/add/> and sign in with (or create) a
WordPress.org account.

### Step 2: submit for review

1. Click **Add your plugin**, upload a zip of
   `integrations/wordpress/three-ws-agent/` (the directory as-is: `three-ws-agent.php`,
   `readme.txt`, `includes/`, `blocks/`), and submit.
2. The review team replies by email, usually within a few weeks, either approving (with SVN
   repository access) or requesting changes. `readme.txt` already follows the directory's
   required header/sections format (`Stable tag`, `Requires at least`, `Tested up to`, `License:
   GPLv2 or later`); if the reviewer flags anything plugin-specific, fix it in
   `integrations/wordpress/three-ws-agent/` and re-run `scripts/wordpress-plugin-check.sh` before
   replying.
3. Once approved, check out the assigned SVN repository and copy this plugin's files into
   `trunk/`, then `svn commit` and tag the release (`tags/<version>/`). Note: this SVN commit is
   itself publishing to an external channel (CLAUDE.md gate 2); do it only after the owner has
   reviewed the approval email.

**Listing copy** (for the plugin's description, drawn from `readme.txt`):

> **Name:** three.ws Agent
>
> **Short description:** Embed a live, animated 3D AI agent (Three.js, voice I/O, an LLM brain)
> anywhere on your site with a block or shortcode. No build step.
>
> **Tags:** 3d, avatar, agent, ai, embed, webgl, three.js

## Framer Marketplace

### Step 1: create a Framer account and a plugin project

1. Sign up at <https://www.framer.com> if the owner does not already have an account.
2. Create a new Framer project to host the code component (the Marketplace submission flow runs
   from inside a Framer project's plugin/component settings, not a standalone upload form).

### Step 2: add the component and test inside Framer

1. Open the project's code file panel, create three files named exactly
   `pinned-release.ts`, `Agent3DView.tsx`, and `Agent3D.tsx`, and paste in the matching file from
   `integrations/framer/src/`.
2. Drag the "three.ws Agent" component onto the canvas, set a Model URL (e.g.
   `https://three.ws/avatars/default.glb`), and confirm it renders inside Framer's own canvas.
   This is the real-tool verification the Definition of Done asks for beyond this session's
   harness; it needs the Framer account above and cannot run in this sandbox.

### Step 3: submit to the Marketplace

Follow Framer's **Submit to Marketplace** flow from the project's plugin settings. Suggested
listing copy:

> **Name:** three.ws Agent
>
> **Tagline:** A live, animated 3D AI agent in one component.
>
> **Description:** Drop a real Three.js-rendered agent into any Framer site: voice input and
> output, an LLM brain and memory, idle and talk animation, all driven by one component with
> On-chain URI, Agent ID, Model URL, Background, Framing, Poster and Autoplay controls. No API
> key required for a public agent or a bare model URL.
>
> **Category:** Embeds / 3D

## Webflow Apps marketplace

### Step 1: create a Webflow account and authenticate the CLI

```bash
cd integrations/webflow
npx webflow auth login
```

This opens a browser to authorize the CLI against a Webflow account (create one at
<https://webflow.com> first if the owner does not already have one).

### Step 2: publish the library to a Workspace

```bash
npx webflow devlink import
```

This publishes `integrations/webflow/`'s bundled Code Components library (built by `devlink
bundle`, already verified in this session) into the authenticated account's Webflow Workspace,
making "three.ws Agent" draggable from the Components panel in any site in that Workspace. This
is the real-tool verification beyond this session's local `devlink bundle` check; it needs the
Webflow account above and cannot run in this sandbox.

### Step 3: list on the Webflow Apps marketplace

Follow Webflow's app submission flow at <https://developers.webflow.com/apps/docs> for a Code
Components library. Suggested listing copy:

> **Name:** three.ws Agent
>
> **Tagline:** A live, animated 3D AI agent, dragged straight into the Designer.
>
> **Description:** Embed a real Three.js-rendered AI agent anywhere on a Webflow site: voice
> input and output, an LLM brain and memory, idle and talk animation. Set an On-chain URI, Agent
> ID, or Model URL, then pick a Background, Framing, Poster and Autoplay in the Properties panel,
> no custom code needed.
>
> **Category:** 3D & animation

## Verification packet

- Source: this repository, `integrations/wordpress/three-ws-agent/`, `integrations/framer/`,
  `integrations/webflow/`.
- WordPress: real Plugin Check run against a real local WordPress 7.1.3 in Docker, reproduced in
  [`docs/wordpress-embed.md`](../../../docs/wordpress-embed.md): "Checks complete. No errors found."
- Framer and Webflow: real-React Playwright harnesses booting a live WebGL canvas against the
  real, pinned, production `agent-3d.js` CDN release and a real production avatar GLB (no mocks,
  no network interception). Webflow additionally compiles through the real, unmodified
  `@webflow/webflow-cli`'s `devlink bundle` command.
- `npm run check:rules` passes on every touched file; `npm test` and `npm run audit:docs` pass
  with no new findings (see work order 094's final report).

## Owner steps (not automatable here)

1. Create (or reuse) a WordPress.org account, submit the plugin zip for review, and commit the
   approved files to the assigned SVN repository once approved (WordPress Step 1-2).
2. Create (or reuse) a Framer account, paste the three component files into a Framer project,
   confirm the component renders in Framer's own canvas, and submit to the Marketplace with the
   listing copy above (Framer Step 1-3).
3. Create (or reuse) a Webflow account, run `webflow auth login` and `webflow devlink import`
   from `integrations/webflow/`, confirm the component drags into the Designer, and submit to
   the Apps marketplace with the listing copy above (Webflow Step 1-3).
