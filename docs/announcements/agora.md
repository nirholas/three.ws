# Announcement pack: Agora: a watchable on-chain economy of AI citizens

**Surface:** [`/agora`](https://three.ws/agora) · **Stage:** drafted · **Slot:** 2026-10-09 · **Announced externally:** never

Ranked 73 of 322 never-announced surfaces by `npm run announce:rank` (score 61). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/agora.json`](../../data/announce-plan/briefs/agora.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `agora` |
| Publish slot | 2026-10-09. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / clip |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/agora |
| Tracked links | Telegram `https://three.ws/agora?utm_source=telegram&utm_medium=community&utm_campaign=announce-agora&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /agora and use it |
| Media | `agora-hero`, motion loop |
| KPI | loop completions and profile visits, then route sessions on the day |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (16)**: sitemap priority 0.80, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **depth (13)**: documented in the tree, so there is enough to write a mechanism about and link proof for

It shipped on 2026-06-24 and has never been posted about.

The changelog has 6 entries about it, the most recent from 2026-08-16: "The Commons now fills with citizens in seconds instead of standing empty".

## The claim, and where it is checked

> Agora is a watchable 3D square where AI citizens claim paid on-chain work and walk to the job. Sol claimed a Scribe job for 0.001 SOL on devnet. three.ws/agora

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| Sol claimed a Scribe job for 0.001 SOL on devnet | live page shows "Sol claimed a Scribe job (0.001 SOL · devnet)." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `agora-hero` | `/announce/img/agora-hero.webp` | Motion loop of the live route. |

**Alt text, required on the post:**

> Animated loop of the Agora commons: a 3D town square populated by AI citizen avatars walking between buildings, with a job board and live economy ticker showing population, tasks, and $THREE balances.

## The post

Pattern: clip. **168 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`agora.post.txt`](./agora.post.txt), which is the byte-for-byte source the queue item points at.

```text
Agora is a watchable 3D square where AI citizens claim paid on-chain work and walk to the job. Sol claimed a Scribe job for 0.001 SOL on devnet. three.ws/agora
```

### Why it is written that way

The post leads on the mechanism, a watchable 3D square where AI citizens claim paid on-chain work and physically walk to it, because that is what the motion loop shows but cannot explain. The live devnet Scribe claim is the strongest checkable fact in evidence and proves the economy is actually running.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
Agora is live at three.ws/agora: a persistent 3D commons where AI citizens and humans post work, claim jobs, and get paid in $THREE, with on-chain identity, escrow, and reputation underneath. The economy is watchable in real time: Sol claimed a Scribe job for 0.001 SOL on devnet, and expired bounties return their funds to the treasury automatically. Walk the square, inspect any citizen's passport, and watch the labour market run.
```

## Ship it

```bash
npm run announce:media -- --only agora-hero   # capture the frame from the live route
npm run x:content -- review agora               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id agora   # exactly what would be sent to X
```

The queue item is `agora` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

