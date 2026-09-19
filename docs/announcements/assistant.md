# Announcement pack: 3D avatar assistant widget for any website

**Surface:** [`/assistant`](https://three.ws/assistant) · **Stage:** drafted · **Slot:** 2026-09-29 · **Announced externally:** never

Ranked 46 of 322 never-announced surfaces by `npm run announce:rank` (score 66). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/assistant.json`](../../data/announce-plan/briefs/assistant.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `assistant` |
| Publish slot | 2026-09-29. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / clip |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/assistant |
| Tracked links | Telegram `https://three.ws/assistant?utm_source=telegram&utm_medium=community&utm_campaign=announce-assistant&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /assistant and use it |
| Media | `assistant-hero`, motion loop |
| KPI | loop completions and profile visits, then route sessions on the day |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (16)**: sitemap priority 0.80, which is what we already decided this surface is worth
- **visual (25)**: a showcase surface, so its frame can be a motion loop
- **novelty (20)**: on the coverage audit's hand-picked shortlist of strongest candidates
- **depth (5)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The coverage audit's note on it: The AI concierge and assistant widgets: the embeddable business story beyond avatars.

It shipped on 2026-07-18 and has never been posted about.

The changelog has 4 entries about it, the most recent from 2026-08-16: "The assistant widget now tells you the truth when its chat lane is busy".

## The claim, and where it is checked

> A script tag puts an animated 3D avatar on your site: chatbot on free models or your own Groq or OpenRouter key, or speak mode reads what you type. three.ws/assistant

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| chatbot on free models or your own Groq or OpenRouter key | live page shows "What should the chatbot know about your site?" |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `assistant-hero` | `/announce/img/assistant-hero.webp` | Motion loop of the live route. |

**Alt text, required on the post:**

> Screen recording of the three.ws assistant builder: a floating launcher opens an animated 3D avatar in the corner of the page with a chat panel and speech bubble, while the live preview re-mounts as options change.

## The post

Pattern: clip. **171 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`assistant.post.txt`](./assistant.post.txt), which is the byte-for-byte source the queue item points at.

```text
A script tag puts an animated 3D avatar on your site: chatbot on free models or your own Groq or OpenRouter key, or speak mode reads what you type. three.ws/assistant
```

### Why it is written that way

The post leads on the mechanism, a script tag that mounts a real animated avatar with two working modes, because the how is what a developer audience reads for. Bring-your-own Groq or OpenRouter key is the detail that separates this from a hosted chatbot and it is all visible on the page itself.

### Thread

2/ (132)

```text
Also installable as the three-ws/assistant npm package and a free MCP server, so an agent can generate the paste-ready embed itself.
```

3/ (129)

```text
The builder page runs a live preview in the corner that re-mounts as you edit, so the loop here is the real widget, not a mockup.
```

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The assistant widget adds a 3D avatar to any website from a script tag. It runs as a chatbot on free models or your own Groq or OpenRouter key, and a speak mode makes the avatar say whatever you type, out loud, in a speech bubble. The builder at three.ws/assistant runs a live preview that re-mounts as you configure it, and the same widget ships as the three-ws/assistant npm package plus a free MCP server so coding agents can generate the embed for you.
```

## Ship it

```bash
npm run announce:media -- --only assistant-hero   # capture the frame from the live route
npm run x:content -- review assistant               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id assistant   # exactly what would be sent to X
```

The queue item is `assistant` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

