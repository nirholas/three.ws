# Announcement pack: Browse every agent by meaning, in 3D

**Surface:** [`/galaxy`](https://three.ws/galaxy) · **Stage:** drafted · **Slot:** 2026-09-22 · **Announced externally:** never

Ranked 143 of 330 never-announced surfaces by `npm run announce:rank` (score 51). Drafted by hand and packed by `npm run announce:kit`, from the evidence brief `data/announce-plan/briefs/galaxy.json` (a local build artifact: `data/announce-plan/` is gitignored, so regenerate it with `npm run announce:kit -- --id galaxy --brief-only`), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `galaxy` |
| Publish slot | 2026-09-22. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | labs / walkthrough |
| Audience | People who follow the experimental surfaces |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/galaxy |
| Tracked links | Telegram `https://three.ws/galaxy?utm_source=telegram&utm_medium=community&utm_campaign=announce-galaxy&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /galaxy and use it |
| Media | `galaxy-hero`, still frame |
| KPI | route sessions that reach the second step of the flow |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (13)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The changelog has 6 entries about it, the most recent from 2026-09-08: "Agent Galaxy no longer strands you when the star map cannot be built".

## The claim, and where it is checked

> Agent Galaxy is a 3D star-map of every published agent, placed by meaning. Type what you want in plain language and the map flies to the closest ones. three.ws/galaxy

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| a 3D star-map of every published agent, placed by meaning | `docs/galaxy.md` contains "Agent Galaxy is an explorable 3D star-map of every published agent on three.ws, positioned" |
| Type what you want in plain language and the map flies to the closest ones. | `docs/galaxy.md` contains "Type a natural-language query and the galaxy flies to the agents closest to your intent." |
| Proximity is similarity: agents that do similar things sit near each other | `docs/galaxy.md` contains "Agent Galaxy turns the whole population into a spatial map where proximity is similarity: " |
| Instead of guessing keywords, you describe what you want in plain language and the same embedding model that placed the stars finds the closest ones. | `docs/galaxy.md` contains "Instead of guessing keywords, you describe what you want in plain language and the same em" |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `galaxy-hero` | `/announce/img/galaxy-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> The Agent Galaxy page with hundreds of labelled agent stars clustered in 3D space and the natural-language search box over them.

## The post

Pattern: walkthrough. **174 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`galaxy.post.txt`](./galaxy.post.txt), which is the byte-for-byte source the queue item points at.

```text
Agent Galaxy is a 3D star-map of every published agent, placed by meaning. Type what you want in plain language and the map flies to the closest ones. three.ws/galaxy
```

### Why it is written that way

The post leads on the one move that makes the surface obvious: describe what you want and watch the map fly to it. The embedding provider is deliberately not named, because the live map is currently built by the fallback lane rather than the preferred one.

### Thread

2/ (142)

```text
Proximity is similarity: agents that do similar things sit near each other, so browsing the map is browsing by meaning rather than by keyword.
```

3/ (149)

```text
Instead of guessing keywords, you describe what you want in plain language and the same embedding model that placed the stars finds the closest ones.
```

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
Agent Galaxy turns every published agent on three.ws into an explorable 3D star-map, positioned by what each agent means rather than by name. Agents that do similar things sit near each other, so browsing the map is browsing by meaning. Instead of guessing keywords, you describe what you want in plain language and the same embedding model that placed the stars finds the closest ones. three.ws/galaxy
```

## Ship it

```bash
npm run announce:media -- --only galaxy-hero   # capture the frame from the live route
npm run x:content -- review galaxy               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id galaxy   # exactly what would be sent to X
```

The queue item is `galaxy` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

