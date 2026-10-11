# Sentiment Scout: momentum with receipts

Most "alpha" is a claim with nothing behind it: a post says a coin is running,
a bot says sentiment is bullish, and nobody can check either. The Sentiment
Scout ranks the last hour of pump.fun launches by momentum and backs every
single claim with its receipt: where it came from, when it was true, and, for
anything social or paid, what the chain showed at that same moment. It never
trades.

Surfaces: the **Scout** tab on [Coin Intelligence](https://three.ws/coin-intel?tab=scout)
(`/coin-intel?tab=scout`) · the **Sentiment Scout** section in every coin's
detail drawer on `/coin-intel` · the Scout card on [trade receipts](./trade-receipts.md)
· `GET /api/pump/sentiment-scout` · the `sentiment_scout` MCP tool · an opt-in
context block for LLM-judged sniper strategies.
Model: `api/_lib/sentiment-scout.js` · X client: `api/_lib/x-search.js` ·
Notes: `api/_lib/scout-notes.js` · Page module: `src/coin-intel-scout.js`

## What a candidate looks like

```json
{
  "mint": "…pump",
  "ticker": "$EXAMPLE",
  "momentum_score": 71,
  "score_parts": { "volume": 29.5, "buyers": 24.8, "buy_pressure": 8.4, "smart_money": 0, "curve": 9, "social": 9.7, "risk_penalty": -10 },
  "evidence": [
    { "type": "volume_spike", "detail": "56.5 SOL bought in its first 90s, top 2% of 1241 launches in the window (median 0.59 SOL)",
      "source": "https://three.ws/api/pump/coin-intel?mint=…", "at": "2026-09-29T06:48:22.420Z" },
    { "type": "social_mention", "platform": "x",
      "detail": "19 X posts quoted this exact contract address, from 15 accounts; most-followed @… (36k followers): \"…\"",
      "source": "https://x.com/…/status/…", "at": "2026-09-29T06:56:02.000Z",
      "checked_against": "On-chain at 07:03 UTC: 56.5 SOL bought by 74 wallets in the first 90s; graduated to pumpswap" }
  ],
  "caution": "1 other coin named $EXAMPLE launched in the same window; check you have the right mint.",
  "market_check": { "checked_at": "…", "early_buy_volume_sol": 56.5, "early_buyers": 74, "graduated": true, "bonding_progress_pct": 100 },
  "x": { "posts": 19, "authors": 15, "top_poster_share": 0.16, "most_followed": { "username": "…", "followers": 36000 } },
  "posts": [ { "url": "https://x.com/…/status/…", "author": "…", "followers": 36000, "at": "…", "text": "…" } ],
  "note": "Two sentences written from the evidence above, or null",
  "unavailable": ["callouts"]
}
```

Every evidence line carries:

- **`source`**: a URL that returns the fact (the Coin Intelligence row, the
  pump.fun coin page, the X post, or the x402 payment transaction on Solscan).
- **`at`**: when the fact was true. Launch-window facts are stamped at the end
  of the coin's observation window; the curve at the moment it was read; a post
  at the moment it was posted.
- **`checked_against`** (social, paid and news lines): the on-chain facts read
  in the same run, so a loud post sits right next to the chart that did or did
  not back it up.

## Where the evidence comes from

| Type | Source | Notes |
|---|---|---|
| `volume_spike`, `fresh_buyers` | `pump_coin_intel` (the Coin Intelligence Engine, see [trading surfaces](./trading-surfaces.md)) | Ranked as percentiles against every launch in the same window. The median launch has one buyer, so "40x the median" would be noise. |
| `smart_money` | `pump_coin_intel.smart_money_*` | Wallets with a profitable pump.fun record that bought early. |
| `graduation_approach` | live bonding curve (pump.fun) | Read at scout time. |
| `social_mention` (X) | X recent search for the coin's **exact contract address** | A ticker matches thousands of coins; a 44-character address matches one. Retweets are excluded so one account cannot count many times. |
| `social_mention` (pump.fun) | pump.fun callouts | pump.fun now serves these only to signed-in sessions, so they usually appear under `unavailable`. |
| `paid_signal` | `sniper_coin_sentiment` | A paid Crypto Intel read over x402, linked to its payment transaction. Reads older than 6 hours are ignored. |
| `news_match` | `pump_coin_intel.signals.news_headline` | The coin's name matches a live news story. |

A source that could not be read is named in `unavailable` and left out. It is
never estimated.

## How it ranks and screens

1. Every coin observed in the last `window` minutes (15 to 240, default 60).
2. A coin qualifies only with 3+ distinct buyers, top-quartile early buy volume,
   and no `bundle_launch` or `dev_dumped` flag.
3. The strongest shortlist is enriched (curve, X, callouts, paid reads) and
   scored 0 to 100: volume 30, buyers 25, buy pressure 10, smart money 10,
   curve 15, social 10, minus risk penalties. The parts are returned in
   `score_parts` and shown behind **Why 71?** on the page.
4. One caution line per coin, deterministic and worst-first: a dumped dev, a
   bundled launch, a curve back near 0% after heavy early buying (the early
   buyers already sold), a single whale, a fresh-wallet swarm, **X chatter that
   is mostly one account** (promotion, not interest), heavy top-10
   concentration, copycat tickers, a bearish paid read, sell pressure, snipers.

Social attention counts distinct accounts, not posts. Twenty posts from one
account score lower than three posts from three accounts, and cost a penalty.

## The Scout's read (the LLM layer)

Each board candidate can carry a two-sentence `note` written by the platform's
LLM failover chain (`api/_lib/llm.js`) from that candidate's evidence lines and
nothing else. No note is trusted as written: `validateScoutNote()` drops any
note that contains a number the evidence does not hold (digits or spelled out),
names a ticker other than the candidate's own or $THREE, carries a link, or
makes a promise ("guaranteed", "buy now"). A dropped note is never repaired;
the card simply shows its evidence. The page loads the evidence first and fills
the notes in when the chain answers, so a slow chain never holds the board.

## Graded, not claimed

Every board candidate is recorded in `sentiment_scout_reads` (migration
`20260929120000_sentiment_scout_reads.sql`): the first sighting (score,
evidence, caution) is written once and never changes, and the latest read
overwrites the rest. Two things read it:

- **The track record** (`?track=1`, shown above the board): of the coins the
  Scout flagged in the last 14 days that now have an outcome label, how many
  graduated or pumped, next to the same rate for every labeled launch the
  engine watched over the same days, and split by score band. A scout that
  cannot beat the base rate is noise, and this is where a reader finds out.
- **Trade receipts**: when the Scout had flagged a coin before an agent bought
  it, the receipt shows the Scout's first flag with its sources, tagged
  "before entry". A flag recorded after the exit is dropped.

## The API

```bash
# The board: the top 5 candidates from the last hour, with the track record
curl "https://three.ws/api/pump/sentiment-scout?limit=5&track=1"

# One coin, even if it would not make the board
curl "https://three.ws/api/pump/sentiment-scout?mint=<mint>"

# Evidence only, no LLM-written notes (fastest)
curl "https://three.ws/api/pump/sentiment-scout?notes=0"
```

| Param | Default | Meaning |
|---|---|---|
| `window` | `60` | Minutes of launches to rank against, 15 to 240. |
| `limit` | `5` | Candidates, 1 to 10. |
| `mint` | none | Read one coin. The response adds `qualifies` (would it clear the screen) and `scouted` (when it first made the board). |
| `notes` | `1` | `0` skips the LLM-written note. |
| `track` | `0` | `1` adds `track_record`. |
| `network` | `mainnet` | `mainnet` or `devnet`. |

Public, CORS-open, IP rate-limited, cached for 30 seconds. Errors use the
platform shape `{ error, error_description }`: `invalid_mint`, `invalid_network`.

## The MCP tool

`sentiment_scout` on the main three.ws MCP server (`/api/mcp`), next to
`trade_receipt`. Arguments: `mint`, `network`, `window_minutes`, `limit`,
`track_record`. It returns the same board plus `board_url`. Read-only; like
every tool there it needs an OAuth token or an x402 payment. See
[MCP](./mcp.md).

## For strategy builders: Scout context for the LLM judge

An LLM-judged sniper strategy (`decision_mode: 'llm'`) can opt in with
`llm_scout_context: true` on `POST /api/sniper/strategy`. Its judge is then
handed the Scout's read of the coin (momentum score, every evidence line, the
caution) alongside the launch brief, built from the coin's intel row, a cached
one-hour window, the latest paid read and any X posts the board already
recorded, with no network call on the hot path. The read only exists once a
coin has been observed, so in practice it feeds `intel_confirmed` arms. It is
off by default so every running experiment keeps asking the question it was
asking; an arm with it on is marked **+ Scout** on
[/sniper/experiments](https://three.ws/sniper/experiments).

## X search budget

X recent search is metered per app per 15 minutes. The Scout only searches
shortlisted candidates, caches each coin's posts for 10 minutes (a failed read
for 1 minute), and stops searching once the remaining quota drops below a
reserve, so it can never exhaust the quota other X features share.
Credentials: `X_BEARER_TOKEN`, or the app key pair `X_API_KEY` / `X_API_SECRET`
from which an app token is minted. Without them X posts are listed as
unavailable and everything else works.

