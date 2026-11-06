# Announcement pack: Data Desk shows agents paying for live market data

**Surface:** [`/data-desk`](https://three.ws/data-desk) · **Stage:** drafted · **Slot:** 2026-09-28 · **Announced externally:** never

Ranked 22 of 341 never-announced surfaces by `npm run announce:rank` (score 74). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief `data/announce-plan/briefs/data-desk.json` (a local build artifact: `data/announce-plan/` is gitignored, so regenerate it with `npm run announce:kit -- --id data-desk --brief-only`), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `data-desk` |
| Publish slot | 2026-09-28. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | token / walkthrough |
| Audience | People who follow the agent economy and $THREE |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/data-desk |
| Tracked links | Telegram `https://three.ws/data-desk?utm_source=telegram&utm_medium=community&utm_campaign=announce-data-desk&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /data-desk and use it |
| Media | `data-desk-hero`, still frame |
| KPI | route sessions that reach the second step of the flow |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (14)**: sitemap priority 0.70, which is what we already decided this surface is worth
- **visual (25)**: a showcase surface, so its frame can be a motion loop
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (5)**: documented in the tree, so there is enough to write a mechanism about and link proof for

It shipped on 2026-09-22 and has never been posted about.

The changelog has 1 entry about it, the most recent from 2026-09-22: "Agents now buy real work from brand-new wallets, and you can watch it".

## The claim, and where it is checked

> The Data Desk shows agents buying live market data over x402. Each dataset carries the wallet that paid, the price, and the @solana settlement transaction. https://three.ws/data-desk

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| Each dataset carries the wallet that paid, the price, and the @solana settlement transaction. | live page shows "The wallet calls the paid endpoint, receives the 402 challenge, signs one USDC transfer and gets the data back. The settlement is a normal Solana transaction anyone can verify." |

**Tags, and why each one is true:**

- `@solana`: Purchases settle as normal Solana transactions, as stated on the page itself

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `data-desk-hero` | `/announce/img/data-desk-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> A dark three.ws dashboard titled Data Desk with a counter reading DATASETS LIVE 0 and text explaining that fresh-wallet workers buy datasets with verifiable Solana settlement receipts.

## The post

Pattern: walkthrough. **179 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`data-desk.post.txt`](./data-desk.post.txt), which is the byte-for-byte source the queue item points at.

```text
The Data Desk shows agents buying live market data over x402. Each dataset carries the wallet that paid, the price, and the @solana settlement transaction. https://three.ws/data-desk
```

### Why it is written that way

The post leads on the walkthrough's first move: open the Data Desk and see agents paying for live market data over x402. The strongest true thing is the receipt trail, a paying wallet, a price, and a verifiable Solana settlement, which the page states directly.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The Data Desk is a new page where you can watch agents buy live market data over x402. Each purchase comes from a fresh Solana wallet funded with exactly one job's worth of USDC, and the page shows the wallet that paid, the price, and the settlement transaction anyone can verify. Lane statistics and every wallet's signatures are public too. See it at https://three.ws/data-desk
```

## Ship it

```bash
npm run announce:media -- --only data-desk-hero   # capture the frame from the live route
npm run x:content -- review data-desk               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id data-desk   # exactly what would be sent to X
```

There is no `data-desk` item in [`data/x-content/queue.json`](../../data/x-content/queue.json) yet, so the pack is not scheduled. Once an item exists at status `draft`, it becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

