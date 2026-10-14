# pump.fun first-claims Telegram channel

A live feed of **first-time pump.fun creator fee claims**, delivered to a
Telegram channel (`@pumpfunclaims`), one message per claim.

Two kinds of claim feed this channel: an ordinary wallet withdrawing its own
coin's creator fees (the original feature), and a GitHub identity withdrawing
fees a coin delegated to it through pump.fun's fee-sharing program (the
`claim_social_fee_pda` instruction). A GitHub withdrawal is a real on-chain
payment to that GitHub identity's fee account, but it does not by itself prove
which coin paid for it, or that the GitHub user created, owns, or endorses that
coin: one fee account (a "social fee PDA") can be a shareholder on more than one
coin's `SharingConfig`, and a scammer can paste someone else's PDA, or their own
freshly-registered one, into a copycat coin's metadata. Attribution below
answers "which coin, if any, paid this" from on-chain evidence, never from the
highest-market-cap guess.

## GitHub fee-claim attribution

`api/_lib/pump-claims-attribution.js` classifies every GitHub
`claim_social_fee_pda` withdrawal into exactly one of seven labels, using two
evidence rules in order of strength, then two identity checks when neither rule
finds evidence:

1. **Transaction-attributed.** The claim transaction itself also carries a
   `DistributeCreatorFeesEvent` that pays the exact PDA being claimed. Payout
   and attribution are in the same atomic transaction, so this is the strongest
   evidence a withdrawal can have.
2. **Fee-history-attributed.** No distribution rode along with the claim, so the
   scanner walks the PDA's own transaction history backward from the claim (up
   to 40 transactions or 7 days, whichever comes first, stopping early at the
   PDA's previous claim) looking for distributions in the claim's own quote
   currency. If those distributions cover at least 90% of the amount withdrawn,
   and one coin accounts for at least 90% of what was observed, the withdrawal
   is attributed to that coin. Short of either threshold, nothing is attributed
   from history.
3. **Verified repository.** Neither rule found a paying coin, but the claiming
   GitHub login matches the repository owner linked in the coin's metadata
   (description, website, X/Telegram links, or metadata URI).
4. **Identity mismatch.** A repository link exists in the coin's metadata, but
   its owner is a different GitHub account than the one that claimed. This is
   the strongest public signal of a lookalike coin.
5. **Creator-wallet verified.** No repository link exists at all, but the claim
   recipient wallet matches the coin's on-chain creator wallet.
6. **Unresolved pooled.** No evidence rule found a payer, and the PDA has been a
   shareholder in more than one coin recently. The withdrawal is real but cannot
   be assigned to a single CA or amount.
7. **Unverified.** A real withdrawal occurred, and none of the above resolved
   it. The claim is reported; no coin is credited.

