# Announcement pack: Scene Capture turns a phone video into a point cloud

**Surface:** [`/capture`](https://three.ws/capture) · **Stage:** drafted · **Slot:** 2026-10-10 · **Announced externally:** never

Ranked 74 of 322 never-announced surfaces by `npm run announce:rank` (score 61). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/capture.json`](../../data/announce-plan/briefs/capture.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `capture` |
| Publish slot | 2026-10-10. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / walkthrough |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/capture |
| Tracked links | Telegram `https://three.ws/capture?utm_source=telegram&utm_medium=community&utm_campaign=announce-capture&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /capture and use it |
| Media | `capture-hero`, still frame |
| KPI | route sessions that reach the second step of the flow |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (14)**: sitemap priority 0.70, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **novelty (20)**: on the coverage audit's hand-picked shortlist of strongest candidates
- **depth (13)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The coverage audit's note on it: Video to 3D point cloud, photoreal Gaussian avatars. Visually stunning demo material.

It shipped on 2026-06-27 and has never been posted about.

The changelog has 3 entries about it, the most recent from 2026-08-16: "Scene Capture fits a phone screen, and a file that is not a point cloud now says so".

## The claim, and where it is checked

> Paste a phone video URL and a single feed-forward pass fuses the frames into a coloured .ply point cloud you can orbit in the browser, no camera poses: https://three.ws/capture

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| a single feed-forward pass fuses the frames into a coloured .ply point cloud you can orbit in the browser, no camera poses | `docs/capture.md` contains "Scene Capture collapses that into a single feed-forward pass: no per-scene optimization, n" |
| Paste a phone video URL | live page shows "Paste a video URL on the right to reconstruct, drop a .ply here, or try the sample cloud." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `capture-hero` | `/announce/img/capture-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> The Scene Capture page on three.ws, showing a prompt to paste a video URL to reconstruct it, drop a .ply file, or try the sample point cloud, beside a 3D viewer stage.

## The post

Pattern: walkthrough. **175 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`capture.post.txt`](./capture.post.txt), which is the byte-for-byte source the queue item points at.

```text
Paste a phone video URL and a single feed-forward pass fuses the frames into a coloured .ply point cloud you can orbit in the browser, no camera poses: https://three.ws/capture
```

### Why it is written that way

The post leads with the first move in the walkthrough, pasting a video URL, and what comes back: an orbitable coloured .ply from a single feed-forward pass with no camera poses. That mechanism is the strongest true thing here because it contrasts with the offline photogrammetry pipeline the docs describe and is fully checkable on the page and in the docs.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
On three.ws/capture you paste a public URL to a phone video and a streaming feed-forward reconstruction fuses the frames into a coloured .ply point cloud, rendered live in the browser with WebGL. No per-scene optimization and no manual camera poses, just frames in and dense world-space geometry out. If you already have a point cloud, drop the .ply straight in and skip to the viewer: https://three.ws/capture
```

## Ship it

```bash
npm run announce:media -- --only capture-hero   # capture the frame from the live route
npm run x:content -- review capture               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id capture   # exactly what would be sent to X
```

The queue item is `capture` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

