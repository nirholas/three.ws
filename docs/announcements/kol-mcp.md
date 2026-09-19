# Announcement pack: Per-wallet KOL deep dive over MCP

**Surface:** [`@three-ws/kol-mcp`](https://three.ws) · **Stage:** drafted · **Slot:** 2026-09-28 · **Announced externally:** never

Ranked 40 of 322 never-announced surfaces by `npm run announce:rank` (score 67). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/kol-mcp.json`](../../data/announce-plan/briefs/kol-mcp.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `kol-mcp` |
| Publish slot | 2026-09-28. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / mechanism |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws |
| Tracked links | Telegram `https://three.ws?utm_source=telegram&utm_medium=community&utm_campaign=announce-kol-mcp&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open https://three.ws and use it |
| Media | `kol-mcp-hero`, still frame |
| KPI | route sessions and docs reads on the day of the post |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (11)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The changelog has 1 entry about it, the most recent from 2026-06-24: "AI agents can now deep-dive a single smart trader over MCP, one KOL's portfolio P&L and their trades".

## The claim, and where it is checked

> Track a single KOL wallet from any AI agent over MCP: live portfolio P&L, win rate, and that wallet's trades on a mint. Read-only, no key. @AnthropicAI https://www.npmjs.com/package/@three-ws/kol-mcp

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| track a single KOL wallet | `packages/kol-mcp/README.md` contains "A [Model Context Protocol](https://modelcontextprotocol.io) server for the **per-wallet KO" |
| trades on a mint | `packages/kol-mcp/README.md` contains "The three.ws trade feed is mint-keyed (it scans every tracked KOL wallet for activity on o" |
| Read-only, no key | `packages/kol-mcp/README.md` contains "All live, read-only: no API key, signer, or payment on the client." |

**Tags, and why each one is true:**

- `@AnthropicAI`: The package is a Model Context Protocol server, the MCP standard Anthropic publishes, so the surface genuinely runs on their protocol.

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `kol-mcp-hero` | `/announce/img/kol-mcp-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> Screenshot from the @three-ws/kol-mcp package page showing a tracked KOL wallet portfolio card with profit and loss figures alongside a list of that wallet's recent trades on a token mint.

## The post

Pattern: mechanism. **175 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`kol-mcp.post.txt`](./kol-mcp.post.txt), which is the byte-for-byte source the queue item points at.

```text
Track a single KOL wallet from any AI agent over MCP: live portfolio P&L, win rate, and that wallet's trades on a mint. Read-only, no key. @AnthropicAI https://www.npmjs.com/package/@three-ws/kol-mcp
```

### Why it is written that way

The post leads on the mechanism, pointing any AI agent at one tracked KOL wallet to get its live P&L and per-mint trades, which is the strongest true thing about this package and fits the developer lane. The read-only, keyless client is the differentiator and is quoted directly from the README, and the MCP tag is warranted because the surface is a Model Context Protocol server.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
@three-ws/kol-mcp is a Model Context Protocol server for the per-wallet KOL deep dive. Where intel-mcp ranks the whole tracked KOL set, this server zooms in on a single smart trader: an AI agent can pull their live portfolio card with realized and unrealized P&L, win rate, total trades, and largest holding, then inspect that wallet's buys and sells of a specific mint with side, SOL size, price, and timing. Everything is live and read-only over the public three.ws KOL API, so no API key, signer, or payment is needed on the client. Package and docs: https://www.npmjs.com/package/@three-ws/kol-mcp
```

## Ship it

```bash
npm run announce:media -- --only kol-mcp-hero   # capture the frame from the live route
npm run x:content -- review kol-mcp               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id kol-mcp   # exactly what would be sent to X
```

The queue item is `kol-mcp` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