**The impersonation hold** (`assessImpersonation`) is a separate, additive gate
applied after classification. Even an attributed claim is held for review, not
posted with its celebratory framing, when the claiming GitHub account is less
than 30 days old AND either: a same-name coin on pump.fun is at least 1.5x
larger by market cap than the one the claim is about, or the metadata repository
was created less than 7 days before the claim. A new account alone is not
suspicious, and neither is a same-name coin; the combination is the pattern a
scam follows (register a lookalike account, push a repo, put it in a copycat
coin's metadata, delegate fees to it, claim them), so both conditions must hold
before a claim is held. A held claim's Telegram message and feed card
(`buildClaimCard` in `src/pump/first-claims.js`) state plainly that a withdrawal
happened and why it is held, instead of naming a coin or identity the evidence
does not support yet.

## How it works

```
pump.fun program activity
        │
        ├── creator fee claims (Pump program)
        │         │
        │         ▼
        │   scanFirstClaims()        api/_lib/pump-claims.js
        │      ├── PUMPFUN_BOT_URL indexer   (preferred)
        │      └── direct Solana RPC scan    (fallback, see "Known limits")
        │
        └── GitHub fee-PDA claims (PumpFees program, claim_social_fee_pda)
                  │
                  ├── services/pump-claims         (real-time listener, see below)
                  │      └── writes pump_fee_claims
                  │
                  ▼
            _fetchGithubClaimsFromRpc()   api/_lib/pump-claims.js
               ├── pump_fee_claims table    (preferred; populated by the listener)
               └── direct Solana RPC scan   (fallback, when the table has nothing
                   for the requested window; same evidence rules either way)
                  ├── same-tx / fee-history evidence   pump-claims-attribution.js
                  └── GitHub user + coin metadata lookups   pump-claims-github.js
        │
        ▼
pushTelegramLane()           api/_lib/pump-claims-push.js
   ├── diff against app_settings['pump_claims_push_telegram']
   ├── wallet claims deduped by signature, GitHub claims by user id + mint
   ├── oldest-first, 10 per tick, 3.5s apart
   └── Telegram sendMessage → TELEGRAM_PUMP_CLAIMS_CHAT_ID
        │
        ▼
GET /api/cron/pump-claims-push   every 5 minutes (Cloud Scheduler)
```

The same scanner also backs `GET /api/pump/first-claims` and the
`pumpfun_first_claims` MCP tool, so the channel and the API never disagree.

## The real-time listener: `services/pump-claims`

GitHub fee-PDA claims no longer depend on an RPC scan at read time, or on
`PUMPFUN_BOT_URL`, which only ever covered ordinary wallet claims. A standalone
long-lived process, [services/pump-claims](../services/pump-claims), holds a
Solana log subscription on the PumpFees program, decodes and attributes each
`claim_social_fee_pda` as it lands, and writes it into `pump_fee_claims`
(migration
[20261015080000_pump_fee_claims.sql](../api/_lib/migrations/20261015080000_pump_fee_claims.sql)).

`scanFirstClaims`'s GitHub path now reads that table first and only falls back
to the direct RPC scan described below when the table has nothing for the
requested window (a fresh deployment before the listener's backfill has run,
or the listener being down). Both paths run the exact same attribution rules,
so which one answered is invisible to a caller except for a `source` field
logged server-side. See the service's own
[README](../services/pump-claims/README.md) for how it runs, reconnects, and
backfills.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | Bot that posts. Create via [@BotFather](https://t.me/BotFather). |
| `TELEGRAM_PUMP_CLAIMS_CHAT_ID` | yes | `@pumpfunclaims`, or the `-100…` numeric id. |
| `PUMPFUN_BOT_URL` | optional | pump.fun claims indexer for **ordinary wallet claims** only. Without it, wallet claims return nothing (see below); GitHub fee-PDA claims are unaffected, served by `services/pump-claims` and its RPC fallback regardless. |
| `PUMPFUN_BOT_TOKEN` | optional | Bearer token for the indexer, when it requires one. |

The bot **must be an administrator of the channel** with permission to post.
Telegram rejects `sendMessage` from a non-admin bot to a channel with
`403: Bot is not a member of the channel chat`.

There is deliberately **no fallback** to `TELEGRAM_CHANGELOG_CHAT_ID`. This feed
is high-volume third-party coin activity; the holder changelog is a different
audience. With `TELEGRAM_PUMP_CLAIMS_CHAT_ID` unset the lane reports
`{ skipped: 'not_configured' }` and posts nothing.

Set the variables on the running service (never with `--set-env-vars`, which
replaces the entire env set):

```bash
gcloud run services update three-ws-api \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --update-env-vars TELEGRAM_PUMP_CLAIMS_CHAT_ID=@pumpfunclaims
```

## Verifying it

```bash
# 1. Is the scan returning claims at all? GitHub claims carry githubUserId and
#    attribution; wallet claims do not. An empty items array with HTTP 200 is a
#    correct result when no first-time claim of either kind happened in the
#    window, not a failure (GitHub fee-PDA claims are rare on mainnet).
curl -s 'https://three.ws/api/pump/first-claims?sinceMinutes=60&limit=5'

# 2. Does the bot have channel access? (replace $TOKEN)
curl -s "https://api.telegram.org/bot$TOKEN/getChat?chat_id=@pumpfunclaims"

# 3. Watch the lane
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="three-ws-api"
  textPayload:"pump-claims"' --freshness=1h
```

The cron returns its lane result in the response body, so a manual authenticated
call reports exactly what happened: `{ posted, scanned, backlog }`, or
`{ skipped }`, or `{ error }`.

## State and safety properties

State lives in `app_settings` under `pump_claims_push_telegram`:

```json
{ "lastTs": 1723661000, "seen": ["<tx signature>", "..."], "githubSeen": ["<githubUserId>:<mint>", "..."] }
```

- **First run seeds without posting.** Enabling the lane records what is already
  on-chain and starts posting from the next tick, so switching it on never dumps
  a backlog into the channel.
- **Wallet claims dedupe by transaction signature**, not by timestamp. Two
  claims landing in the same second are common; a timestamp-only cursor would
  silently drop the second one. `seen` is a bounded ring of 400 signatures;
  `lastTs` bounds the scan window so the ring never has to answer for anything
  older.
- **GitHub claims dedupe by GitHub user id plus mint**, in a second bounded ring,
  `githubSeen`. The same GitHub identity can submit more than one
  `claim_social_fee_pda` transaction against the same coin (a sweep followed by
  a claim, or claiming again later), each with its own signature; the channel
  announces that pairing once, the same way it announces a wallet's first claim
  once.
- **A three-hour cutoff** bounds any catch-up. A lane that has been down for a
  day drains recent claims and drops stale ones rather than replaying history.
- **State is written per message, not per run.** A tick killed mid-batch (the
  Cloud Run request deadline is shorter than a full paced run) resumes at the
  next claim instead of repeating delivered ones.
- **A DB lock** (`pump_claims_push_lock`, 240s TTL) stops overlapping ticks from
  double-posting. Every outbound request is bounded well under that TTL (each
  Telegram `sendMessage` goes through the shared `fetchUpstream` with a 10 s
  deadline and at most two attempts), which is what keeps the lock's guarantee
  true.
- **All message fields are HTML-escaped.** Claim data is third-party on-chain
  data; unescaped text could otherwise smuggle a clickable link posted under the
  platform bot's identity.

## Known limits: the RPC fallback cannot serve the wallet-claim feed

This limit is specific to **ordinary wallet claims**. The GitHub fee-claim path
(`_fetchGithubClaimsFromRpc`) always runs a direct RPC scan, independent of
`PUMPFUN_BOT_URL`; see "Verifying it" below for a live check of that path.

`scanFirstClaims` prefers the `PUMPFUN_BOT_URL` indexer for wallet claims and
falls back to a direct RPC scan of the pump program's recent signatures. **That
fallback cannot produce a useful result, and the channel will stay silent for
wallet claims without the indexer.**

Measured against mainnet on 2026-08-14:

```
getSignaturesForAddress(pump program, limit: 200)
  → 200 signatures
  → wall-clock span covered: 0 seconds
  → 172 of 200 were failed transactions
```

The pump.fun program clears its 200-signature page in under one second, so the
fallback samples a fraction of a single second of chain activity no matter what
`sinceMinutes` the caller asks for. Two consequences:

1. A claim instruction is rare relative to buys and sells, so a sample that
   small almost never contains one.
2. "First ever claim" cannot be established from one second of history, which is
   the whole point of the feed.

Paginating backwards does not fix it: at roughly 200 transactions per second,
one hour of lookback is on the order of 700k signatures.

The supported source is an indexer. `PUMPFUN_BOT_URL` points at the upstream
`pumpfun-claims-bot`, and it is **not configured on the production service**,
which is why `GET /api/pump/first-claims` currently returns `{"items":[]}` for
every window. Set it and the channel starts posting with no code change.

If no indexer is available, the alternative that fits this repo is a Helius
enhanced-transaction webhook on the pump program filtered to the claim
discriminators, received at a sibling of
[api/pump/helius-webhook.js](../api/pump/helius-webhook.js). That path is not
built yet.

## Related

- [api/_lib/pump-claims.js](../api/_lib/pump-claims.js) - the shared scanner (wallet claims and GitHub fee-PDA claims)
- [api/_lib/pump-events.js](../api/_lib/pump-events.js) - typed Pump/PumpFees event decoder (wraps `@nirholas/pump-sdk`)
- [api/_lib/pump-claims-attribution.js](../api/_lib/pump-claims-attribution.js) - the evidence rules, the seven labels, and the impersonation hold
- [api/_lib/pump-claims-github.js](../api/_lib/pump-claims-github.js) - GitHub identity and coin-metadata lookups used by attribution
- [api/_lib/pump-claims-push.js](../api/_lib/pump-claims-push.js) - the delivery lane
- [api/cron/pump-claims-push.js](../api/cron/pump-claims-push.js) - the cron entry point
- [src/pump/first-claims.js](../src/pump/first-claims.js) - `buildClaimCard`, the shared held/attributed/claimed view model
- [api/_lib/commit-feed-push.js](../api/_lib/commit-feed-push.js) - the sibling commit feed this lane mirrors
