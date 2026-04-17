# Onboarding Flow Restructure

## Goal

Restructure the 3D Agent user journey into a clear funnel: **anonymous playground → sign in → create avatar → customize → embed** (with optional on-chain).

Current state is fragmented: the homepage advertises a 3-step flow that doesn't match what actually works, the `/create` page is wired to a selfie-to-GLB pipeline that isn't functional, and the Avaturn iframe entry point (which *did* work) was removed from the UI during a rewrite. This band of tasks fixes all of it.

## Principles

1. **Embed is free and immediate.** Never gate the embed path behind wallet connect or on-chain deployment. On-chain is a *badge upgrade*, not a requirement.
2. **Anonymous `/app` is the funnel.** Users land, drop a GLB, see it render, *then* hit the "save this" wall that prompts sign-in. Don't force auth before showing the product.
3. **One hub page per agent.** After create, user lands on `/agent/:id`. Every action (customize, embed, deploy, edit) returns here.
4. **Selfie-to-GLB is deferred.** The pipeline isn't working. Keep the code (`src/selfie-capture.js`, `src/selfie-pipeline.js`, `api/onboarding/avaturn-session.js`) but unroute it from `/create` and show "Coming Soon" in the UI.

## Task list

| # | File | Depends on | Ready to delegate? |
|---|---|---|---|
| 01 | [01-homepage-how-it-works.md](./01-homepage-how-it-works.md) — rewrite homepage "How It Works" to 4 steps | — | Yes |
| 02 | [02-create-page-3-cards.md](./02-create-page-3-cards.md) — rewrite `/create` as 3-card picker | 03 | After 03 |
| 03 | [03-avaturn-iframe-rewire.md](./03-avaturn-iframe-rewire.md) — re-enable Avaturn default-editor iframe | — | Yes |
| 04 | [04-agent-page-hub.md](./04-agent-page-hub.md) — make `/agent/:id` the action hub | 02, 03 | After 02, 03 |
| 05 | [05-app-html-sandbox.md](./05-app-html-sandbox.md) — position `/app` as anonymous sandbox + authed editor | — | Yes |

Tasks 01, 03, 05 are independent and can run in parallel. Tasks 02 and 04 depend on 03 completing (they consume the re-wired Avaturn entry).

## Out of scope — do NOT do in this band

- Selfie-to-GLB pipeline fixes (deferred until the upstream vendor issue is resolved)
- Persona / brain / skills UI (backend shipped at [api/agents.js](../../api/agents.js), UI lives in [public/agent-edit/](../../public/agent-edit/); wired in a later band)
- ERC-8004 contract deployment (scaffolded, separate task band)
- Widget creation UI polish (works, not in this pass)
- Any TypeScript, new runtime deps, or schema changes

## Reporting

After each task, report:
- Files changed with line counts
- Output of `node --check` on every modified JS file
- Output of `npm run build`
- Manual smoke test result at `localhost:3000`
- Any unrelated bugs observed (write them down, don't fix)
