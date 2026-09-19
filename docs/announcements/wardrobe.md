# Announcement pack: Wardrobe turns text prompts into wearable garments

**Surface:** [`/wardrobe`](https://three.ws/wardrobe) · **Stage:** drafted · **Slot:** 2026-10-02 · **Announced externally:** never

Ranked 57 of 322 never-announced surfaces by `npm run announce:rank` (score 64). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/wardrobe.json`](../../data/announce-plan/briefs/wardrobe.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `wardrobe` |
| Publish slot | 2026-10-02. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | community / clip |
| Audience | People who use three.ws and hold $THREE |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/wardrobe |
| Tracked links | Telegram `https://three.ws/wardrobe?utm_source=telegram&utm_medium=community&utm_campaign=announce-wardrobe&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /wardrobe and use it |
| Media | `wardrobe-hero`, motion loop |
| KPI | loop completions and profile visits, then route sessions on the day |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (14)**: sitemap priority 0.70, which is what we already decided this surface is worth
- **visual (25)**: a showcase surface, so its frame can be a motion loop
- **novelty (20)**: on the coverage audit's hand-picked shortlist of strongest candidates
- **depth (5)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The coverage audit's note on it: A full cosmetics economy for avatars: forge garments, dress agents, trade fits.

It shipped on 2026-07-26 and has never been posted about.

The changelog has 6 entries about it, the most recent from 2026-09-07: "Keyboard focus is visible again on every /play HUD button, and the AGI filter counts clear AA contrast".

## The claim, and where it is checked

> The Wardrobe turns a text prompt into a wearable: photo, 3D mesh, placement, auto-rigging, publish. Finished pieces are public and wearable by anyone: https://three.ws/wardrobe

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| The Wardrobe turns a text prompt into a wearable: photo, 3D mesh, placement, auto-rigging, publish. | live page shows "A text prompt becomes a wearable: reference photo, 3D mesh, placement on the canonical body, auto-rigging, validation, publish. Watch every real stage below. Finished pieces are public and instantly wearable by anyone." |
| Finished pieces are public and wearable by anyone | live page shows "A text prompt becomes a wearable: reference photo, 3D mesh, placement on the canonical body, auto-rigging, validation, publish. Watch every real stage below. Finished pieces are public and instantly wearable by anyone." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `wardrobe-hero` | `/announce/img/wardrobe-hero.webp` | Motion loop of the live route. |

**Alt text, required on the post:**

> Animated loop of the Wardrobe page: a text prompt is typed, a garment builds through visible stages, and the finished piece appears worn by a 3D avatar.

## The post

Pattern: clip. **174 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`wardrobe.post.txt`](./wardrobe.post.txt), which is the byte-for-byte source the queue item points at.

```text
The Wardrobe turns a text prompt into a wearable: photo, 3D mesh, placement, auto-rigging, publish. Finished pieces are public and wearable by anyone: https://three.ws/wardrobe
```

### Why it is written that way

It leads on the prompt-to-wearable pipeline because the page names every stage and that mechanism is the strongest checkable fact. It closes on public availability, which the motion loop cannot say on its own.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The Wardrobe is live at https://three.ws/wardrobe. A text prompt becomes a wearable through a visible pipeline: reference photo, 3D mesh, placement on the canonical body, auto-rigging, validation, publish. Finished pieces are public and wearable by anyone on any humanoid avatar.
```

## Ship it

```bash
npm run announce:media -- --only wardrobe-hero   # capture the frame from the live route
npm run x:content -- review wardrobe               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id wardrobe   # exactly what would be sent to X
```

The queue item is `wardrobe` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

