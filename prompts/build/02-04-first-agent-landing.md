---
mode: agent
description: "Post-generation landing page so a new user immediately sees their 3D self"
---

# 02-04 · First-agent landing

## Why it matters

After 02-03 redirects to `/agent/:id`, the page must feel like an arrival — "this is you, as an agent" — not a blank viewer. First impression of the whole product.

## Prerequisites

- 02-03 wired so the new user has an `agent_identities` row with a generated `avatar_id`.

## Read these first

- [public/agent/index.html](../../public/agent/index.html) — current agent landing page.
- [src/agent-home.js](../../src/agent-home.js) — identity card + timeline.
- [src/agent-identity.js](../../src/agent-identity.js) — `AgentIdentity.load()`.
- [src/agent-avatar.js](../../src/agent-avatar.js) — Empathy Layer performer.

## Build this

1. **Detect first visit** — query param `?welcome=1` after the post-generation redirect triggers an inline celebratory overlay (not a modal): "Meet your agent. This is a 3D body, an identity, and a place for skills. You can edit it any time."
2. **Celebrate via the Empathy Layer** — on load with `?welcome=1`, emit a `celebration` pulse through the agent protocol so the avatar smiles + leans forward. Use the existing scoring in [src/agent-avatar.js](../../src/agent-avatar.js) — fire an action with high celebration valence; do not invent a new state.
3. **Name the agent** — if the agent's `name` is the default `'Agent'`, show an inline "Name your agent" input that saves via `PUT /api/agents/:id`. No modal.
4. **Next steps strip** — three cards below the viewer:
   - "Edit your look" → `/agent/:id/edit` (03-*)
   - "Share your agent" → opens the existing share panel
   - "Make it onchain" → `/agent/:id/register` (06-*) — disabled state + tooltip "Coming soon" if registration isn't wired yet.
5. **Clean state after welcome** — once the user names the agent or dismisses the overlay, replace the URL with `history.replaceState` to drop `?welcome=1` so a refresh doesn't re-celebrate.

## Out of scope

- Building the edit page (03-*).
- Any onchain registration (06-*).
- Redesigning the existing share panel.
- Adding a tutorial walkthrough.

## Deliverables

- Diff to `public/agent/index.html` (welcome overlay + next-steps strip).
- Diff to the page's JS to wire the Empathy Layer pulse and the inline name input.

## Acceptance

- Fresh user lands on `/agent/:id?welcome=1` → overlay + celebration pulse visible.
- Naming the agent persists; refreshing shows the new name.
- Dismiss clears the query param from the URL.
- Returning to `/agent/:id` without the param skips the overlay.
- `npm run build` passes.
