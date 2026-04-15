# Task: Bespoke /cz landing page — spotlight the CZ agent, strong first frame

## Context

Repo: `/workspaces/3D`. The canonical demo avatar is [public/avatars/cz.glb](../../public/avatars/cz.glb) (~2.1 MB, already in the repo). The generic app at `/` loads the viewer and optionally hydrates an agent based on hash params. There is **no dedicated landing** for the CZ demo today.

The priority stack ([../README.md](../README.md)) marks this CZ demo with 🎯. The single URL we send to the target user must:

- Render the avatar within 2 seconds on a warm cache.
- Show a first frame that looks intentional — not a default dark box.
- Contain copy that names the persona, the product, and the action (embed / share / chat).
- Never depend on a logged-in session — it must render for a first-time anonymous visitor.
- Fail visibly (not silently) if any dependency breaks.

## Goal

Ship a `/cz` route with a curated layout, strong hero copy, and the CZ avatar rendered in a hero stage. Post-load, the avatar should greet the visitor (see [03-scripted-first-interaction.md](./03-scripted-first-interaction.md) — wire the hook here, implementation lands there).

## Deliverable

1. New file [public/cz.html](../../public/cz.html) — a standalone entry that reuses the shared build output. Two acceptable implementations; **pick one** and justify in the reporting section:
   - **(a) Route variant:** a top-level `cz.html` file Vite serves at `/cz.html`, with a redirect in [vercel.json](../../vercel.json) rewriting `/cz` → `/cz.html`.
   - **(b) Hash variant:** reuse `/` and gate on `window.location.hash === '#cz'`; preferred if `vercel.json` changes are risky.
2. New module [src/features/cz-landing.js](../../src/features/cz-landing.js) exporting `mountCzLanding(containerEl, opts)` that:
   - Injects the hero layout: left column = agent stage; right column = title, subtitle, three CTAs.
   - Mounts a `Viewer` instance with the CZ GLB.
   - Uses **poster-first** rendering: shows a blurred thumbnail until the GLB's first frame paints, then fades the poster out (generate the poster PNG once via `scripts/cz-demo/gen-poster.js` — see `Deliverable 5`).
   - Wires up the first-interaction hook: `window.addEventListener('cz:viewer-ready', ...)` fires a `CustomEvent('cz:greet')` exactly once after viewer.load completes and 300ms settle — consumed by [03](./03-scripted-first-interaction.md).
   - If the on-chain hydrate from [onchain/01-hydrate-agent-from-chain.md](../onchain/01-hydrate-agent-from-chain.md) is available, hydrates name/description from `(chainId, agentId)` provided in `opts`. Falls back to hard-coded copy if not (the demo works without the onchain hydration being live).
3. Hero copy (final, ship as-is; tweak if the reviewer asks):
   - Eyebrow: `A 3D agent with a passport`
   - H1: `This is CZ. Say hi.`
   - Subtitle: `A signed, embodied, portable agent you can embed anywhere — inside a Claude Artifact, a chat sidebar, or your own site.`
   - CTAs: `Chat with CZ` · `Embed this agent` · `Register your own`
4. Styling: keep the CZ route **dark-themed** (matches the app default `#191919`). Use a subtle radial gradient behind the stage (`radial-gradient(ellipse at center, rgba(80,120,255,0.18) 0%, transparent 60%)`). No new global CSS — scoped classes under `.cz-hero-*`. Inject via a `<style>` tag the module appends once.
5. New build-time script [scripts/cz-demo/gen-poster.js](../../scripts/cz-demo/gen-poster.js) — Node script that uses `puppeteer` or an existing headless renderer **only if already a dev-dep**; otherwise write a hand-authored 1200×800 PNG based on a screenshot you take manually and commit as [public/cz-poster.png](../../public/cz-poster.png). Prefer the manual commit path — simpler, zero new deps.
6. Route wiring:
   - In [src/app.js](../../src/app.js), detect the `/cz` route (or `#cz` hash) early in the boot sequence and delegate to `mountCzLanding` **instead of** the normal app. The generic viewer should not initialise for this route.
   - OG tags (title, description, `og:image = /cz-og.png`) — see [04-share-card-and-embed-presets.md](./04-share-card-and-embed-presets.md) for the OG image. For this task, just emit the `<meta>` tags referencing the filename even if the image isn't committed yet.

## Audit checklist

- Visiting `/cz` cold (cleared cache) shows the poster PNG within 500ms and the GLB first frame within 2s on a cabled connection.
- No `/api/` calls block the first paint. Any API call is fire-and-forget + cached.
- No `console.error` on load.
- `document.title` set to `CZ — 3D Agent`.
- OG meta tags present: `og:title`, `og:description`, `og:image`, `og:url`, `twitter:card=summary_large_image`.
- Copy exact match to the final strings above.
- Escape route: URL param `?raw=1` (or `#cz&raw=1`) disables the landing overlay and shows the bare viewer — useful for debugging / recording.
- Does not mount twice if `mountCzLanding` is called twice (guard with `if (containerEl.dataset.czMounted) return`).
- No regressions on `/` (generic app still loads; `/#agent=…` still works).

## Constraints

- No new runtime dependencies.
- No UI framework. DOM strings via template literals, consistent with [register-ui.js](../../src/erc8004/register-ui.js).
- Do not modify [public/avatars/cz.glb](../../public/avatars/cz.glb).
- Do not copy logic out of [src/viewer.js](../../src/viewer.js) — instantiate it.
- Do not add authentication gates. The page is public.
- Keep [cz-landing.js](../../src/features/cz-landing.js) under ~300 lines.

## Verification

1. `node --check src/features/cz-landing.js` and any other modified JS.
2. `npx vite build` passes.
3. `npx vite` then open `/cz` (or `/#cz` depending on variant):
   - Poster visible → GLB loads → poster fades.
   - Window title is `CZ — 3D Agent`.
   - DevTools Lighthouse on mobile: LCP under 2.5s.
   - `window.dispatchEvent(new Event('cz:greet'))` and nothing crashes (proper hook even before [03](./03-scripted-first-interaction.md) lands).
4. Test with `#cz&raw=1`: landing UI gone; bare viewer behind.
5. Test `/` still works. Test `/#agent=...` still works.

## Scope boundaries — do NOT do these

- Do not build the greeting behaviour — that's [03](./03-scripted-first-interaction.md).
- Do not generate the OG image in this task — that's [04](./04-share-card-and-embed-presets.md).
- Do not register / re-register the CZ agent on-chain — that's [02](./02-cz-preregistered-agent.md).
- Do not add a claim / transfer flow. The demo is read-focused.
- Do not add analytics in this task.
- Do not introduce a router library.

## Reporting

- Files created / modified.
- Which route variant you picked (a or b) and why.
- LCP number from Lighthouse mobile.
- Exact copy shipped (in case tweaks happened).
- Any dependency on unshipped onchain tasks — confirm fallback path is exercised.
- `npx vite build` status.
