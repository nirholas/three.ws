# Task: Build the hosted single-file viewer bundle for Claude Artifacts

## Context

Repo: `/workspaces/3D`. Task [./01-artifact-snippet.md](./01-artifact-snippet.md) defines a minimal HTML snippet users paste into Claude.ai Artifacts. That snippet pulls **one script** from our CDN:

```
<script src="https://3dagent.vercel.app/artifact.js"></script>
```

This task produces `artifact.js` — a single self-contained, zero-install, CDN-ready bundle that:

1. Loads three.js (via CDN, not bundled).
2. Fetches the agent identity + avatar GLB via our public API.
3. Mounts a `<canvas>` into a user-provided target.
4. Runs the Empathy Layer in idle mode (see [./03-idle-animation-loop.md](./03-idle-animation-loop.md) for the animation spec — this task just exposes the hook).
5. Supports both `agentId` lookup and **ERC-8004 onchain lookup** (delegating to [../../src/agent-resolver.js](../../src/agent-resolver.js) logic, ported into the bundle as needed).

Relevant existing modules:
- [../../src/element.js](../../src/element.js) — full web component. Too heavy for an Artifact bundle. Cannibalise selectively.
- [../../src/viewer.js](../../src/viewer.js) — ~11k LOC. Do **not** bundle as-is; port only the minimum: GLB load, render loop, camera setup.
- [../../src/agent-avatar.js](../../src/agent-avatar.js) — Empathy Layer. Small and self-contained. Port whole.
- [../../src/agent-protocol.js](../../src/agent-protocol.js) — event bus. Port whole.
- [../../src/agent-identity.js](../../src/agent-identity.js) — identity fetch logic. Trim to what the bundle needs.
- [../../src/agent-resolver.js](../../src/agent-resolver.js) — `resolveAgentById`. Port.
- [../../api/agents/[id]/index.js](../../api/) and [../../api/avatars/](../../api/avatars/) — the endpoints the bundle calls. Must return CORS-permissive headers.

## Goal

Ship `public/artifact.js` — a UMD/IIFE bundle, &lt;150 KB gzipped (three.js excluded), that exposes a global `Agent3D` with a minimal public API and works inside a Claude Artifact sandbox.

## Public API

The bundle MUST expose exactly this surface on the global `Agent3D`:

```js
Agent3D.mount(target, opts) → Promise<Instance>
// target: string (CSS selector) | HTMLElement
// opts: {
//   agentId?:  string,              // our internal id
//   chain?:    string,              // 'mainnet' | 'base' | 'sepolia' | etc.
//   onchainId?: string | number,    // ERC-8004 agentId — requires chain
//   wallet?:   string,              // 0x... — resolve the wallet's primary agent
//   glbUrl?:   string,              // skip identity lookup, just render this GLB
//   background?: 'transparent' | 'dark' | 'light' | '#rrggbb',
//   idle?:     boolean,             // default true — breathing + head glance loop
//   onReady?:  (instance) => void,
//   onError?:  (err) => void,
// }
//
// Returns: { dispose(), say(text), emote(name, weight), identity }
```

- Exactly one of `agentId`, `onchainId`+`chain`, `wallet`, `glbUrl` must be provided.
- If zero or more than one is provided, render the "replace `AGENT_ID_HERE`" instruction overlay referenced in task 01.

## Deliverable

