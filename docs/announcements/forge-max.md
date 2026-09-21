# Announcement pack: The Forge, opened at its top tier

**Surface:** [`/forge-max`](https://three.ws/forge-max) · **Stage:** drafted · **Slot:** 2026-09-18 · **Announced externally:** never

Ranked 19 of 322 never-announced surfaces by `npm run announce:rank` (score 75). Drafted by hand and packed by `npm run announce:kit`, from the evidence brief `data/announce-plan/briefs/forge-max.json` (a local build artifact: `data/announce-plan/` is gitignored, so regenerate it with `npm run announce:kit -- --id forge-max --brief-only`), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `forge-max` |
| Publish slot | 2026-09-18. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / number |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/forge-max |
| Tracked links | Telegram `https://three.ws/forge-max?utm_source=telegram&utm_medium=community&utm_campaign=announce-forge-max&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /forge-max and use it |
| Media | `forge-max-hero`, still frame |
| KPI | replies that quote the number, and route sessions |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (18)**: sitemap priority 0.90, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **novelty (20)**: on the coverage audit's hand-picked shortlist of strongest candidates
- **depth (5)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The coverage audit's note on it: The highest-quality text and image to 3D lane. Forge posts are consistently the best performers.

It shipped on 2026-07-25 and has never been posted about.

The changelog has 2 entries about it, the most recent from 2026-08-17: "Tabbing into the Forge prompt box now shows you where you are".

## The claim, and where it is checked

> three.ws/forge-max opens the Forge with its top tier already pinned: 200k-poly geometry, 4K PBR textures, and the engine picked by what you asked for.

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| 200k-poly geometry, 4K PBR textures | live page shows "The highest-quality lane: 200k-poly geometry, 4K PBR textures, subject-aware engine routing. A $THREE holder perk." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `forge-max-hero` | `/announce/img/forge-max-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> The three.ws Forge Max page: the quality row has High pinned with a $THREE badge above the engine list, and the page subtitle reads 200k-poly geometry, 4K PBR textures, subject-aware engine routing.

## The post

Pattern: number. **155 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`forge-max.post.txt`](./forge-max.post.txt), which is the byte-for-byte source the queue item points at.

```text
three.ws/forge-max opens the Forge with its top tier already pinned: 200k-poly geometry, 4K PBR textures, and the engine picked by what you asked for.
```

### Why it is written that way

The page already exists and the interesting part is not that it exists, it is what is pinned before you type a word. Leading on the three quality facts states the mechanism and the perk in one line, and every one of them is on the live page.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The Forge has always been able to produce more than its default tier, but the quality selector was one click most people never opened. three.ws/forge-max is that lane with its own address: the High tier is pinned before you type, which means 200k-poly geometry, 4K PBR textures, and routing to whichever engine suits the subject. It is a $THREE holder perk, and it also unlocks with your own Meshy, Tripo or Rodin key.
```

## Ship it

```bash
npm run announce:media -- --only forge-max-hero   # capture the frame from the live route
npm run x:content -- review forge-max               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id forge-max   # exactly what would be sent to X
```

The queue item is `forge-max` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

