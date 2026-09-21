# Announcement pack: Charge for your attention, delivered out loud

**Surface:** [`/knock`](https://three.ws/knock) · **Stage:** drafted · **Slot:** 2026-09-21 · **Announced externally:** never

Ranked 31 of 330 never-announced surfaces by `npm run announce:rank` (score 70). Drafted by hand and packed by `npm run announce:kit`, from the evidence brief `data/announce-plan/briefs/knock.json` (a local build artifact: `data/announce-plan/` is gitignored, so regenerate it with `npm run announce:kit -- --id knock --brief-only`), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `knock` |
| Publish slot | 2026-09-21. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | token / walkthrough |
| Audience | People who follow the agent economy and $THREE |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/knock |
| Tracked links | Telegram `https://three.ws/knock?utm_source=telegram&utm_medium=community&utm_campaign=announce-knock&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /knock and use it |
| Media | `knock-hero`, still frame |
| KPI | route sessions that reach the second step of the flow |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (14)**: sitemap priority 0.70, which is what we already decided this surface is worth
- **visual (25)**: a showcase surface, so its frame can be a motion loop
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **depth (13)**: documented in the tree, so there is enough to write a mechanism about and link proof for

It shipped on 2026-08-28 and has never been posted about.

The changelog has 1 entry about it, the most recent from 2026-08-28: "Knock: put a price on reaching you, and hear what gets through in person".

## The claim, and where it is checked

> Put a price on reaching you. A stranger pays it, your 3D companion walks on and says who is at the door and what they paid, and the USDC is already yours. three.ws/knock

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| says who is at the door and what they paid | live page shows "Your companion walks on wherever you are on the site and says who is at the door and what they paid." |
| A person pays with the wallet in their browser. An agent pays over x402 with no human in the loop. | live page shows "A person pays with the wallet in their browser. An agent pays over x402 with no human in the loop." |
| The x402 lane sends your USDC to the recipient the instant the payment clears. | `docs/knock.md` contains "The x402 lane sends your USDC to the recipient the instant the payment clears." |
| Your price, your wallet, and everything that comes through it stays private to your account. | live page shows "Your price, your wallet, and everything that comes through it stays private to your account." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `knock-hero` | `/announce/img/knock-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> The Knock page on three.ws: the headline and its description, three numbered cards reading Set your price, They pay it and You hear it in person, and the signed-out door panel below them.

## The post

Pattern: walkthrough. **178 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`knock.post.txt`](./knock.post.txt), which is the byte-for-byte source the queue item points at.

```text
Put a price on reaching you. A stranger pays it, your 3D companion walks on and says who is at the door and what they paid, and the USDC is already yours. three.ws/knock
```

### Why it is written that way

The post leads on the moment the product is worth describing: a paid message arriving as a companion that walks on and speaks it, with the money already settled. It is the clearest paid-attention surface we run, and it works for an agent paying over x402 as well as a person clicking a wallet.

### Thread

2/ (98)

```text
A person pays with the wallet in their browser. An agent pays over x402 with no human in the loop.
```

3/ (171)

```text
The x402 lane sends your USDC to the recipient the instant the payment clears. Your price, your wallet, and everything that comes through it stays private to your account.
```

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
Knock puts a price on reaching you. Anyone, a person or an agent, can pay it to get exactly one message through. Your 3D companion walks on wherever you are on the site and says who is at the door and what they paid. A person pays with the wallet in their browser; an agent pays over x402 with no human in the loop, and the USDC settles straight to your wallet. three.ws/knock
```

## Ship it

```bash
npm run announce:media -- --only knock-hero   # capture the frame from the live route
npm run x:content -- review knock               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id knock   # exactly what would be sent to X
```

The queue item is `knock` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

