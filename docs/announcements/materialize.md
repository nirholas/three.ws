# Announcement pack: A print priced from the mesh, not from a guess

**Surface:** [`/materialize`](https://three.ws/materialize) · **Stage:** drafted · **Slot:** 2026-09-19 · **Announced externally:** never

Ranked 22 of 322 never-announced surfaces by `npm run announce:rank` (score 73). Drafted by hand and packed by `npm run announce:kit`, from the evidence brief `data/announce-plan/briefs/materialize.json` (a local build artifact: `data/announce-plan/` is gitignored, so regenerate it with `npm run announce:kit -- --id materialize --brief-only`), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `materialize` |
| Publish slot | 2026-09-19. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / mechanism |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/materialize |
| Tracked links | Telegram `https://three.ws/materialize?utm_source=telegram&utm_medium=community&utm_campaign=announce-materialize&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /materialize and use it |
| Media | `materialize-hero`, still frame |
| KPI | route sessions and docs reads on the day of the post |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (16)**: sitemap priority 0.80, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (13)**: documented in the tree, so there is enough to write a mechanism about and link proof for

It shipped on 2026-09-02 and has never been posted about.

The changelog has 6 entries about it, the most recent from 2026-09-02: "Materialize: your generation, printed and posted to you".

## The claim, and where it is checked

> Materialize prices a 3D print from the repaired mesh: it measures the true solid volume and charges that volume in your material, paid in USDC on Solana: three.ws/materialize

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| measures the true solid volume and charges that volume in your material | live page shows "Every quote comes from the mesh itself: the analyzer computes the true solid volume of the repaired model, and the price is that volume in the material you picked. Nothing is estimated from a bounding box." |
| paid in USDC on Solana | live page shows "There is no card processor. You pay the exact quoted amount in USDC on Solana, the order is opened against a signed quote, and the price can never move between the quote and the charge." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `materialize-hero` | `/announce/img/materialize-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> The three.ws Materialize page: a drop area for any .glb beside models fresh from the Forge, over three columns explaining that the price is measured from the repaired mesh, that checkout is USDC on Solana, and that agents can order over x402.

## The post

Pattern: mechanism. **177 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`materialize.post.txt`](./materialize.post.txt), which is the byte-for-byte source the queue item points at.

```text
Materialize prices a 3D print from the repaired mesh: it measures the true solid volume and charges that volume in your material, paid in USDC on Solana: three.ws/materialize
```

### Why it is written that way

The mechanism is the story: everyone who has ordered a print has been quoted from a bounding box, and this one is quoted from the repaired mesh volume. The payment rail is the second fact worth stating because it is what makes the quote binding rather than indicative.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
Most print shops quote from a bounding box, which is how a hollow, delicate model ends up priced like a brick. Materialize measures the thing you actually made: the analyzer repairs the mesh, computes its true solid volume, and the price is that volume in the material you picked. Checkout is USDC on Solana against a signed quote, so the number you were shown is the number you pay, and the same pipeline is open to agents over x402. three.ws/materialize
```

## Ship it

```bash
npm run announce:media -- --only materialize-hero   # capture the frame from the live route
npm run x:content -- review materialize               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id materialize   # exactly what would be sent to X
```

The queue item is `materialize` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

