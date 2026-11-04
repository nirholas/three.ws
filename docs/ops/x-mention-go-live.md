# Turning the X mention bot on (order 928)

The bot (`@trythreews`) runs in dry run in production: `GET /api/x/mention-bot/status` reports `mode: dry_run`. Going live is one deploy plus one env change. It is public and hard to take back, so it is the owner's call, on the evidence below.

## Evidence (pulled 2026-11-04 from `x_mention_events`)

`node scripts/x-mention-review-sample.mjs --limit 30` is a read-only, intent-stratified sample of the ledger `/x/ops` shows. Re-run it right before the switch; it exits 1 if any sampled row would break a live-reply rule (over 280 characters, a dash glyph, a reply decision without text, an unsafe decision carrying text).

All-time ledger: avatar/reply 14; chat/reply 281, skip 201, rate_limited 33; help/reply 50, skip 37; ignore/skip 326; image3d/reply 9, skip 6, unsafe 2; make/reply 7, skip 1. The 30-row sample covered every intent that has rows and had zero guard problems. Every `unsafe` decision carried no reply text. Production status reports 14 replies in the last 24 hours and a 3 second median.

One thing to know: a 2026-10-12 `make` row replied with the generic help text (reason `handler_not_built`), written before the make handler shipped. It is history, not current behaviour; the sample script shows any recent recurrence.

## Order of operations

1. Deploy the current main (production still serves `0a913e8a7`): `npm run prep:worktree -- --apply`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`. Run the `deploy-preflight` agent first.
2. Account changes on @trythreews (owner, in X settings): turn on the automated-account label and name the managing account; set the bio line below; post and pin the how-to below.
3. Switch on: `gcloud run services update three-ws-api --region us-central1 --update-env-vars X_MENTION_BOT_LIVE=1` (always `--update-env-vars`, never `--set-env-vars`).
4. Watch the first 24 hours in `/x/ops` (each live reply row by row against the guard rules) and in `/api/healthz` (the mention-bot subsystem must read `ok`).

Rollback, immediate and reversible: `gcloud run services update three-ws-api --region us-central1 --update-env-vars X_MENTION_BOT_PAUSED=1`. To return to dry run instead, remove `X_MENTION_BOT_LIVE`.

If a subset is preferable at launch, allow only `make` and `help`; say so in the go-live note.

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

Replies go only to the author who mentioned me, one reply per mention, with rate limits per author and per conversation.
