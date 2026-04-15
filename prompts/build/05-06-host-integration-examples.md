# 05-06 — Host integration examples and docs

## Why it matters

The protocol (05-04) and gating (05-05) aren't real until a third-party developer can clone a working example in two minutes. The examples exist to be read — and to act as regression fixtures. They're also the artifact we link to from README, Twitter, and the Lobehub / Claude integration pitches.

## Context

- Existing examples: [examples/minimal.html](../../examples/minimal.html), [examples/web-component.html](../../examples/web-component.html), [examples/coach-leo/](../../examples/coach-leo/).
- Library build: `npm run build:lib` → `dist-lib/agent-3d.js`.
- Docs landing: [public/docs-widgets.html](../../public/docs-widgets.html).

## What to build

### 1. Vanilla HTML example — `examples/host-vanilla.html`

Single static file. Embeds the agent via `<agent-3d>`. Host-side buttons for:

- "Wave"
- "Speak custom text" (with a text input)
- "Nod / shake / think"

Each button posts the corresponding message per the 05-04 protocol. Console logs every inbound agent → host event. Include a comments block at the top explaining each integration point.

### 2. React example — `examples/host-react.tsx`

One-file example using a CDN React + ESM import of `agent-3d.js`. Functional component with `useEffect` that listens for `ready` and exposes `speak`, `wave`, `setMood` callbacks. No build step.

### 3. Claude Artifact example — `examples/host-claude-artifact.html`

Matches the constraints Claude's Artifact iframe imposes (no external scripts beyond what Claude's CSP allows, specific allow-list of origins). Demonstrates `speak` from an in-artifact button. Includes a top-comment linking to the Claude Artifact CSP docs.

### 4. Lobehub example — `examples/host-lobehub/`

A minimal plugin that wraps `<agent-3d>` for inline rendering in a Lobehub chat. Includes a README explaining how to drop it into the user's Lobehub fork. Uses the plugin manifest shape from `05-02-lobehub-plugin.md`.

### 5. Docs page — `public/docs-embed.html`

New static page linked from [public/docs-widgets.html](../../public/docs-widgets.html). Sections:

- Quickstart (web component + iframe).
- `postMessage` protocol reference (mirrors 05-04 spec table 1:1; auto-extract if feasible).
- Capability policy reference (mirrors 05-05).
- Copy-paste snippets for each example above.
- A live sandbox at the top with the vanilla HTML inline — editable textareas for text/animation.

Use existing dashboard styling tokens. No new dep. Monospace blocks use `<pre><code>`; copy buttons reuse 04-05's clipboard helper.

### 6. CI smoke fixture

Add a minimal puppeteer-or-playwright script at `examples/smoke.mjs` (zero-install — via `npx playwright-core` if we don't already have a test runner) that opens each example in a headless browser, sends a `speak` message, and asserts the agent emits `speaking_started`. Run manually for now, not in CI.

## Out of scope

- A full docs site (Docusaurus, etc.). Static HTML is enough.
- Video walkthroughs.
- SDK packages published to npm (that's a later artifact).

## Acceptance

1. Each example file opens locally (`open examples/host-vanilla.html`) and exercises the protocol without errors.
2. Docs page renders, with working copy buttons, on desktop and mobile.
3. Claude Artifact example passes Claude's CSP (verified by pasting into a throwaway Artifact).
4. Smoke fixture: running `node examples/smoke.mjs` exits 0 against a local dev server.
5. Links from the README to the docs page resolve.
