# Announcement pack: The curated map of the 3D agent pipeline

**Surface:** [`/awesome`](https://three.ws/awesome) · **Stage:** drafted · **Slot:** 2026-09-21 · **Announced externally:** never

Ranked 176 of 330 never-announced surfaces by `npm run announce:rank` (score 46). Drafted by hand and packed by `npm run announce:kit`, from the evidence brief `data/announce-plan/briefs/awesome.json` (a local build artifact: `data/announce-plan/` is gitignored, so regenerate it with `npm run announce:kit -- --id awesome --brief-only`), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `awesome` |
| Publish slot | 2026-09-21. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | community / mechanism |
| Audience | People who use three.ws and hold $THREE |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/awesome |
| Tracked links | Telegram `https://three.ws/awesome?utm_source=telegram&utm_medium=community&utm_campaign=announce-awesome&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /awesome and use it |
| Media | `awesome-hero`, still frame |
| KPI | route sessions and docs reads on the day of the post |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (16)**: sitemap priority 0.80, which is what we already decided this surface is worth
- **visual (25)**: a showcase surface, so its frame can be a motion loop
- **depth (5)**: documented in the tree, so there is enough to write a mechanism about and link proof for

It shipped on 2026-09-07 and has never been posted about.

The changelog has 2 entries about it, the most recent from 2026-09-20: "Awesome 3D Agents joins the announcement queue, and the machine stops skipping pages like it".

## The claim, and where it is checked

> Giving an agent a body means stitching a dozen fields together. Awesome 3D Agents is the map: 152 entries across 15 sections, 121 of them free to use. three.ws/awesome

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| 152 entries across 15 sections | live page shows "152 entries across 15 sections" |
| 121 of them free to use | live page shows "FREE TO USE 121" |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `awesome-hero` | `/announce/img/awesome-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> The Awesome 3D Agents page on three.ws: a heading reading Everything you need to give an AI agent a body, counters for 152 entries, 15 sections, 121 free to use and 97 tags, a row of tag filters, and a grid of cards for projects such as TRELLIS, Hunyuan3D 2 and TripoSR, each with a one sentence description.

## The post

Pattern: mechanism. **174 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`awesome.post.txt`](./awesome.post.txt), which is the byte-for-byte source the queue item points at.

```text
Giving an agent a body means stitching a dozen fields together. Awesome 3D Agents is the map: 152 entries across 15 sections, 121 of them free to use. three.ws/awesome
```

### Why it is written that way

The post leads on the problem the list solves, that embodying an agent means assembling a pipeline out of a dozen unrelated fields, and then on the two counters the page itself renders. Those numbers are the strongest checkable thing about the surface: the list is only worth reading because somebody read all 152 entries and said in one sentence why each one is there.

### Thread

2/ (218)

```text
Each entry says in one sentence what the thing does and why you would reach for it instead of the alternative. The same list is published in the standard awesome list format on GitHub, so it can be forked and added to.
```

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
Awesome 3D Agents is a curated list of what it takes to give an AI agent a body: text to 3D, photo and video capture, avatars, rigging, motion generation, texturing, lipsync and voice, web renderers, asset pipelines, and the agent frameworks that drive them. It runs to 152 entries across 15 sections, 121 of them free to use, and each one says in a sentence what it does and why you would reach for it instead of the alternative. Every link is fetched and checked before it ships, and the same list is published in the standard awesome list format on GitHub so it can be forked and contributed to. Search it, filter it by tag, or copy the whole thing as Markdown at https://three.ws/awesome
```

## Ship it

```bash
npm run announce:media -- --only awesome-hero   # capture the frame from the live route
npm run x:content -- review awesome               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id awesome   # exactly what would be sent to X
```

The queue item is `awesome` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

