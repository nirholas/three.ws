# Announcement pack: Agent Sniper simulates buy-then-sell on-chain before broadcasting

**Surface:** [`@three-ws/agent-sniper`](https://three.ws) · **Stage:** drafted · **Slot:** 2026-09-21 · **Announced externally:** never

Ranked 33 of 322 never-announced surfaces by `npm run announce:rank` (score 67). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/agent-sniper.json`](../../data/announce-plan/briefs/agent-sniper.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `agent-sniper` |
| Publish slot | 2026-09-21. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / mechanism |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws |
| Tracked links | Telegram `https://three.ws?utm_source=telegram&utm_medium=community&utm_campaign=announce-agent-sniper&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open https://three.ws and use it |
| Media | `agent-sniper-hero`, still frame |
| KPI | route sessions and docs reads on the day of the post |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (11)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The changelog has 2 entries about it, the most recent from 2026-06-30: "The autonomous sniper is now an MCP server and an x402 paid API".

## The claim, and where it is checked

> Agent Sniper runs a real simulated buy-then-sell on-chain before broadcasting a trade. Library, CLI, MCP server, or x402 paid API: https://www.npmjs.com/package/@three-ws/agent-sniper

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| runs a real simulated buy-then-sell on-chain before broadcasting a trade | `docs/agent-sniper.md` contains "Before broadcasting, the executor runs a real simulated buy-then-sell on-chain." |
| MCP server | `packages/agent-sniper/README.md` contains "`agent-sniper mcp` exposes the engine as an MCP stdio server." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `agent-sniper-hero` | `/announce/img/agent-sniper-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> Terminal and browser view of the three.ws Agent Sniper package running, showing a strategy panel, a pump.fun launch feed, and a simulated buy-then-sell check logged before a pending trade.

## The post

Pattern: mechanism. **154 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`agent-sniper.post.txt`](./agent-sniper.post.txt), which is the byte-for-byte source the queue item points at.

```text
Agent Sniper runs a real simulated buy-then-sell on-chain before broadcasting a trade. Library, CLI, MCP server, or x402 paid API: https://www.npmjs.com/package/@three-ws/agent-sniper
```

### Why it is written that way

The lead is the pre-trade on-chain simulation, the mechanism that makes the engine safe to run, and it is directly evidenced in the docs. The four consumption faces close the post so developers know exactly how to use it, and the rework drops the unsupported mention and fits the 179-character band.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The pump.fun sniper engine behind three.ws agents is now its own package: @three-ws/agent-sniper. It scores each launch against your strategy, and before broadcasting any buy it runs a real simulated buy-then-sell on-chain. You can run it as a library, a CLI, an MCP server your agent drives, or an x402 paid API that other agents pay per call in USDC. Install with npx -y @three-ws/agent-sniper or read the package at https://www.npmjs.com/package/@three-ws/agent-sniper
```

## Ship it

```bash
npm run announce:media -- --only agent-sniper-hero   # capture the frame from the live route
npm run x:content -- review agent-sniper               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id agent-sniper   # exactly what would be sent to X
```

The queue item is `agent-sniper` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

