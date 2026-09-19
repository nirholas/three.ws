# Announcement pack: Intel SDK ships four market reads in one import

**Surface:** [`@three-ws/intel`](https://three.ws) · **Stage:** drafted · **Slot:** 2026-09-26 · **Announced externally:** never

Ranked 38 of 322 never-announced surfaces by `npm run announce:rank` (score 67). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/intel.json`](../../data/announce-plan/briefs/intel.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `intel` |
| Publish slot | 2026-09-26. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / mechanism |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws |
| Tracked links | Telegram `https://three.ws?utm_source=telegram&utm_medium=community&utm_campaign=announce-intel&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open https://three.ws and use it |
| Media | `intel-hero`, still frame |
| KPI | route sessions and docs reads on the day of the post |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (11)**: documented in the tree, so there is enough to write a mechanism about and link proof for

## The claim, and where it is checked

> One import, four reads on a token: sentiment pulse, aixbt narrative intel, momentum-ranked scans, and a live Solana snapshot, each a normalized aggregate: https://www.npmjs.com/package/@three-ws/intel

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| four reads on a token: sentiment pulse, aixbt narrative intel, momentum-ranked scans, and a live Solana snapshot, each a normalized aggregate | `packages/intel/README.md` contains "Four independent reads, each fronting a normalized aggregate." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `intel-hero` | `/announce/img/intel-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> Documentation page for the three.ws intel package on npm, showing the install command, a JavaScript import example, and function calls for sentiment and token snapshot reads.

## The post

Pattern: mechanism. **178 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`intel.post.txt`](./intel.post.txt), which is the byte-for-byte source the queue item points at.

```text
One import, four reads on a token: sentiment pulse, aixbt narrative intel, momentum-ranked scans, and a live Solana snapshot, each a normalized aggregate: https://www.npmjs.com/package/@three-ws/intel
```

### Why it is written that way

Leads on the mechanism: one import returns four normalized reads, which is the README's own summary of the package. That is the strongest true thing because it tells an engineer exactly what calling the SDK gets them, without the package name being parsed as an account tag.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The three.ws intel SDK is on npm. One package gives you four reads on a token: a sentiment pulse over pump.fun commentary, aixbt narrative intel, momentum-ranked project scans, and a live Solana token snapshot with price, volume, holders, and metadata, each fronting a normalized aggregate. The sentiment endpoint is public and key-free, while the aixbt and snapshot lanes run as paid MCP tools settled in USDC. Package and usage: https://www.npmjs.com/package/@three-ws/intel
```

## Ship it

```bash
npm run announce:media -- --only intel-hero   # capture the frame from the live route
npm run x:content -- review intel               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id intel   # exactly what would be sent to X
```

The queue item is `intel` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

