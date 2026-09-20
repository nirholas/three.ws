# Announcement pack: Facial capture in the browser, from the webcam you have

**Surface:** [`/mocap-studio`](https://three.ws/mocap-studio) · **Stage:** drafted · **Slot:** 2026-09-21 · **Announced externally:** never

Ranked 45 of 324 never-announced surfaces by `npm run announce:rank` (score 67). Drafted by hand and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/mocap-studio.json`](../../data/announce-plan/briefs/mocap-studio.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `mocap-studio` |
| Publish slot | 2026-09-21. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | community / clip |
| Audience | People who use three.ws and hold $THREE |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/mocap-studio |
| Tracked links | Telegram `https://three.ws/mocap-studio?utm_source=telegram&utm_medium=community&utm_campaign=announce-mocap-studio&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /mocap-studio and use it |
| Media | `mocap-studio-hero`, motion loop |
| KPI | loop completions and profile visits, then route sessions on the day |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (14)**: sitemap priority 0.70, which is what we already decided this surface is worth
- **visual (25)**: a showcase surface, so its frame can be a motion loop
- **novelty (20)**: on the coverage audit's hand-picked shortlist of strongest candidates
- **depth (8)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The coverage audit's note on it: Replace yourself in any video with your avatar; webcam motion capture as an API. Extremely screenshotable.

It shipped on 2026-07-01 and has never been posted about.

The changelog has 6 entries about it, the most recent from 2026-08-14: "The 3D viewer no longer starts up blank when its box has not been measured yet".

## The claim, and where it is checked

> Your webcam drives an avatar's face in the browser: 52 ARKit blendshapes and 478 landmarks per frame, recorded as a clip you can replay and save. three.ws/mocap-studio

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| 52 ARKit blendshapes and 478 landmarks per frame | `docs/mocap-studio.md` contains "Per frame it outputs 52 ARKit blendshape scores, 478 3-D face landmarks (including iris), " |
| Calibrate to your neutral face, record a clip, replay it, and save it. | `docs/mocap-studio.md` contains "Calibrate to your neutral face, record a clip, replay it, and save it." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `mocap-studio-hero` | `/announce/img/mocap-studio-hero.webp` | Motion loop of the live route. |

**Alt text, required on the post:**

> The Mocap Studio page with a 3D avatar mirroring a face from the webcam preview beside it, the record controls under the viewer and the saved-clips row empty below.

## The post

Pattern: clip. **169 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`mocap-studio.post.txt`](./mocap-studio.post.txt), which is the byte-for-byte source the queue item points at.

```text
Your webcam drives an avatar's face in the browser: 52 ARKit blendshapes and 478 landmarks per frame, recorded as a clip you can replay and save. three.ws/mocap-studio
```

### Why it is written that way

The post leads on the numbers that separate this from a webcam gimmick: 52 blendshapes and 478 landmarks a frame is studio-grade signal running in a tab. The recorded clip is the payoff, so the copy ends where the reader can act.

### Thread

2/ (119)

```text
Calibrate to your neutral face, record a clip, replay it, and save it. Saved clips can be private, unlisted, or public.
```

3/ (143)

```text
The engine is FaceMocap, built on Google's MediaPipe Face Landmarker, a newer model than the FaceMesh that older browser-rigging libraries use.
```

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
Mocap Studio turns the camera you already have into a facial capture rig. It reads 52 ARKit blendshape scores and 478 face landmarks per frame and drives your avatar's face with them, live in the browser. Calibrate to your neutral face, record a clip, replay it, and save it as private, unlisted, or public. three.ws/mocap-studio
```

## Ship it

```bash
npm run announce:media -- --only mocap-studio-hero   # capture the frame from the live route
npm run x:content -- review mocap-studio               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id mocap-studio   # exactly what would be sent to X
```

The queue item is `mocap-studio` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