1. **New directory** `artifact-bundle/` at the repo root with its own `package.json`, `src/index.js`, `rollup.config.js` (or `esbuild.config.js`). This is a separate build pipeline from the main Vite app — its output is `public/artifact.js`, committed, not gitignored, so Vercel serves it statically.
2. **Build script** wired into the root `package.json` as `npm run build:artifact`. CI-safe (`npm run build` does NOT need to run it — but document clearly in the bundle's README that `build:artifact` must be re-run before shipping changes).
3. **Port, don't re-depend** — the bundle must not import the full [src/viewer.js](../../src/viewer.js). Extract the render loop + GLB load into `artifact-bundle/src/mini-viewer.js`. The Empathy Layer ([src/agent-avatar.js](../../src/agent-avatar.js)) and protocol ([src/agent-protocol.js](../../src/agent-protocol.js)) can be imported or copy-forwarded — document the choice in the bundle README.
4. **CORS** — add `Access-Control-Allow-Origin: *` to responses from `/api/agents/:id`, `/api/avatars/:id`, and `/api/agents/:id/resolve` (or whatever the resolver consumes). Verify in [api/_lib/](../../api/_lib/) that CORS middleware exists or add it. Allowed origins MUST include at minimum: `claude.ai`, `*.claude.ai`, `claude.com`, `*.claude.com`, `anthropic.com`, `*.anthropic.com`, or be `*`.
5. **three.js loading** — inside `mount()`, dynamically inject `<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js">` and the GLTFLoader companion. Wait for `window.THREE`. If already present, skip.
6. **Output file** — committed at `public/artifact.js`. Vercel serves `/artifact.js` at edge.

## Audit checklist — must handle all of these

- Bundle exposes `window.Agent3D` with exactly the documented public API. No more, no less.
- Mount can be called multiple times on different targets in the same Artifact.
- `dispose()` is idempotent and detaches all listeners (mirror the discipline in [../scalability/01-dispose.md](../scalability/01-dispose.md)).
- three.js is loaded once even if `mount()` is called repeatedly.
- Bundle size (gzipped, three.js excluded) ≤ 150 KB. Report the actual number.
- Empathy Layer's per-frame tick is wired into the mini-viewer's render loop — check by logging emotion state briefly during dev.
- When `agentId` is missing or `AGENT_ID_HERE`, render an instruction overlay inside the target element ("Set `agentId` to an agent — get one at 3dagent.vercel.app").
- When the GLB fails to load, render a static stand-in avatar (embed a tiny base64 GLB in the bundle OR a CSS silhouette — your call, document it).
- Errors never throw out of `mount()`; they resolve with `onError(err)` called and the overlay set.
- No usage of `localStorage` / `sessionStorage` / `IndexedDB` / `document.cookie`. The Artifact sandbox may block these.
- No `import.meta.url` / Node-style imports. Plain JS output.
- Bundle is side-effect-free until `Agent3D.mount()` is called.

## ERC-8004 onchain path

- When `opts.onchainId` + `opts.chain` is provided, the bundle calls `GET /api/agents/resolve?chain=CHAIN&id=ID` on our API. That endpoint already exists or must be added — check [../../api/agents/](../../api/agents/). If missing, write a thin serverless function that does an RPC `IdentityRegistry.getAgent()` call via a public RPC URL we already use in [../../src/erc8004/abi.js](../../src/erc8004/abi.js).
- Do NOT bundle ethers/viem into the Artifact bundle. The RPC call lives server-side; the Artifact just fetches the resolved record as JSON.

## Constraints

- No new runtime deps in the main app.
- The bundle's build pipeline may use rollup + rollup-plugin-terser (or esbuild). Pick whichever is smaller. Report the choice.
- Do not edit [src/element.js](../../src/element.js), [src/viewer.js](../../src/viewer.js), [src/agent-avatar.js](../../src/agent-avatar.js), or [src/agent-protocol.js](../../src/agent-protocol.js) in this task except to **add exports** if the bundle needs access. If you cannot avoid a source change, stop and report.
- Do not add new URL hash params to [src/app.js](../../src/app.js).
- Do not break `npx vite build` for the main app.

## Verification

1. `node --check` every modified JS file.
2. `npm run build:artifact` — produces `public/artifact.js`. Report size (raw + gzipped).
3. `npx vite build` — main app still builds.
4. `curl -I https://localhost:PORT/api/agents/SOME_ID` (or equivalent) — confirm CORS headers on the endpoints consumed by the bundle.
5. Serve `public/artifact/index.html` (from task 01) locally — the snippet's script tag resolves, `Agent3D` appears on window, avatar renders.
6. **Claude Artifact end-to-end** — paste the task-01 snippet into a fresh Claude chat. Describe what rendered.
7. Try all four `mount()` modes: `agentId`, `onchainId+chain`, `wallet`, `glbUrl`. Describe which work.

## Scope boundaries — do NOT do these

- Do not design the idle animation loop details. Task 03 writes it — just expose a hook.
- Do not build the example gallery. Task 04.
- Do not add Claude-specific branding or telemetry.
- Do not expose `Agent3D.runtime` or chat/LLM features. This bundle is render-only. Chat happens via postMessage in task 04.
- Do not implement pointer/orbit controls. Artifacts often swallow pointer events; idle-loop-only.

## Reporting

At the end, summarise:
- `public/artifact.js` size (raw + gzipped).
- Which files from `src/` were ported vs imported vs rewritten.
- CORS changes shipped (which endpoints, what headers).
- Exact sequence of testing in a live Claude Artifact (chat URL optional) and which `mount()` modes worked.
- Any sandbox surprise (blocked CDN, CORS refusal, CSP block).
- Any unverified Claude-Artifact assumption the next maintainer should re-check.
