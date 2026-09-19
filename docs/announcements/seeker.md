# Announcement pack: Seeker home screen: Seed Vault sign-in to avatar

**Surface:** [`/seeker`](https://three.ws/seeker) · **Stage:** drafted · **Slot:** 2026-10-11 · **Announced externally:** never

Ranked 78 of 322 never-announced surfaces by `npm run announce:rank` (score 61). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/seeker.json`](../../data/announce-plan/briefs/seeker.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `seeker` |
| Publish slot | 2026-10-11. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / walkthrough |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/seeker |
| Tracked links | Telegram `https://three.ws/seeker?utm_source=telegram&utm_medium=community&utm_campaign=announce-seeker&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /seeker and use it |
| Media | `seeker-hero`, still frame |
| KPI | route sessions that reach the second step of the flow |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (5)**: documented in the tree, so there is enough to write a mechanism about and link proof for

It shipped on 2026-08-27 and has never been posted about.

The changelog has 2 entries about it, the most recent from 2026-08-28: "three.ws is an Android app you can install today".

## The claim, and where it is checked

> Sign in with Seed Vault: one tap, no seed phrase, no transaction. A selfie from the Seeker camera comes back as a rigged 3D avatar. https://three.ws/seeker

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| one tap, no seed phrase, no transaction | live page shows "One tap. No seed phrase, no browser extension, no transaction." |
| A selfie from the Seeker camera comes back as a rigged 3D avatar | live page shows "One photo with the Seeker camera. A rigged 3D avatar in about a minute." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `seeker-hero` | `/announce/img/seeker-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> The three.ws home screen on a Solana Seeker phone, showing Seed Vault sign-in, a rigged 3D avatar made from a camera selfie, and agent cards carrying a Seeker verified pill.

## The post

Pattern: walkthrough. **155 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`seeker.post.txt`](./seeker.post.txt), which is the byte-for-byte source the queue item points at.

```text
Sign in with Seed Vault: one tap, no seed phrase, no transaction. A selfie from the Seeker camera comes back as a rigged 3D avatar. https://three.ws/seeker
```

### Why it is written that way

It leads with the walkthrough's first move, Seed Vault sign-in, and the payoff, a selfie returning as a rigged avatar, both quoted on the live page. Dropping the bare-domain mention leaves one link and brings the head under 179, and @solana stays untagged because the brief records no reason the surface runs on that account.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The three.ws app on Solana Seeker opens at /seeker, where you sign in with Seed Vault: one tap, no seed phrase, no browser extension, no transaction. From there the Seeker camera takes a selfie and hands you back a rigged 3D avatar, with your agents and the marketplace a thumb away. Seeker owners can verify their Genesis Token, a wallet read that happens with no transaction and fails closed on an RPC error. https://three.ws/seeker
```

## Ship it

```bash
npm run announce:media -- --only seeker-hero   # capture the frame from the live route
npm run x:content -- review seeker               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id seeker   # exactly what would be sent to X
```

The queue item is `seeker` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

