---
mode: agent
description: "Rewrite the root landing page to sell the actual product: embodied agents you can embed anywhere"
---

# 08-01 · Marketing landing page

## Why it matters

The current root page ([index.html](../../index.html)) is a 3D model viewer demo. The product's real pitch is: **your agent, with a face, embeddable anywhere — in Claude, in Lobehub, on chain.** The landing has to say that in three seconds or nobody clicks through.

This is the marketing surface that turns shared agent links into new signups. Low on the build stack intentionally — ship features first, marketing after, but not never.

## Prerequisites

- Pillar 4 (view & embed) shipped — there needs to be something compelling to show above the fold.
- At least one pillar 5 integration working (Claude Artifact or Lobehub) for the "embed anywhere" demo.

## Read these first

- [index.html](../../index.html) — current root.
- [features.html](../../features.html) — existing feature page with hero avatar.
- [public/agent/embed.html](../../public/agent/embed.html) — for the live avatar embed above the fold.

## Build this

### Rewrite `index.html` (keep it as a single file, no framework)

Structure above the fold:

1. **Headline (1 line)**: "Your agent, with a face. Embeddable anywhere."
2. **Sub (1 line)**: "Take a selfie, get a 3D agent with identity, memory, and wallet. Drop it into Claude, Lobehub, your portfolio — same body, anywhere."
3. **Live hero** — a real embedded agent ([public/agent/embed.html](../../public/agent/embed.html) as an iframe, or `<agent-avatar>` with a curated `agent-id`) doing a slow idle. Must actually load, not a video.
4. **Primary CTA**: "Make yours →" → `/register` (or `/dashboard/selfie` if signed in).
5. **Secondary CTA**: "See one in Claude" → opens the Claude Artifact link (prompt `05-01`).

Below the fold, three horizontal sections:

- **Take a selfie → get a 3D avatar.** Short GIF of the capture + generate flow.
- **Drop it anywhere.** Row of logos: Claude.ai, Lobehub, your portfolio. Each with a small embed showing the same avatar. The "same agent in multiple places" visual is the point.
- **It's yours.** One line on ERC-8004 + IPFS: "The agent is anchored onchain — even if we disappear, your identity is portable."

Footer: small, with links to docs (if they exist), GitHub, pricing (defer until exists), contact.

### Constraints

- No new CSS frameworks. Inline styles and custom properties only, matching the existing dark aesthetic.
- Hero avatar must be real and load fast — use the web component with preload hints. If it takes more than 3s to first paint, budget down.
- Page must be < 150 KB without the avatar JS (which is cached separately).
- Lighthouse: performance ≥ 80, accessibility ≥ 95.

### SEO

- `<meta>` description summarizing the product.
- OG image that actually shows a 3D agent, not a logo.
- JSON-LD structured data for SoftwareApplication.
- `robots.txt` already allows; confirm sitemap.xml includes `/`.

### Analytics

- Add a single conversion event: click on the primary CTA. Record via the same `usage_events` pipeline as prompt `07-02` with `kind='landing_cta_click'`.

## Out of scope

- Pricing page.
- Docs site.
- Blog.
- A/B testing framework.
- Internationalization.
- Any marketing copy longer than one page of HTML.

## Acceptance

1. Open `/` — see headline, live agent, primary CTA within the viewport.
2. Agent on the landing is a real, working embed (not a GIF).
3. CTA click flows to signup (or dashboard if signed in).
4. Lighthouse on the built page: performance ≥ 80, accessibility ≥ 95.
5. Shared OG card (paste URL into Slack) shows the product pitch, not a generic preview.
6. No regressions to `/features` or other routes.
