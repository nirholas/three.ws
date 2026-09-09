# Fade Radar: the wallets that are never right

Fade Radar is the inverse of the [Smart Money Radar](./smart-money.md). Smart Money asks who reputable is buying a coin. Fade Radar asks how much of a coin's buy side has never once been right, and answers with a 0 to 100 fade score, a verdict, and the measured odds behind that verdict.

Page: [/fade](https://three.ws/fade)

API: `/api/pump/fade` (live coin board, per-coin read, reverse-indicator wallet board, calibration).

## Why it exists

Most pump.fun launches die quietly, and the wallets that buy them are not random. A large group of addresses has been observed buying dozens of coins with a known outcome and has never held one that graduated or tripled. They are the exit liquidity every dead launch is built on, and they cluster: when several of them show up on the same fresh coin, that coin is overwhelmingly a coin nobody else wants.

That is a signal you cannot read off a chart in the first minutes of a launch, and it is the honest mirror of the smart-money read: instead of asking whether proven winners are here, it asks whether proven losers are all that is here.

**This is not a short.** Nothing on a bonding curve can be sold before it is bought, so the only tradeable form of a fade is not buying. Fade Radar never emits a trade, never inverts a position, and nothing on the page signs anything.

## The definition

A **reverse indicator** is a wallet where both hold:

- the graph has watched it buy at least **5** coins whose outcome is already known (`trades_seen >= 5`), and
- **zero** of those coins won (`winners = 0`).

A **win** is a coin that graduated to an AMM, or peaked at 3x or better on market cap. Both come from `pump_coin_outcomes`, the same labelled ground truth the Coin Intelligence engine learns from. A wallet below the 5-coin bar is simply new, not bad, and never appears here.

Reverse-indicator status is read live from `smart_wallet_reputation`, the wallet graph that `api/cron/smart-money-graph` maintains, so the fade side is exactly as fresh as the smart side and needs no job of its own.

## The score

For one coin, over its observed non-creator buyers (`pump_coin_wallets`):

```
buyerShare  = reverse-indicator buyers / observed buyers
volumeShare = reverse-indicator buy lamports / observed buy lamports
fade_score  = round(100 * (0.6 * buyerShare + 0.4 * volumeShare))
```

Buyers and volume are both counted because they fail differently: ten dust wallets are a crowd with no conviction, one large reverse-indicator buy is conviction with no crowd, and a coin wants to be clean of both. When no buy volume has been recorded yet, the buyer share carries the whole score rather than being halved by a zero that means nothing.

The verdict follows the buyer share:

| Verdict | Condition |
| --- | --- |
| `unknown` | fewer than 5 observed buyers, too thin to read |
| `clear` | no reverse indicator among the buyers |
| `caution` | some reverse-indicator presence, under 25 percent of buyers |
| `avoid` | 25 percent of buyers or more |

The creator is excluded from every count: a dev holding its own supply is a different signal, already carried by dev-sold and concentration, and would otherwise count once in every coin it launched.

## The calibration, and why it is honest

A wallet's record is built from coin outcomes, so scoring the same coins that record was built on would grade the signal on its own answer sheet. `getFadeCalibration` avoids that with a time split:

1. Take every labelled coin and split the history in half by label time.
2. Rebuild the reverse-indicator cohort using **only** coins labelled in the earlier half.
3. Measure how often coins labelled in the **later** half went on to win, by band.

The later-half coins could not have contributed to the cohort that grades them, so the result is out of sample. On the history as of 2026-09-09, over 26,626 labelled coins:

| Band | Coins | Went on to win |
| --- | --- | --- |
| `clear` | 22,473 | 22.1 percent |
| `caution` | 3,541 | 15.7 percent |
| `avoid` | 612 | 1.8 percent |

A coin in the `avoid` band won at roughly one twelfth the baseline rate. The numbers are recomputed from live history at most every 12 hours and cached in `app_settings` under `fade_radar_calibration`, so the page always shows a measurement rather than a claim.

This is a probabilistic read on a hostile market. It is not a prediction and not advice: a `clear` coin can still go to zero.

## API

```bash
# Live board: coins launched in the last 6 hours with proven-losing money in them
curl 'https://three.ws/api/pump/fade?hours=6&limit=40'

# One coin, with the reverse-indicator wallets inside it
curl 'https://three.ws/api/pump/fade?mint=<mint>'

# The reverse-indicator wallets themselves, worst record first
curl 'https://three.ws/api/pump/fade?wallets=1&min_judged=8&active_hours=24'

# The measured, out-of-sample odds behind the bands
curl 'https://three.ws/api/pump/fade?calibration=1'
```

A coin read returns:

```json
{
  "mint": "<mint>",
  "score": 86,
  "verdict": "avoid",
  "buyers": 5,
  "ri_buyers": 4,
  "ri_buyer_share": 0.8,
  "ri_volume_share": 0.959,
  "confidence": "medium",
  "notable": [{ "wallet": "<address>", "judged_buys": 41, "winners": 0, "losers": 41 }],
  "summary": "Heavy reverse-indicator presence: 4 of 5 observed buyers (80%) and 96% of the buy volume come from wallets with no winner on record. Fade score 86.",
  "computed": true
}
```

A coin the engine has not observed resolves `200` with `computed: false` rather than a 404, matching the intel and smart-money detail endpoints, so a detail page can always render. Every read degrades the same way: a missing database or a failed query returns the well-formed zero-data shape instead of throwing.

## Using it from an agent

```js
import { getFadeForMint } from '../api/_lib/fade-radar.js';

const fade = await getFadeForMint(mint);
if (fade.computed && fade.verdict === 'avoid') {
  // Skip. Coins in this band won 1.8% of the time against a 22% baseline.
  return { decision: 'PASS', why: fade.summary };
}
```

The module is a pure read layer with no side effects, and `fadeScore` / `fadeVerdict` / `fadeSummary` are exported as pure functions so a caller can score a buy side it already has in hand without a database round trip.

## Where it fits

- [Smart Money Radar](./smart-money.md): the same graph read from the winning side. A wallet on the fade board links straight to its full track record there.
- [Coin Intelligence](./trading-surfaces.md): the engine that records every launch, labels its outcome, and produces the ground truth both radars stand on.
- [Coin Radar](./radar.md): what launched in the last 90 seconds, where a fade read is the fastest reason to skip one.

## Files

| Path | What it holds |
| --- | --- |
| `api/_lib/fade-radar.js` | The read layer: scoring, the coin board, the wallet board, the calibration |
| `api/pump/fade.js` | The public HTTP surface |
| `pages/fade.html`, `src/fade-radar.js` | The page |
| `tests/fade-radar.test.js` | The scoring contract |
