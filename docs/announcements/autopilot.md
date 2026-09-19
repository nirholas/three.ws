# Announcement pack: Coin Autopilot runs your coin on your rules

**Surface:** [`/autopilot`](https://three.ws/autopilot) · **Stage:** drafted · **Slot:** 2026-09-30 · **Announced externally:** never

Ranked 48 of 322 never-announced surfaces by `npm run announce:rank` (score 65). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/autopilot.json`](../../data/announce-plan/briefs/autopilot.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `autopilot` |
| Publish slot | 2026-09-30. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | token / clip |
| Audience | People who follow the agent economy and $THREE |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/autopilot |
| Tracked links | Telegram `https://three.ws/autopilot?utm_source=telegram&utm_medium=community&utm_campaign=announce-autopilot&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /autopilot and use it |
| Media | `autopilot-hero`, motion loop |
| KPI | loop completions and profile visits, then route sessions on the day |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (14)**: sitemap priority 0.70, which is what we already decided this surface is worth
- **visual (25)**: a showcase surface, so its frame can be a motion loop
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **depth (8)**: documented in the tree, so there is enough to write a mechanism about and link proof for

It shipped on 2026-07-01 and has never been posted about.

The changelog has 2 entries about it, the most recent from 2026-08-16: "Coin Autopilot tells you whether your rules actually saved".

## The claim, and where it is checked

> Coin Autopilot runs a launched coin for you: set the buyback and burn floors and the holder payouts, and your agent narrates every on-chain move live. https://three.ws/autopilot

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| your agent narrates every on-chain move live | live page shows "Your agent runs the whole coin lifecycle on its own: it buys back & burns from creator fees and distributes payments to holders, on the rules you set. Every on-chain move is narrated live by your agent's avatar." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `autopilot-hero` | `/announce/img/autopilot-hero.webp` | Motion loop of the live route. |

**Alt text, required on the post:**

> Animated loop of the Coin Autopilot page on three.ws, showing coin cards with buyback and holder payout rule switches, floor fields, and a live feed of agent narrated on-chain moves.

## The post

Pattern: clip. **174 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`autopilot.post.txt`](./autopilot.post.txt), which is the byte-for-byte source the queue item points at.

```text
Coin Autopilot runs a launched coin for you: set the buyback and burn floors and the holder payouts, and your agent narrates every on-chain move live. https://three.ws/autopilot
```

### Why it is written that way

The post leads on the mechanism, turning buyback, burn, and payout decisions into owner set rules, which is the strongest true thing about the surface and matters most to the token audience. The narrated live feed is the differentiator the docs keep returning to, so it closes the post.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
Coin Autopilot is live for coins launched through three.ws. You set the rules once, the floors for buying back and burning and for paying creator fees out to holders, and the platform runs the coin on that schedule. Your agent narrates every on-chain move in plain language on a live feed, so the coin tells you what it did instead of running silently. Set it up at https://three.ws/autopilot
```

## Ship it

```bash
npm run announce:media -- --only autopilot-hero   # capture the frame from the live route
npm run x:content -- review autopilot               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id autopilot   # exactly what would be sent to X
```

The queue item is `autopilot` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

