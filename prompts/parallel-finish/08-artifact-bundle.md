# Task: Self-contained "Claude Artifact" bundle — one-file viewer

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md) and [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) first.

Claude Artifacts run inside a sandboxed iframe. The dashboard currently generates a snippet that puts _another_ iframe inside — nested iframes work poorly and break the postMessage bridge. We want a **zero-dependency, self-contained bundle** the user can paste as a single `<script>` + `<div>` and get a live agent inside a Claude Artifact.

The bundle lives at `https://three.ws/artifact.js`. It includes three.js + GLTFLoader inlined (or fetched from a CDN the Artifact sandbox allows — `esm.sh`), reads config from a `<script type="application/json" id="agent3d-config">` block, resolves the agent via `GET /api/agents/:id`, loads the GLB, renders it with basic controls + a caption line (no chat).

## Files you own (exclusive — all new)

- `public/artifact/index.html` — demo page that mirrors what a user would paste inside an Artifact. Used for smoke-testing.
- `public/artifact/snippet.html` — the exact HTML snippet to give users (with `<!-- paste this -->` comments). This is copy-pasted by the dashboard; do not edit the dashboard.
- `src/artifact/entry.js` — the build entry point (IIFE bundle).
- `vite.config.artifact.js` — a second vite config that builds `src/artifact/entry.js` → `dist-artifact/artifact.js` (single file, inline assets).
- `package.json` — add a `build:artifact` script: `vite build --config vite.config.artifact.js`. Do not touch the existing `build` / `build:lib` scripts. **Minimal diff.**

**Do not edit** any other file.

## Bundle requirements

- **Single file**, target ES2020, IIFE format, all deps bundled.
- **Self-booting:** reads config from `<script type="application/json" id="agent3d-config">{"agentId": "...", "theme": "dark"}</script>` or data attributes on the root div (`<div id="agent3d" data-agent-id="..."></div>`).
- **Fetches** `GET /api/agents/:id` from `https://three.ws/` (configurable via `data-origin`). Falls back to a `poster` image if the fetch fails.
- **Renders** the GLB with OrbitControls, auto-rotate, basic lighting.
- **Caption line** below the canvas — shows `agent.name`. No chat. No TTS. (Artifacts are a viewer-only surface.)
- **Size budget:** < 500KB gzipped after Three is bundled. If it's bigger, document why.

## Claude Artifact compatibility

- Works inside `<iframe sandbox="allow-scripts">` with no `allow-same-origin`. That means the bundle must not access `document.cookie`, `localStorage`, or parent window.
- CORS: ensure `GET /api/agents/:id` has `Access-Control-Allow-Origin: *` — check [api/\_lib/http.js](../../api/_lib/http.js) `cors()` helper; you can use it but do not edit it.

## Out of scope

- Do not implement chat or postMessage inside the artifact bundle.
- Do not touch the main `vite.config.js`.
- Do not add the artifact to the dashboard embed tab (separate integration step).
- Do not implement an auto-deploy — the CI/CD side is a later concern.

## Verification

```bash
node --check src/artifact/entry.js
npm run build:artifact
ls -la dist-artifact/artifact.js
npm run build
```

Manually: serve `dist-artifact/` via `python3 -m http.server 8080`, open `public/artifact/index.html` in a browser with `?agentId=<existing-id>`, confirm the GLB renders.

Paste the contents of `snippet.html` into a real Claude Artifact and confirm it works there too (nice-to-have).

## Report back

Files created, build output size, commands + output, any CSP / CORS issue hit while testing in a real Artifact, dependency audit if any new deps were added (ideally zero).
