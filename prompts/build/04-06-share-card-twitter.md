# 04-06 — View & embed: Twitter card + WhatsApp / iMessage previews

**Branch:** `feat/share-cards`
**Stack layer:** 4 (View & embed)
**Depends on:** 04-01 (OG image)

## Why it matters

When someone pastes `/agent/<id>` into Twitter, iMessage, WhatsApp, Slack, the unfurl preview is the entire pitch. OG image alone isn't enough — Twitter cards need their own meta block, and large images render bigger if `summary_large_image` is declared.

## Read these first

| File | Why |
|:---|:---|
| [api/agent-og.js](../../api/agent-og.js) | OG image generator. |
| [public/agent/index.html](../../public/agent/index.html) | Where meta tags belong. |
| [src/manifest.js](../../src/manifest.js) | Source of name + description. |
| [api/agent-oembed.js](../../api/agent-oembed.js) | oEmbed for richer hosts. |

## Build this

1. Generate dynamic meta on `/agent/<id>` (server-render the head, even if the body is SPA). Include:
   - `<meta property="og:title">`, `og:description`, `og:image`, `og:url`, `og:type=profile`
   - `<meta name="twitter:card" content="summary_large_image">`
   - `<meta name="twitter:site" content="@3dagent">` (env-configurable handle)
   - `<meta name="twitter:image:alt">` with agent name
   - `<link rel="alternate" type="application/json+oembed" href="…">`
2. OG image:
   - 1200×630, agent thumbnail centered on left, name + first sentence of description on right.
   - Reputation stars if on-chain.
   - Watermark `3dagent.vercel.app` bottom-right.
3. Validate with the official validators in the test plan.
4. For widget pages (`/w/<id>`), do the same with widget-flavored copy.
5. Cache the OG image in CDN with `s-maxage=3600, stale-while-revalidate=86400`. Bust by appending `?v=<updated_at>`.

## Out of scope

- Do not generate a video preview (later).
- Do not add LinkedIn-specific tags (their parser uses OG).
- Do not implement signed image URLs.

## Acceptance

- [ ] Twitter Validator (https://cards-dev.twitter.com/validator) shows large-image card.
- [ ] iMessage preview shows thumbnail + title + description (test by sending to yourself).
- [ ] Slack unfurl shows thumbnail.
- [ ] OG image renders on a fresh agent without errors.
- [ ] Cache headers correct.

## Test plan

1. Deploy a preview branch (or use ngrok). Paste `/agent/<id>` into:
   - Twitter compose box
   - iMessage to self
   - Slack DM
   - WhatsApp Web
2. Confirm large image + correct text in each.
3. Curl `/agent/<id>` and grep for the meta tags.
4. Edit agent name → reload preview → image updates after `?v=` bump.
