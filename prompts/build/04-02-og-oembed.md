---
mode: agent
description: "OG image + oEmbed so pasted /agent/:id links unfurl on Slack, X, Discord"
---

# 04-02 · Unfurl with OG image + oEmbed

## Why it matters

The viral channel: paste an agent link → see a real preview, not a URL. Without this, sharing an agent looks like sharing a random domain.

> There is an existing prompt [prompts/embed/01-og-oembed.md](../embed/01-og-oembed.md) with fuller detail. This file is the stack-priority version — if the embed one is already done, mark this prompt complete.

## Prerequisites

- 04-01 in place so the page itself is worth unfurling.

## Read these first

- [prompts/embed/01-og-oembed.md](../embed/01-og-oembed.md) — existing detailed spec.
- [api/agent-og.js](../../api/agent-og.js), [api/agent-oembed.js](../../api/agent-oembed.js) — already exist.
- [public/agent/index.html](../../public/agent/index.html) — `<head>` meta tags.

## Build this

Verify the three pieces are wired:

1. `/api/agent-og?id=X` returns a 1200×630 PNG preview of the agent (avatar rendered headlessly *or* a static thumbnail from the avatar's thumbnail_key if GPU rendering is unavailable).
2. `/api/agent-oembed?url=X` returns JSON oEmbed with `type=rich`, `html=<iframe src="/agent/:id/embed">`.
3. `<head>` of `/agent/:id` includes `og:title`, `og:description`, `og:image`, `og:type=website`, `twitter:card=summary_large_image`, `twitter:image`, and `<link rel="alternate" type="application/json+oembed" href="/api/agent-oembed?url=...">`.

If any of the three is missing or broken, fix it referencing [prompts/embed/01-og-oembed.md](../embed/01-og-oembed.md). If all three work, close the prompt and move on.

## Out of scope

- Referrer allowlist (that's a separate concern in `prompts/embed/03-embed-allowlist.md`; not priority).
- A shiny custom unfurl design beyond OG basics.

## Deliverables

- Tests: paste the URL into Slack / X preview tool / Discord — unfurl renders.
- Any patches to meta tags or endpoints.

## Acceptance

- `curl https://3dagent.vercel.app/api/agent-og?id=...` returns a PNG.
- `curl https://3dagent.vercel.app/api/agent-oembed?url=https://3dagent.vercel.app/agent/...` returns valid oEmbed JSON.
- Slack unfurl preview renders.
- `npm run build` passes.
