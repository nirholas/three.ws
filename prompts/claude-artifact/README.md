# Claude Artifact embed task prompts

Self-contained prompt files for shipping an embodied 3D Agent avatar as a **Claude.ai Artifact**. Each file is designed to be dropped into a fresh Claude Code session without extra context.

Priority 5 in the overall stack (see [../README.md](../README.md)). Sibling to [../lobehub-embed/](../lobehub-embed/).

## The goal in one paragraph

Claude.ai renders each `html` Artifact in a sandboxed iframe. A Claude user should be able to paste **one short HTML snippet** into chat, open it as an Artifact, and immediately see a live, breathing, embodied agent avatar — fetched either by `agentId` or via an ERC-8004 onchain lookup — with the Empathy Layer running idle. No server changes on Anthropic's end, no install for the user.

## What's the deliverable exactly

Not code. The deliverable for this directory is *prompts* that a future Claude Code session will execute to produce:

1. A copy-pasteable minimal HTML snippet (task 01).
2. A hosted single-file bundle, `https://3dagent.vercel.app/artifact.js`, that the snippet loads (task 02).
3. An idle-animation loop so the avatar looks alive in the Artifact viewer — Artifacts often have no pointer input (task 03).
4. A curated gallery of ready-to-paste templates covering the main use cases (task 04).

## Known Artifact sandbox constraints (VERIFY before shipping)

The tasks below reference these constraints. The author of each task MUST verify via WebFetch against `https://docs.claude.com/en/docs/build-with-claude/artifacts` (and `https://platform.claude.com/docs/...` if redirected) and flag uncertainty in their work.

- Artifacts run in a **sandboxed iframe** — treat it like a hostile environment.
- CDN `<script src="...">` loading from major CDNs (cdnjs, unpkg, jsdelivr, esm.sh) is expected to work but must be verified per-CDN — start with `cdnjs.cloudflare.com` as the most commonly cited.
- `fetch()` to external origins is expected to work for CORS-permitted endpoints. Our API at `https://3dagent.vercel.app/api/...` must return permissive CORS. Verify in task 02.
- `postMessage` to `window.parent` (Claude's chat UI) is expected to work but Claude chat does not listen — postMessage is useful for cross-artifact tricks, not host integration.
- `localStorage` / `IndexedDB` may be blocked or ephemeral per session. Assume no persistence.
- No import maps. No Node-style imports. Plain `<script>` only, or `type="module"` with fully-qualified URLs.
- Pointer / wheel events may be swallowed by Claude's UI chrome — don't depend on drag-orbit.
- Canvas / WebGL is supported — three.js works.

If any of these turn out to be wrong during implementation, update the affected task file with a footnote.

## Recommended execution order

1. [01-artifact-snippet.md](./01-artifact-snippet.md) — the HTML template. Foundation.
2. [02-zero-dep-viewer-bundle.md](./02-zero-dep-viewer-bundle.md) — the hosted bundle the snippet pulls. Unblocks 03, 04.
3. [03-idle-animation-loop.md](./03-idle-animation-loop.md) — breathing + head glance loop. Depends on 02.
4. [04-example-gallery.md](./04-example-gallery.md) — curated templates. Depends on 01, 02.

## Rules that apply to all tasks

- No new runtime dependencies in the main app (devDeps only if the task needs them for its bundle build).
- No new docs files (README.md, CLAUDE.md) inside `src/` or `public/` unless the task says so.
- `node --check` every modified JS file before reporting done.
- Run `npx vite build` and note whether it breaks. Pre-existing `@avaturn/sdk` resolution warning is unrelated — ignore.
- The Artifact bundle must stay **tiny** (budget: &lt; 150 KB gzipped for the bundle itself, excluding three.js CDN). Measure and report.
- No new backend endpoints without CORS. Every endpoint consumed by an Artifact MUST return `Access-Control-Allow-Origin: *` (or a permissive allowlist that includes `claude.ai`, `claude.com`, `*.anthropic.com`).
- If you discover an unrelated bug, note it in the reporting section. Do not fix it in the same change.

## Reporting

Each task ends with a short report: files created, files edited (which sections), commands run and their output, the exact Artifact test payload pasted into Claude, screenshot / description of what the user saw, any sandbox surprises.
