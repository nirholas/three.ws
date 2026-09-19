# Announcement pack: AI agents manage pumpfun alerts over MCP

**Surface:** [`@three-ws/alerts-mcp`](https://three.ws) · **Stage:** drafted · **Slot:** 2026-09-23 · **Announced externally:** never

Ranked 35 of 322 never-announced surfaces by `npm run announce:rank` (score 67). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/alerts-mcp.json`](../../data/announce-plan/briefs/alerts-mcp.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `alerts-mcp` |
| Publish slot | 2026-09-23. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / mechanism |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws |
| Tracked links | Telegram `https://three.ws?utm_source=telegram&utm_medium=community&utm_campaign=announce-alerts-mcp&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open https://three.ws and use it |
| Media | `alerts-mcp-hero`, still frame |
| KPI | route sessions and docs reads on the day of the post |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (11)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The changelog has 1 entry about it, the most recent from 2026-06-24: "AI agents can now run their own pump.fun alerts over MCP".

## The claim, and where it is checked

> alerts-mcp is an MCP server that hands an AI agent your pumpfun alert rules. Account-scoped to your session, fired server-side by the cron. https://three.ws

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| an MCP server | `packages/alerts-mcp/README.md` contains "A [Model Context Protocol](https://modelcontextprotocol.io) server that turns the three.ws" |
| Account-scoped to your session | `packages/alerts-mcp/README.md` contains "Rules are **account-scoped**: every call carries your three.ws session, so the server read" |
| fired server-side by the cron | `packages/alerts-mcp/README.md` contains "The pumpfun-monitor cron does the watching server-side, so your rules fire across devices " |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `alerts-mcp-hero` | `/announce/img/alerts-mcp-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> Terminal session showing an AI agent connected to the alerts-mcp server, managing pumpfun alert rules and reading a history of fired alerts with per-channel delivery status.

## The post

Pattern: mechanism. **163 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`alerts-mcp.post.txt`](./alerts-mcp.post.txt), which is the byte-for-byte source the queue item points at.

```text
alerts-mcp is an MCP server that hands an AI agent your pumpfun alert rules. Account-scoped to your session, fired server-side by the cron. https://three.ws
```

### Why it is written that way

The post leads on the mechanism, an MCP server handing pumpfun alert rules to an AI agent, which is the most specific and checkable thing about this developer package. Account scoping and server-side cron firing are its distinguishing true properties, both stated directly in the README, and trimming the draft puts it inside the 100 to 179 band with a single link.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
alerts-mcp is a new MCP server that turns the three.ws pumpfun alerts surface into a control plane your AI agent can drive. Rules are account-scoped: every call carries your three.ws session, so the server reads and writes only your rules and your alert history. The pumpfun-monitor cron does the watching server-side, so rules fire across devices with no dashboard open, and you can read back what actually fired with per-channel delivery health. Details at https://three.ws
```

## Ship it

```bash
npm run announce:media -- --only alerts-mcp-hero   # capture the frame from the live route
npm run x:content -- review alerts-mcp               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id alerts-mcp   # exactly what would be sent to X
```

The queue item is `alerts-mcp` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