**Second rung: xAI's `x_search` tool.** When the bearer rung above cannot
answer (not configured, rate limited, or X itself down) and an xAI key
(`GROK_API_KEY` or `XAI_API_KEY`) is configured, `searchMintPosts` falls over
to a second, independent read of the same data: xAI's `x_search` tool on its
Responses API (`POST https://api.x.ai/v1/responses`). Grok runs the search
server-side and is instructed to answer with a strict JSON array of matching
posts, parsed defensively into the same post shape the bearer rung returns
(engagement counts and author detail the tool does not expose are left null
rather than invented). That answer is untrusted model output, never
instructions. Every xAI call is billed per call, so a daily cap
(`XAI_X_SEARCH_DAILY_CAP`, default 200, counted in Postgres `app_settings` so
it holds across instances) stops the rung for the rest of the day once
reached; callers then see the same `unavailable` shape as any other outage.
Code: `searchMintPostsViaXai` / `parseXaiSearchPayload` in
`api/_lib/x-search.js`.

## Related

- [Trading surfaces](./trading-surfaces.md): Coin Intelligence and the launch data
  every volume and buyer line is measured from.
- [Trade receipts](./trade-receipts.md): where a Scout flag shows up on a trade.
- [Copy Coach](./copy-coach.md): the guided first copy, which links here.
