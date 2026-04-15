# 05-01 — Single-file HTML build for Claude.ai Artifacts

## Why it matters

Claude.ai Artifacts run in a sandboxed iframe and can't load arbitrary cross-origin modules freely. For "my agent appears next to me in Claude," we need a build target that emits a **single self-contained HTML file** — everything inlined — that a Claude message can drop into an Artifact and have a fully-rendered, interactive agent appear.

This is the first pillar-5 step. It's a packaging prompt, not a runtime prompt.

## Context

- Library build: [vite.config.js](../../vite.config.js) `TARGET=lib` → `dist-lib/agent-3d.js`.
- Web component (pillar 04-02): `<agent-avatar>`.
- Artifacts have constraints: no external `<script>` fetches without specific allowlisted CDNs, limited iframe sandbox.

## Claude Artifact constraints (verify before building)

- External scripts allowed from: `cdn.jsdelivr.net`, `unpkg.com`, `cdn.tailwindcss.com`, and a few specific origins.
- Network calls via `fetch` to other origins work if the server responds with permissive CORS.
- No localStorage persistence is guaranteed across Artifact reloads.

Confirm the current allowlist against Anthropic's documentation before assuming. If `cdn.jsdelivr.net` is available, we can load `agent-3d.js` from a published npm package. If not, we inline.

## What to build

### New build target — `TARGET=artifact`

Extend [vite.config.js](../../vite.config.js) with a third target. Output: `dist-artifact/agent-artifact.html` — a single HTML file with:

- All JS inlined as `<script type="module">` blocks (no external deps).
- All CSS inlined.
- A sensible demo UI: centered `<agent-avatar>` with an input field and buttons.
- Accepts `?agent=<id>` or `?onchain=<id>` in the URL; if neither, shows a centered input prompting for an agent ID.
- Fetches agent data from `https://3dagent.vercel.app/api/agents/:id` (hardcoded but env-overridable at build time).

Use Vite's `viteSingleFile` plugin (add as dep) or a build script that concatenates.

### Artifact template — `public/artifact.html.template`

A separate template file that mirrors what would get pasted into a Claude Artifact. It loads `<agent-avatar>` either from the inlined bundle or from jsDelivr (if allowed). Comment the two modes clearly so users can pick.

### Publish path

- Emit to `dist-artifact/agent-artifact.html` as a build artifact of `npm run build:artifact`.
- Also publish to the static site: `/artifact/agent.html` via an entry in [vercel.json](../../vercel.json). This way Claude users can link to it directly.

### CORS on the API

Confirm `/api/agents/:id` responds with `Access-Control-Allow-Origin: *` for GET. If not, add a specific allowlist: `*` for public GETs, credentialed origins only for mutating endpoints.

## Out of scope

- A full Claude-native "artifact tool" (i.e. teaching Claude to emit these automatically) — that's a separate research/API integration.
- Chat streaming from inside the Artifact to the Claude API.
- State persistence inside Artifacts beyond URL query params.

## Acceptance

1. `npm run build:artifact` produces `dist-artifact/agent-artifact.html` under 1 MB.
2. Opening that file directly in a browser renders an agent given `?agent=<id>`.
3. Pasting the file's contents into a Claude Artifact in claude.ai renders the agent.
4. No external resources fail to load (all same-origin or inlined).
5. Console is clean.
6. Works with a real agent id on production: the avatar loads and orbits.
