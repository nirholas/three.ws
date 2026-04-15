---
mode: agent
description: "Polish /agent/:id so it works as a shareable public page on desktop + mobile"
---

# 04-01 · Agent public page polish

## Why it matters

The agent's public home is what a pasted link resolves to. It's the unfurl destination, the anchor of the identity, and the target of every "visit my agent" link. Must be fast, mobile-clean, and informative.

## Prerequisites

- Pillar 2 complete (at least one agent exists with a generated avatar).

## Read these first

- [public/agent/index.html](../../public/agent/index.html) — current layout.
- [src/agent-home.js](../../src/agent-home.js) — identity card, timeline, memory bar.
- [src/agent-avatar.js](../../src/agent-avatar.js) — Empathy Layer.

## Build this

1. **Above the fold on mobile** — hero 3D viewer fills the viewport width, aspect 1:1, capped at 480px. Identity card slides in under it.
2. **Identity card** — name, description (collapsed to 3 lines, expandable), wallet short-address (if linked), ERC-8004 badge (if registered), skill chips.
3. **Action timeline** — latest 10 actions from the protocol bus, rendered with timestamp. Already provided by `src/agent-home.js` — wire it in if not already.
4. **Share button** — opens the existing iframe/link/`<agent-3d>` share panel. No redesign.
5. **Owner-only bar** — if viewer === owner, show a thin top bar with "Edit" (→ `/agent/:id/edit`) and "Register onchain" (→ 06-*).
6. **404** — if the agent id doesn't exist or is soft-deleted, render a friendly 404 page, not a 500.
7. **Lazy loading** — three.js and avatar assets load after the identity card is visible, so first paint is fast even on mobile.

## Out of scope

- OG/oEmbed unfurl (04-02).
- Editing (03-*).
- Chat / talking agent widget (widget-studio prompts).

## Deliverables

- Diff to `public/agent/index.html`.
- Any helper JS in the same page or a sibling file.

## Acceptance

- Lighthouse mobile Performance ≥ 70 on the landing page (three.js is heavy but lazy).
- 404 on a non-existent id renders the 404 UI, not a blank page.
- Owner bar only visible to the owner.
- `npm run build` passes.
