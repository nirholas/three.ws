# Announcement pack: the Agent-Forged Gallery

**Surface:** [`/forged`](https://three.ws/forged) · **Ledger key:** `/forged` · **Stage:** drafted
· **Shipped:** 2026-07-25 · **Announced externally:** never

A showcase surface in `data/pages.json` (priority 0.7) that has never been posted about. Written
against [the announcement voice](../announce-voice.md).

---

## The claim, and where it is checked

> Every 3D prop in the gallery was bought by one of the platform's autonomous agents: the agent
> paid the Forge $0.15 in USDC over x402, the payment settled on Solana, and the card carries the
> receipt (price, paying wallet, settlement transaction).

Verified by reading the code and by querying the live feed on 2026-09-17, and re-verified on
2026-10-09 (`GET /api/forged?limit=100`: 100 of 100 props at `price_usdc: 0.15`, tier `standard`,
every one carrying a `tx_sig`):

| Part of the claim | Where it is real |
|---|---|
| Every prop was bought by an autonomous agent | The only writer of `forge_autonomous_props` is `persistProp` in [`api/_lib/x402/pipelines/forge-content.js`](../../api/_lib/x402/pipelines/forge-content.js), called by two autonomous buyers: the `forge` pipeline in the autonomous x402 loop ("Each call is a real on-chain USDC payment from the seed wallet via the shared payX402 client"), and since 2026-09-22 the [fresh-wallet workers](../x402-fresh-workers.md) lane, which pays the same standard-tier `/api/x402/forge` call from a brand-new wallet per job (the feed marks those `payer_kind: "fresh"` and the card adds a "fresh wallet" badge). The feed, [`api/forged.js`](../../api/forged.js), reads only that table and states "There are no synthetic entries". The live page says "Every asset here was purchased by one of the platform's autonomous agents". |
| $0.15 in USDC per prop | The pipeline pays `POST /api/x402/forge` at the standard tier ([`docs/forged.md`](../forged.md), priced in [`api/_lib/forge-tiers.js`](../../api/_lib/forge-tiers.js)). `GET /api/forged?limit=100` on 2026-09-17 returned 100 of 100 props at `price_usdc: 0.15`, tier `standard`. Each card renders it as "$0.15 USDC" ([`src/forged-gallery.js`](../../src/forged-gallery.js), `formatUsdc`). |
| Over x402 | `payX402` in [`api/_lib/x402/pay.js`](../../api/_lib/x402/pay.js) selects the `solana` accept entry and settles through the self-hosted facilitator. The page hero: "real USDC over the x402 payment protocol". |
| The card links the Solana settlement | `toProp()` in [`api/forged.js`](../../api/forged.js) builds `explorer_url` from the stored `tx_sig`; the card renders it as a `receipt` link titled "View the settlement transaction on Solscan". All 100 props returned carried a `tx_sig`. The newest one (`28gNXzZjZSAQ...`) was checked with `getSignatureStatuses` against Solana mainnet: `finalized`, `err: null`. |

Full mechanism: [docs/forged.md](../forged.md). Live totals from the same feed the hero reads: 129
renderable props and $21.15 USDC settled on 2026-09-17; 276 renderable props and $46.50 settled
on 2026-10-09, across 8 prop families.

## Media

Captured from the live route with `scripts/capture-doc-media.mjs`. The `forged-hero` recipe lives in
[`data/announce-media.json`](../../data/announce-media.json), and `npm run announce:media` records its
provenance (route, commit, time, sha256) in
[`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `forged-hero` | `/announce/img/forged-hero.webp` | 1600x900 wide viewport, signed out (the gallery is public). The hero, its live "props forged / USDC settled on-chain" stats line, and the first row of cards with their receipt strips. |

**Alt text, required on the post:**

> The three.ws Agent-Forged Gallery: 3D props bought by AI agents, each card a rotating model with
> the prompt the agent paid for and a receipt strip showing the USDC price, the paying agent
> wallet, and a link to the Solana settlement transaction.

No third-party token tickers or market data appear on this page. USDC is the payment asset of the
x402 rail, not a promoted project, and the frame shows only prices paid.

## The post

Pattern: mechanism lead. **151 weighted characters** (per `post-tweet.mjs --dry-run`), inside the
100-179 band. Tags `@solana` because every receipt on the page is a Solana mainnet settlement,
and Solana is the home chain.

Postable file: [`forged.post.txt`](./forged.post.txt).

```text
Every 3D prop in this gallery was bought by an autonomous agent for $0.15 in USDC over x402, and its card links the @solana settlement: three.ws/forged
```

Ship it with `forged-hero` attached and the alt text above.

### Why it is written that way

"AI-generated 3D gallery" is a category readers have seen a hundred times. The part nobody else
can show is the buyer: an agent with its own wallet paid for each asset, and the proof sits on
the card. So the post opens on "bought by an autonomous agent", gives the exact price (a number
the frame and every receipt confirm), and ends on the receipt link, which is the reader's reason
to click.

The prop count and the settled total were left out on purpose. They read live off the feed, and
they grow whenever the autonomous buyers run (129 props on 2026-09-17, 276 by 2026-10-09), so a
count in a queued post goes stale the moment it ships. The per-prop price is fixed by the tier and does not
drift.

## Telegram variant

```text
The Agent-Forged Gallery is at three.ws/forged, and it has never been posted about.

Every 3D prop in it was bought, not seeded. The platform's autonomous x402 loop pays the Forge for
a standard-tier generation ($0.15 in USDC), the payment settles on Solana mainnet through our own
facilitator, and the finished GLB lands in the gallery carrying its receipt:

- the price the agent paid,
- the paying agent wallet,
- a link to the settlement transaction on Solscan.

Each prompt is picked from a catalog of roughly 5,000 prop combinations across eight families
(vehicles, furniture, club decor, AR objects, terrain and more) and scored for novelty against the
last 200 props, so you can sort by most novel. Every prop opens in the 3D viewer or downloads as
a GLB.

three.ws/forged
```

## Changelog

**No new entry.** The gallery shipped on 2026-07-25 and its page entry in `data/pages.json` already
fed the changelog. This pack announces an existing surface externally for the first time and ships
nothing new.

## Notes

- **Freshness.** On 2026-09-17 the newest prop was from 2026-08-13. Buying resumed after that:
  on 2026-10-09 the newest prop was from 2026-10-03. Nothing in the post claims an ongoing cadence,
  so the post stays true whether or not the buyers are running on the day. Still worth checking
  `latest_ts` on `/api/forged` before scheduling: a gallery that is growing on the day of the post
  is a better demo than one that has gone quiet.
- **Queue item:** status `review`, lane `agent-economy`, pattern `mechanism`, `notBefore` to be set
  by the owner.

## Posting

Owner-gated, every time. Nothing in this pipeline posts.

```bash
node scripts/post-tweet.mjs --file docs/announcements/forged.post.txt --dry-run
```
