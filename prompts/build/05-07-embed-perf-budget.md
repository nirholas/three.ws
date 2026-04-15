# 05-07 — Host embed: first-frame perf budget

**Branch:** `feat/embed-perf`
**Stack layer:** 5 (Host embed)
**Depends on:** 05-01

## Why it matters

When the embed is the first thing a user sees inside another app, slow cold start kills the demo. Today the embed bundle pulls Three.js, ethers, dat.gui, and the full agent runtime up front (~1.5MB gzipped). Target: < 200KB for first paint, lazy-load the rest.

## Read these first

| File | Why |
|:---|:---|
| [vite.config.js](../../vite.config.js) | Bundle config — needs a separate `embed` entry. |
| [src/element.js](../../src/element.js) | Boot path — find what's eagerly imported. |
| [src/lib.js](../../src/lib.js) | Library entry — current bundle composition. |
| [package.json](../../package.json) | `build:lib` script. |

## Build this

1. Add a new Vite build target `embed` that produces `dist-embed/`. Entry: `src/embed-bootstrap.js` — a tiny shim (~10KB) that:
   - Reads the agent id from script tag.
   - Renders a placeholder dot/loader.
   - Dynamically imports the heavy bundle on `requestIdleCallback` (or after IntersectionObserver fires).
2. Code-split:
   - **Always:** bootstrap, host-bridge, agent-protocol stub.
   - **Lazy on visible:** Three.js, viewer, agent-avatar.
   - **Lazy on first interaction:** ethers, agent-identity, agent-skills tools.
3. Add a CI check that fails if the always-loaded chunk exceeds 50KB gzipped.
4. Preload the lazy chunks on hover (when the embed dot becomes visible) using `<link rel="modulepreload">`.
5. Inline a 1KB CSS-only loading shimmer so the user sees something within 100ms.

## Out of scope

- Do not switch from Three.js to a smaller renderer.
- Do not implement server-side rendering.
- Do not attempt to lazy-load the GLB itself (that's already on-demand).

## Acceptance

- [ ] Bootstrap chunk < 50KB gzipped.
- [ ] First paint < 100ms on simulated 3G (Lighthouse mobile).
- [ ] Lazy chunks load without blocking the placeholder.
- [ ] Existing `dist/` and `dist-lib/` builds unaffected.
- [ ] `npm run build:embed` script added to package.json.

## Test plan

1. `npm run build:embed`. Inspect `dist-embed/` — verify chunk sizes.
2. Serve `dist-embed/` from a static server. Embed in a scratch page on simulated slow 3G via Chrome devtools.
3. Verify placeholder visible < 100ms; full agent < 3s.
4. Re-run on fast network — verify no regression.
