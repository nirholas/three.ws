# Task: Ship the minimal Claude Artifact HTML snippet

## Context

Repo: `/workspaces/3D`. Claude.ai's **Artifacts** feature renders HTML/JS content in a sandboxed iframe. We want a Claude user to paste **one small HTML snippet** into a Claude chat, open it as an Artifact, and immediately see a live embodied agent avatar — fetched by `agentId`.

Relevant existing files:

- [../../public/agent/embed.html](../../public/agent/embed.html) — our current iframe embed. It imports from `/src/...` via ES modules served from our origin. An Artifact can't do that — it runs on Claude's origin and has to load everything over public URLs.
- [../../src/element.js](../../src/element.js) — the `<agent-3d>` web component. Currently ships as part of the Vite build; not CDN-ready as-is.
- [../../src/agent-avatar.js](../../src/agent-avatar.js) — the Empathy Layer. Must run inside the Artifact.
- [../../src/agent-protocol.js](../../src/agent-protocol.js) — event bus the avatar subscribes to.
- [../../public/embed.js](../../public/embed.js) — our existing script-tag embed for widgets (reference for how we bootstrap into an iframe).
- [../lobehub-embed/](../lobehub-embed/) — sibling priority-5 directory for the LobeHub side of the same integration story.

The snippet in this task is a thin HTML wrapper. The JS payload lives in the bundle produced by [./02-zero-dep-viewer-bundle.md](./02-zero-dep-viewer-bundle.md).

## Goal

Create a copy-pasteable HTML template, &lt;2 KB, that a Claude user drops into chat as an `html` Artifact. Opening the Artifact fetches `agentId` via our public API, loads the avatar GLB, and renders a breathing embodied avatar with the Empathy Layer running idle. No user interaction required.

## Deliverable

1. **File created** — `public/artifact/index.html`. This is both the documentation of the snippet and a working preview page when hit directly. Contents are the snippet verbatim, wrapped only in enough surrounding `<html><body>` to render standalone.
2. **File created** — `public/artifact/snippet.html`. The *exact* string users copy/paste. Minified where safe. Ends with a comment naming the project and version.
3. **File created** — `prompts/claude-artifact/TESTED-SNIPPET.md` (NOT a codebase doc — it lives in this prompts dir only) — the verbatim snippet that was tested in a real Claude Artifact, plus a note on the date tested and the Claude model used.
4. **Edit** — add a "Claude Artifact" tab to the share panel on [public/agent/index.html](../../public/agent/index.html) next to the existing iframe/link/`<agent-3d>` tabs, exposing a copy button that yields the snippet from `snippet.html` with `agentId` substituted in.

## Required shape of the snippet

```html
<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#0b0d10">
<div id="a" style="width:100%;height:100vh"></div>
<script src="https://3dagent.vercel.app/artifact.js"></script>
<script>
  Agent3D.mount('#a', { agentId: 'AGENT_ID_HERE' });
</script>
</body></html>
```

- Background is a reasonable default (dark). The user can change it.
- `#a` fills the artifact viewport — Claude Artifacts vary in size; no fixed px.
- `Agent3D` is the global exposed by the bundle (task 02).
- `Agent3D.mount(target, opts)` API must be documented here even though the bundle task owns the implementation.

## Required fallback paths

The snippet must handle:

1. Bundle script fails to load (CDN blocked) → show one-line text fallback inside `#a` saying "Agent viewer couldn't load. See: https://3dagent.vercel.app/agent/AGENT_ID_HERE".
2. `agentId` not found → the bundle should render an empty sad-face stand-in; the snippet just passes the id through.
3. Avatar GLB fails to load → bundle handles; snippet just doesn't crash.

Implement (1) inline with a small `onerror` handler on the script tag. (2) and (3) are delegated to task 02.

## Audit checklist — must handle all of these

- Snippet is &lt;2 KB. Measure with `wc -c`.
- No inline event handlers beyond the `onerror` on the bundle script tag.
- No `<iframe>` — this IS the iframe (the Artifact sandbox itself).
- No `type="module"` — keep it classic script for maximum compatibility across Artifact sandbox versions.
- No external CSS files — style in `style=""` attributes only.
- No tracking / telemetry / analytics.
- Works whether the user pastes it directly into the Artifact code editor or Claude generates it for them.
- If `AGENT_ID_HERE` is left unreplaced, the bundle must show a clear "replace `AGENT_ID_HERE` with an agent id" instruction overlay (bundle task 02 owns this behavior; note it in the snippet as an HTML comment).
- Copy button in the share panel produces output that is byte-identical to `snippet.html` except for the `AGENT_ID_HERE` substitution.

## Constraints

- No new runtime deps.
- No changes to `/api` in this task — that is task 02's territory.
- Do not edit `src/element.js`. The Artifact bundle is a separate build artifact with its own surface.
- Do not edit [../../public/agent/embed.html](../../public/agent/embed.html) — the iframe embed stays as-is for non-Claude hosts.

## Verification

1. `wc -c public/artifact/snippet.html` — report bytes.
2. `npx vite build` — report result.
3. Manually: open a Claude chat, paste the snippet with a real agentId (`0x-demo-agent` or equivalent) into an `html` artifact. Screenshot or describe the result. If the avatar renders and breathes, verification passes.
4. Paste the snippet with `AGENT_ID_HERE` *unchanged* — expect a clear instruction overlay, not a silent blank.
5. Verify the share-panel copy button in `public/agent/index.html` yields the exact bytes of `snippet.html` with id substituted.

## Scope boundaries — do NOT do these

- Do not build the bundle. Task 02 owns `https://3dagent.vercel.app/artifact.js`.
- Do not design the idle animation. Task 03 owns it.
- Do not write an ERC-8004 lookup path here. Task 04 covers the onchain template.
- Do not add Claude-specific telemetry, postMessage handshake, or branding beyond a single HTML comment naming the project.
- Do not introduce a new Vercel route — serve `public/artifact/index.html` and `public/artifact/snippet.html` as static files.

## Reporting

At the end, summarise:
- Byte count of `snippet.html`.
- Which files were created and which edited (list sections in `public/agent/index.html`).
- The exact snippet that was pasted into a live Claude Artifact and what happened.
- Any sandbox surprise (blocked domain, CSP error, broken fallback path).
- Any unverified Artifact-sandbox assumption that should be re-checked before shipping to users.
