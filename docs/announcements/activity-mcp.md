# Announcement pack: Live three.ws discovery inside any MCP client

**Surface:** [`@three-ws/activity-mcp`](https://three.ws) · **Stage:** drafted · **Slot:** 2026-09-21 · **Announced externally:** never

Ranked 33 of 330 never-announced surfaces by `npm run announce:rank` (score 67). Drafted by hand and packed by `npm run announce:kit`, from the evidence brief `data/announce-plan/briefs/activity-mcp.json` (a local build artifact: `data/announce-plan/` is gitignored, so regenerate it with `npm run announce:kit -- --id activity-mcp --brief-only`), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `activity-mcp` |
| Publish slot | 2026-09-21. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / mechanism |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws |
| Tracked links | Telegram `https://three.ws?utm_source=telegram&utm_medium=community&utm_campaign=announce-activity-mcp&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open https://three.ws and use it |
| Media | `activity-mcp-hero`, still frame |
| KPI | route sessions and docs reads on the day of the post |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (11)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The changelog has 1 entry about it, the most recent from 2026-06-24: "AI agents can now see what's hot on three.ws over MCP, trending agents and coins, the $THREE holder board, and the live activity ticker".

## The claim, and where it is checked

> Any MCP client can read the live discovery surface: trending agents, the $THREE holder board with tiers, the site activity ticker. Five tools, free: npmjs.com/package/@three-ws/activity-mcp

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| Five tools | `packages/activity-mcp/README.md` contains "All five tools read live data: rankings, the holder board, and the feed all move between c" |
| Every ranking, tier, and event comes straight from the public three.ws API | `packages/activity-mcp/README.md` contains "Every ranking, tier, and event comes straight from the public three.ws API." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `activity-mcp-hero` | `/announce/img/activity-mcp-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> A dark title card headed at three-ws slash activity-mcp, with the package description under it, the claude mcp add install command in a monospace row, and chips naming get_trending_agents, get_trending_coins, get_holder_leaderboard, get_tier_info and get_feed_events.

## The post

Pattern: mechanism. **172 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`activity-mcp.post.txt`](./activity-mcp.post.txt), which is the byte-for-byte source the queue item points at.

```text
Any MCP client can read the live discovery surface: trending agents, the $THREE holder board with tiers, the site activity ticker. Five tools, free: npmjs.com/package/@three-ws/activity-mcp
```

### Why it is written that way

The post leads on the mechanism a developer can act on: five read-only tools that put the platform's live discovery data inside any MCP client. That is the strongest true thing here because the package needs no key, no signer and no payment, so the distance between reading the post and running the thing is one install.

### Thread

2/ (162)

```text
Every ranking, tier, and event comes straight from the public three.ws API, so the model reads the same numbers the site is showing at that moment.
```

3/ (79)

```text
No key, no signer, no payment. Install it, point it at the public API, and ask.
```

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The three.ws live discovery surface is now readable from any MCP client. Five tools cover trending agents, the $THREE holder leaderboard with its tiers, and the site-wide activity ticker. Every ranking, tier, and event comes straight from the public three.ws API, so your assistant sees what the site sees. It is read-only and free: npmjs.com/package/@three-ws/activity-mcp
```

## Ship it

```bash
npm run announce:media -- --only activity-mcp-hero   # capture the frame from the live route
npm run x:content -- review activity-mcp               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id activity-mcp   # exactly what would be sent to X
```

The queue item is `activity-mcp` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

