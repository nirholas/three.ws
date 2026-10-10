# Event Markets

A free-to-play "who wins this?" market for every three.ws event, with the entrants as outcomes. Picks carry points, never funds. Build briefs: [docs/prompts/event-markets/](prompts/event-markets/README.md). Core module: `api/_lib/event-markets/`.

## Announcements

A market that is not announced does not get picks, and the announcement is what tags the entrants so they show their own audiences. The announcement lane writes the drafts, holds them for review, and sends only what the owner approved.

### The flow

1. **Cron drafts.** `/api/cron/event-market-announce` (every 15 minutes) scans open, locked and resolved markets and writes a draft per kind that is due. It never posts and never approves. It reads market state directly (status, lock time, picks), so a missed tick catches up on the next one.
2. **Review.** `/admin/event-market-announcements` lists drafts. Edit, reject, approve one, or approve a batch in one action. Editing sends an approved draft back to review, so the text that goes out is always the text that was approved.
3. **Send.** `api/_lib/event-markets/poster.js` is the only sender. It refuses anything not `approved`, re-checks the text, enforces the daily cap, and sends nothing unless the flag is on and the call is not a dry run.

### Kinds

| Kind | When | Content |
| --- | --- | --- |
| `opened` | the market is open | the question, the entrants (tagged where linked), the link |
| `locking_soon` | within `lockingSoonHours` of the lock | time left, the current leader and its share, or an honest "no picks yet" |
| `odds_shift` | the leader changed, or gained `oddsShiftPoints` since the market opened, with at least `minPicksForOddsShift` picks | the new leader and pick count |
| `resolved` | a winner is set | the winner, the crowd's share, the first forecasters to call it, the market page as evidence |

One announcement per kind per market, enforced by a unique key on `(market_id, kind)`. A rejected draft is a decision and is not refilled. Numbers live in `data/event-markets-announcements.json`.

### Tagging rules

- A handle is tagged only when the entrant linked it to their own account through X OAuth: an agent's own connection (`agent_x_connections`), else its owner's (`social_connections`). Handles are never scraped, guessed or typed in by an admin: an edit may not add an `@` mention that is not in the draft's `tags`.
- An entrant with no linked handle is named, not tagged.
- An entrant who opted out (`event_market_entrant_prefs`) is neither tagged nor featured. The drafter reads `taggableEntrants`, the same source the entrant notifications use.
- At most three tags per post, dropped last-first until the post fits 280 characters.

### Voice

Every draft passes the house editorial lint (`api/_lib/x-content/editorial.js`: brand spelling, no price promises, no slang, no engagement asks). Copy is positive and states only what the market's own data says. No other coin is named.

### Enabling posting (owner steps)

Posting is off by default. Dry run is always safe:

```
POST /api/event-markets/announcements  { "action": "send", "id": "<uuid>" }
```

It returns `would_send.text`, the exact text and the call a live send would make, and changes nothing. To send for real, the owner approves the drafts in the queue, then enables the flag and sends with `dry_run: false`:

```
gcloud run services update three-ws-api --region us-central1 --update-env-vars EVENT_MARKET_ANNOUNCE_POST=on
POST /api/event-markets/announcements  { "action": "send", "id": "<uuid>", "dry_run": false }
```

What the owner must approve: (1) the posts themselves, one by one or as a batch in the queue, and (2) turning the flag on. Posts go out from @trythreews through the same `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` credentials as the x-content publisher. A daily cap (`dailyCap`, default 4 posts per rolling 24 hours) applies on top.

### Table

`event_market_announcements`: `market_id`, `kind`, `draft_text`, `card_url`, `tags`, `status` (`draft`, `approved`, `posting`, `posted`, `rejected`), `approved_by`, `posted_at`, `post_url`, `baseline` (odds snapshot at draft time). `posting` is the poster's in-flight claim, so two ticks never send one draft twice.

Tests: [tests/event-market-announcements.test.js](../tests/event-market-announcements.test.js).
