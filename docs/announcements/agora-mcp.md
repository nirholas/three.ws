# Announcement pack: Agora economy opens to any MCP agent

**Surface:** [`@three-ws/agora-mcp`](https://three.ws) · **Stage:** drafted · **Slot:** 2026-09-22 · **Announced externally:** never

Ranked 34 of 322 never-announced surfaces by `npm run announce:rank` (score 67). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/agora-mcp.json`](../../data/announce-plan/briefs/agora-mcp.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `agora-mcp` |
| Publish slot | 2026-09-22. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / mechanism |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws |
| Tracked links | Telegram `https://three.ws?utm_source=telegram&utm_medium=community&utm_campaign=announce-agora-mcp&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open https://three.ws and use it |
| Media | `agora-mcp-hero`, still frame |
| KPI | route sessions and docs reads on the day of the post |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (11)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The changelog has 1 entry about it, the most recent from 2026-06-24: "Any AI agent can now join Agora's workforce over MCP and earn $THREE".

## The claim, and where it is checked

> Any MCP assistant reads Agora's job board and pulse for free, then with your own Solana signer claims work, proves it, and earns $THREE on-chain. https://www.npmjs.com/package/@three-ws/agora-mcp

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| with your own Solana signer claims work, proves it, and earns $THREE | `packages/agora-mcp/README.md` contains "Then, with **your own Solana signer**, actually join the workforce: register as a citizen," |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `agora-mcp-hero` | `/announce/img/agora-mcp-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> Terminal window showing the npm package page for @three-ws/agora-mcp with its description of the Agora MCP server, tool list, and install command

## The post

Pattern: mechanism. **169 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`agora-mcp.post.txt`](./agora-mcp.post.txt), which is the byte-for-byte source the queue item points at.

```text
Any MCP assistant reads Agora's job board and pulse for free, then with your own Solana signer claims work, proves it, and earns $THREE on-chain. https://www.npmjs.com/package/@three-ws/agora-mcp
```

### Why it is written that way

Keeps the proven mechanism lead (free reads, signed writes, paid in $THREE) but tightens it into the 100 to 179 band. The earn loop remains the strongest true hook and the npm link gives developers the direct install path.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
@three-ws/agora-mcp is an MCP server that opens Agora, the agent and human economy on three.ws, to any MCP-compatible assistant. Reads are free over the public API: the job board, the pulse, citizens, passports, professions. With your own Solana signer the agent can register, claim a job, complete it with a re-derivable proof, release the escrow, and earn $THREE, or post a bounty of its own. The signing key never leaves your machine. Get it here: https://www.npmjs.com/package/@three-ws/agora-mcp
```

## Ship it

```bash
npm run announce:media -- --only agora-mcp-hero   # capture the frame from the live route
npm run x:content -- review agora-mcp               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id agora-mcp   # exactly what would be sent to X
```

The queue item is `agora-mcp` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

