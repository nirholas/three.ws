# Turning the X mention bot on (order 928)

The bot (`@trythreews`) runs in dry run in production: `GET /api/x/mention-bot/status` reports `mode: dry_run`. Going live takes one deploy plus one env change. It is public and hard to take back, so it is the owner's call, made on the evidence below. How the switch works in code is in [docs/x-mention-bot.md](../x-mention-bot.md#going-live).

## What the switch does (and did not do before 2026-11-14)

Until the order 928 change, `X_MENTION_BOT_LIVE=1` had no effect on the company account: `handleMention` always recorded company mentions as dry run, and only agent accounts (OAuth2 token resolvers) could post. Also, a `make` mention was answered with the generic help text. Both are fixed: with the flag set and the four company credentials present (`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`), @trythreews replies through `companySender()` (`api/_lib/x-company-sender.js`), and `make` returns a 3D model. Production needs a deploy of that commit before the flag means anything.

Only mentions recorded after the flip are answered live. Rows recorded in dry run are never posted retroactively.

## Evidence (pulled 2026-11-14 from `x_mention_events`)

`node scripts/x-mention-review-sample.mjs --limit 30` gives a read-only, intent-stratified sample of the ledger that `/x/ops` shows. Re-run it right before the switch. It exits 1 if any sampled row would break a live-reply rule: over 280 characters, a dash glyph, a reply decision without text, a live reply without a post id, or an unsafe decision that reached X. Unsafe rows carry the fixed refusal for the audit trail and never send it. The output quotes other people's posts, so it is never committed.

All-time ledger on 2026-11-14:

| Intent | reply | skip | other |
| --- | --- | --- | --- |
| avatar | 14 | | |
| chat | 354 | 292 | rate_limited 37 |
| help | 80 | 52 | |
| ignore | | 370 | |
| image3d | 11 | 6 | unsafe 3 |
| make | 7 | 1 | undecided 1 |

The 30-row sample covered every intent that has rows. Every reply is under 280 characters with no dash glyph, and every row is `dry_run`. The one undecided `make` row belongs to the `trythreews-evidence` account, an evidence run, not the live account. Production status on 2026-11-14: 5 replies in the last 24 hours, 1 second median.

## Cost ceiling

X pay-per-use bills about $0.015 per post and $0.200 per post that carries a URL. Most bot replies carry a three.ws link. The post caps in `api/_lib/x-budget.js` (80 a day, 1500 a month) therefore bound the worst case at about $16 a day and $300 a month. Mention reads cost $0.001 each, capped at 15000 a month (about $15). To tighten the caps without a deploy, set `X_MENTION_DAILY_POST_CAP` and `X_MENTION_MONTHLY_POST_CAP`.

## Order of operations

1. Deploy current main. Production served `518f61469` on 2026-11-14. Follow `.claude/skills/deploy-runbook/SKILL.md`: `npm run prep:worktree -- --apply`, then `npm run build:gcp` in the worktree, run the `deploy-preflight` agent, then `npm run deploy:gcp:submit`, `npm run deploy:gcp:sync-crons` and `npm run deploy:gcp:purge-cdn`. Confirm the new commit with `curl -s https://three.ws/api/version`.
2. Account changes on @trythreews (owner, in X settings):
   - Turn on the automated-account label, naming the managing account (Settings, Your account, Account information, Automation).
   - Set the bio line below.
   - Post the how-to below and pin it.
3. Switch on: `gcloud run services update three-ws-api --region us-central1 --update-env-vars X_MENTION_BOT_LIVE=1`. Always use `--update-env-vars`, never `--set-env-vars`, which replaces every env var on the service.
   - For a narrow launch that answers only `make` and `help`: `gcloud run services update three-ws-api --region us-central1 --update-env-vars '^:^X_MENTION_BOT_LIVE=1:X_MENTION_COMPANY_INTENTS=make,help'`. The `^:^` prefix makes `:` the pair separator, so the comma stays inside the value. Every other intent is recorded `skip` / `intent_not_allowed:<intent>`.
4. Watch the first 24 hours:
   - In `/x/ops`, check each live reply row by row against the guard rules.
   - `/api/healthz` must show the mention-bot subsystem as `ok`.
   - `/api/x/mention-bot/status` must read `mode: live`.
   - Re-run the review sample; it must exit 0.

Rollback, immediate and reversible: `gcloud run services update three-ws-api --region us-central1 --update-env-vars X_MENTION_BOT_PAUSED=1`. The tick then stops before reading anything. To return to dry run instead, run `--remove-env-vars X_MENTION_BOT_LIVE`.

## Drafts (not posted)

Bio line: `Automated account. Mention me with "make a red vintage scooter" and I reply with a 3D model you can spin. three.ws/grok`

Pinned how-to post:

> I'm the three.ws bot. Mention me with what you want and I reply with a 3D model you can spin in the browser.
>
> make a red vintage scooter
> make me an avatar (uses your profile picture)
> help
>
> More at three.ws/grok

Replies go only to the author who mentioned me. Each mention gets one reply, with rate limits per author and per conversation.
