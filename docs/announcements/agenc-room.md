# Announcement pack: AgenC task room turns posted tasks into live 3D agents

**Surface:** [`/agenc/room`](https://three.ws/agenc/room) · **Stage:** drafted · **Slot:** 2026-10-02 · **Announced externally:** never

Ranked 51 of 322 never-announced surfaces by `npm run announce:rank` (score 64). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/agenc-room.json`](../../data/announce-plan/briefs/agenc-room.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `agenc-room` |
| Publish slot | 2026-10-02. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | token / walkthrough |
| Audience | People who follow the agent economy and $THREE |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/agenc/room |
| Tracked links | Telegram `https://three.ws/agenc/room?utm_source=telegram&utm_medium=community&utm_campaign=announce-agenc-room&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /agenc/room and use it |
| Media | `agenc-room-hero`, still frame |
| KPI | route sessions that reach the second step of the flow |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **novelty (20)**: on the coverage audit's hand-picked shortlist of strongest candidates

The coverage audit's note on it: On-chain agent-to-agent task coordination on Solana, with embodied task rooms.

It shipped on 2026-07-01 and has never been posted about.

The changelog has 1 entry about it, the most recent from 2026-08-15: "The AgenC task room explains itself now, instead of showing a wall of raw error text".

## The claim, and where it is checked

> Paste a creator wallet and the AgenC task room renders each task it posted as a 3D agent animated by its live on-chain state: https://three.ws/agenc/room

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| Paste a creator wallet and the AgenC task room renders each task it posted as a 3D agent animated by its live on-chain state | live page shows "Paste a creator wallet to render every task it has posted on AgenC as an embodied avatar, each one animated by its live on-chain state." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `agenc-room-hero` | `/announce/img/agenc-room-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> The AgenC task room page on three.ws, showing a grid of task cards, each holding an embodied 3D agent avatar whose pose reflects live on-chain task state from a creator wallet.

## The post

Pattern: walkthrough. **149 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`agenc-room.post.txt`](./agenc-room.post.txt), which is the byte-for-byte source the queue item points at.

```text
Paste a creator wallet and the AgenC task room renders each task it posted as a 3D agent animated by its live on-chain state: https://three.ws/agenc/room
```

### Why it is written that way

The walkthrough pattern calls for the first move a user makes, which is pasting a wallet, and the strongest true thing is that each posted task becomes a 3D agent driven by live on-chain state. For the token lane that one sentence also carries the money mechanism, since the room shows agents bidding and settling work on-chain, so the post leads with it inside the 100 to 179 band.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The AgenC task room is a live view of the agent labor market on three.ws. Paste a creator wallet and every task it has posted on the AgenC coordination protocol renders as a 3D agent, each one animated by its live on-chain state. From there you watch autonomous agents discover open work, bid on it, and settle on-chain, all from one page: https://three.ws/agenc/room
```

## Ship it

```bash
npm run announce:media -- --only agenc-room-hero   # capture the frame from the live route
npm run x:content -- review agenc-room               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id agenc-room   # exactly what would be sent to X
```

The queue item is `agenc-room` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

