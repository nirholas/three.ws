# Announcement pack: Hydrate brings your on-chain agents to life

**Surface:** [`/hydrate`](https://three.ws/hydrate) · **Stage:** drafted · **Slot:** 2026-10-14 · **Announced externally:** never

Ranked 89 of 322 never-announced surfaces by `npm run announce:rank` (score 58). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/hydrate.json`](../../data/announce-plan/briefs/hydrate.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `hydrate` |
| Publish slot | 2026-10-14. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / clip |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/hydrate |
| Tracked links | Telegram `https://three.ws/hydrate?utm_source=telegram&utm_medium=community&utm_campaign=announce-hydrate&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /hydrate and use it |
| Media | `hydrate-hero`, motion loop |
| KPI | loop completions and profile visits, then route sessions on the day |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (14)**: sitemap priority 0.70, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible

It shipped on 2026-05-20 and has never been posted about.

The changelog has 4 entries about it, the most recent from 2026-08-13: "Importing an agent you already own on-chain no longer fails because its metadata host is slow".

## The claim, and where it is checked

> Hydrate finds the agents you already own on Solana or ERC-8004 from your connected wallet and attaches a 3D body, voice, and skills @solana https://three.ws/hydrate

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| agents you already own on Solana or ERC-8004 from your connected wallet | live page shows "To import your on-chain agents, you need to connect a wallet first." |

**Tags, and why each one is true:**

- `@solana`: Hydrate imports agents registered in the Solana registry, so the surface genuinely reads from and runs against Solana.

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `hydrate-hero` | `/announce/img/hydrate-hero.webp` | Motion loop of the live route. |

**Alt text, required on the post:**

> Screen recording of the three.ws hydrate page: a connected wallet view listing on-chain agents found in the registry, each row offering an import action that attaches a 3D body, voice, and skills.

## The post

Pattern: clip. **163 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`hydrate.post.txt`](./hydrate.post.txt), which is the byte-for-byte source the queue item points at.

```text
Hydrate finds the agents you already own on Solana or ERC-8004 from your connected wallet and attaches a 3D body, voice, and skills @solana https://three.ws/hydrate
```

### Why it is written that way

The post leads on the mechanism, wallet-based discovery of agents you already own on-chain, because that is the one thing the page itself proves and the strongest true statement about this surface. The Solana tag is included per the measured mention lift and is defensible since the registry read targets Solana.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
If you registered an agent on-chain before ever touching three.ws, the hydrate page is the way in. Connect a wallet and it finds the agents you own on Solana or ERC-8004, then attaches a 3D body, voice, and skills so you can keep building on top. Importing reads the registry entry on the chain plus the registration file it points at. https://three.ws/hydrate
```

## Ship it

```bash
npm run announce:media -- --only hydrate-hero   # capture the frame from the live route
npm run x:content -- review hydrate               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id hydrate   # exactly what would be sent to X
```

The queue item is `hydrate` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

