---
mode: agent
description: "Polish the public /agent/:slug page — hero, identity card, presence, CTAs"
---

# Stack Layer 4: Public Agent Page

## Problem

`/agent/:slug` currently loads the viewer with the GLB but lacks a complete public presentation: identity card, bio, owner info, embed CTA, share buttons. This is the page that onlookers see when someone shares a link.

## Implementation

### Layout (desktop)

- **Hero** — full-viewport 3D viewer with the avatar auto-rotating and breathing.
- **Identity card** (top-left overlay) — name, handle, bio, verified badge if ERC-8004 registered.
- **Action dock** (bottom-center) — buttons for skills the agent exposes (e.g., "Greet", "Introduce yourself", "Show model").
- **Presence strip** (top-right) — current emotional blend ([src/agent-avatar.js](src/agent-avatar.js) Empathy Layer), shown as weighted pills ("60% curious, 30% neutral").
- **Share + embed** (bottom-right) — copy link, copy embed, social share.

### Layout (mobile)

- Hero viewer, full-screen.
- Identity as a collapsible sheet from the bottom.
- Action dock docked above the sheet.

### Data load

Single fetch: `GET /api/agents/by-slug/:slug/public` returns `{ avatar, identity, skills, publicMemories, onchain }`. Avoid N+1.

### OG + oembed

Delegate to existing [api/agent-og.js](api/agent-og.js) and [api/agent-oembed.js](api/agent-oembed.js). Add `<meta>` tags on the page for Twitter/LinkedIn scraping.

### Verified badge

If `identity.onchain.registered === true` (ERC-8004), show a small badge that links to the chain record.

### Empty states

- No skills → hide action dock.
- No bio → hide bio line.
- No public memories → hide the memories section (don't render an empty panel).

### Kiosk mode

Respect `?kiosk=1` query: hide everything but the viewer + presence strip. Used by embed (see stack-17).

## Validation

- `/agent/satoshi` shows full page with identity, skills, embed CTA.
- Clicking a skill triggers it visibly (avatar animates, emotion shifts).
- Share link copied to clipboard.
- OG tags verified with `curl` + unfurl checker.
- Mobile layout works in responsive devtools.
- `?kiosk=1` strips to just viewer + presence.
- `npm run build` passes.

## Do not do this

- Do NOT load any owner-private data (wallet, email, private memories) on this page.
- Do NOT add comments/social features — that's a later concern.
