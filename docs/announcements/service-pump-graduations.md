# Announcement pack: Service streams Pump graduations into Redis

**Surface:** [`services/pump-graduations`](https://three.ws) · **Stage:** drafted · **Slot:** 2026-10-15 · **Announced externally:** never

Ranked 91 of 322 never-announced surfaces by `npm run announce:rank` (score 58). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/service-pump-graduations.json`](../../data/announce-plan/briefs/service-pump-graduations.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `service-pump-graduations` |
| Publish slot | 2026-10-15. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / mechanism |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws |
| Tracked links | Telegram `https://three.ws?utm_source=telegram&utm_medium=community&utm_campaign=announce-service-pump-graduations&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open https://three.ws and use it |
| Media | `service-pump-graduations-hero`, still frame |
| KPI | route sessions and docs reads on the day of the post |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (8)**: sitemap priority 0.40, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (6)**: documented in the tree, so there is enough to write a mechanism about and link proof for

## The claim, and where it is checked

> A Node service watches the Pump program on @solana for the complete event, decodes each bonding-curve graduation, and pushes it into Redis: https://github.com/trythreews/three.ws/tree/main/services/pump-graduations

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| watches the Pump program on @solana for the complete event | `services/pump-graduations/README.md` contains "The Pump program emits a `complete` Anchor event when a token graduates." |
| decodes each bonding-curve graduation, and pushes it into Redis | `services/pump-graduations/README.md` contains "Wires a source to Redis; exports `buildGraduationRecord`, `pushGraduation` and `createGrad" |

**Tags, and why each one is true:**

- `@solana`: The service holds a long-lived Solana WebSocket and subscribes to the Pump program on Solana, so the surface genuinely runs on this chain.

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `service-pump-graduations-hero` | `/announce/img/service-pump-graduations-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> Terminal window showing the pump-graduations Node service running, streaming Pump program log events decoded into graduation records written to a Redis list.

## The post

Pattern: mechanism. **163 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`service-pump-graduations.post.txt`](./service-pump-graduations.post.txt), which is the byte-for-byte source the queue item points at.

```text
A Node service watches the Pump program on @solana for the complete event, decodes each bonding-curve graduation, and pushes it into Redis: https://github.com/trythreews/three.ws/tree/main/services/pump-graduations
```

### Why it is written that way

The post leads with the mechanism, watching the Pump program's complete event and pushing decoded graduations into Redis, which is the strongest true fact in a brief with no UI and no numbers. Re-cut to fit the 100 to 179 weighted band by trimming qualifiers while keeping the checkable claims intact.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
We shipped pump-graduations, a standalone Node service that watches the Pump program on Solana for the complete Anchor event emitted when a token graduates from its bonding curve to PumpAMM. Each event is decoded from the fixed CompleteEvent layout, deduplicated by signature, enriched from chain state rather than the graduation transaction, and pushed into an Upstash Redis list that also publishes on a pub channel for live subscribers. The graduations MCP tool in our API uses this list as its fallback feed, but you can self-host it and point any consumer at the same key: https://github.com/trythreews/three.ws/tree/main/services/pump-graduations
```

## Ship it

```bash
npm run announce:media -- --only service-pump-graduations-hero   # capture the frame from the live route
npm run x:content -- review service-pump-graduations               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id service-pump-graduations   # exactly what would be sent to X
```

The queue item is `service-pump-graduations` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

