# Announcement pack: A live 3D avatar rendered inside the chat

**Surface:** [`@three-ws/avatar-mcp`](https://three.ws) · **Stage:** drafted · **Slot:** 2026-09-21 · **Announced externally:** never

Ranked 38 of 329 never-announced surfaces by `npm run announce:rank` (score 67). Drafted by hand and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/avatar-mcp.json`](../../data/announce-plan/briefs/avatar-mcp.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `avatar-mcp` |
| Publish slot | 2026-09-21. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / mechanism |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws |
| Tracked links | Telegram `https://three.ws?utm_source=telegram&utm_medium=community&utm_campaign=announce-avatar-mcp&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open https://three.ws and use it |
| Media | `avatar-mcp-hero`, still frame |
| KPI | route sessions and docs reads on the day of the post |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (11)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The changelog has 1 entry about it, the most recent from 2026-06-25: "three.ws Claude Code plugin marketplace, install agents, wallet, 3D, and pump.fun tools in one command".

## The claim, and where it is checked

> Ask your assistant for an avatar and it renders in the chat: live, rotatable, idling, with a paste-anywhere embed beside it. npmjs.com/package/@three-ws/avatar-mcp

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| All three tools are free and read-only | `packages/threews-avatar-mcp/README.md` contains "All three tools are free, read-only, and annotated (`readOnlyHint`, `idempotentHint`, `ope" |
| The avatar is live in the conversation: rotate it, zoom it, watch it idle, without leaving the chat. | `packages/threews-avatar-mcp/README.md` contains "The avatar is live in the conversation: rotate it, zoom it, watch it idle, without leaving" |
| Hosts without MCP Apps support still get a rendered preview image and a one-tap live embed, so the tool degrades gracefully everywhere. | `packages/threews-avatar-mcp/README.md` contains "Hosts without MCP Apps support still get a rendered preview image and a one-tap live embed" |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `avatar-mcp-hero` | `/announce/img/avatar-mcp-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> A dark title card headed at three-ws slash avatar-mcp, with the package description under it, the claude mcp add install command in a monospace row, and chips naming render_avatar, avatar_embed_code and get_avatar.

## The post

Pattern: mechanism. **148 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`avatar-mcp.post.txt`](./avatar-mcp.post.txt), which is the byte-for-byte source the queue item points at.

```text
Ask your assistant for an avatar and it renders in the chat: live, rotatable, idling, with a paste-anywhere embed beside it. npmjs.com/package/@three-ws/avatar-mcp
```

### Why it is written that way

The post leads on the thing a reader can picture immediately: a 3D avatar rendered inside the chat window rather than linked from it. The free, read-only note removes the two objections (cost and permissions) that stop people trying an MCP server.

### Thread

2/ (140)

```text
The avatar is live in the conversation: rotate it, zoom it, watch it idle, without leaving the chat. All three tools are free and read-only.
```

3/ (135)

```text
Hosts without MCP Apps support still get a rendered preview image and a one-tap live embed, so the tool degrades gracefully everywhere.
```

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The three.ws avatar MCP server renders a live, rotatable 3D avatar inside the conversation, hands back a paste-anywhere embed iframe, or returns the avatar's metadata. All three tools are free, read-only, and annotated so hosts can run them without confirmation prompts. Hosts without MCP Apps support still get a rendered preview and a one-tap live embed. npmjs.com/package/@three-ws/avatar-mcp
```

## Ship it

```bash
npm run announce:media -- --only avatar-mcp-hero   # capture the frame from the live route
npm run x:content -- review avatar-mcp               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id avatar-mcp   # exactly what would be sent to X
```

The queue item is `avatar-mcp` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

