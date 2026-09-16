# Edition 09: What $THREE does this week, public utility receipts

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-11-THREE-RECEIPTS` |
| Publish date | 2026-11-13 |
| Chapter | Transparency |
| Audience | community and technical evaluators |
| Campaign anchor (campaigns.csv) | https://three.ws/three-token |
| Surface used in this pack | /three-token |
| Verified status (2026-09-16) | **Live (the ledger is live and currently reads zero).** |

## Verification

**Substitute:** None.

- `GET https://three.ws/api/three-token/stats` answered 200 on 2026-09-16 with `buyback.enabled: false`, `committed_usd: 0`, `runs: 0`, `microbuy.enabled: false`, and `protocol.total_revenue_usd: 0`.
- `/three-token` renders the same state: "$0.00 in platform revenue earned so far, $0.00 committed to buybacks at 50%".
- Gap: `/api/three-token/burns` and `/three-live` report "$THREE burned" as `agent count x 1000` (`api/three-token/[action].js` `fetchBurnEvents()` reads `agent_identities`), not from any on-chain burn, and `/dashboard/three-token` says every deploy burns 1,000 $THREE permanently. The token config states the platform never burns. Do not use those figures.

## The three questions

- **What can a holder do now?** Open `/three-token`, scroll to Programmatic Buybacks, and compare with `/api/three-token/stats`.
- **Where does $THREE enter?** Reported, not used. The ledger shows whether platform revenue has been converted into $THREE buys.
- **What verifiable result comes out?** Anyone can check the buyback switch and totals without trusting a post.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Committed share: 50% (`commit_pct`) | `/api/three-token/stats`, captured 2026-09-16 |

| Volatile figure (read on posting day) | Source |
|---|---|
| `{COMMITTED_USD}`: `buyback.committed_usd` (was 0 on 2026-09-16) | `/api/three-token/stats`, read on posting day |
| If `buyback.enabled` is true or `runs` is above 0 on posting day, use the variant below | `/api/three-token/stats` |

## Media

- File: [`images/09-buyback-ledger.png`](./images/09-buyback-ledger.png), 1600x900, captured 2026-09-16 from `/three-token` by `node marketing/three-utility-season/capture.mjs --only 09`.
- Alt text (required on every post):

> The three.ws $THREE token page scrolled to the Programmatic Buybacks panel, which reads 50% of all platform revenue to $THREE buybacks, $0.00 in platform revenue earned so far, and $0.00 committed to buybacks at 50%, with a note that each buy will appear with its Solscan receipt.

## X post

Weighted length: **175 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does; counted with the 2026-09-16 values filled in).

```text
The $THREE buyback ledger is public. It reads {COMMITTED_USD} committed today because revenue buybacks have not started; each buy will post there with a receipt. https://three.ws/three-token?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-three-receipts&utm_content=utility-post
```

**Variant:** If buybacks have started on posting day: `The $THREE buyback ledger on three.ws now shows {RUNS} buys and {THREE_BOUGHT} $THREE bought from platform revenue, each with an on-chain receipt: <link>` (count it before posting).

## Telegram

```text
What $THREE does this week: receipts you can check.
The $THREE buyback ledger on three.ws/three-token is public. Today it reads {COMMITTED_USD} committed and the buyback switch is off, because revenue buybacks have not started.
When a buy runs it appears there with its on-chain receipt. The raw numbers are at three.ws/api/three-token/stats.
https://three.ws/three-token?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-11-three-receipts&utm_content=utility-telegram
```

## User action

Open `/three-token`, scroll to Programmatic Buybacks, and compare with `/api/three-token/stats`.

## KPI and where to read it

Stats endpoint reads and linked utility actions. `three-ws-api` request logs for `/api/three-token/stats` during the week; UTM sessions for `mkt-2026-11-three-receipts`.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Read `/api/three-token/stats` within the hour before posting and fill `{COMMITTED_USD}` exactly.
- [ ] Owner decision: publishing a zero ledger is honest transparency but is a public statement that no revenue has been committed. Confirm before posting.
- [ ] Re-run `capture.mjs --only 09`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not cite burn totals from `/three-live`, `/api/three-token/burns`, or the dashboard.
- Do not cite price, market cap, or volume from the same page.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
