# @trythreews relaunch checklist (2026-11-15)

Auto-publishing stays off (`X_CONTENT_AUTO_PUBLISH` unset) until every item
below is done. Everything discussed with the owner on 2026-11-15 is built
and tested. What is left is owner-gated or depends on paid providers. How
the pipeline works is in [x-content-pipeline.md](./x-content-pipeline.md).

## What was built

| Asked for | Where it lives |
|---|---|
| Posts stop reading as AI-written | Voice check and drafter/editor rules: [voice.js](../api/_lib/x-content/voice.js) |
| Different readers (developers, teachers, students, founders) | `audience` per item, rotated by the ranking |
| Posts stop looking the same | Head-shape rotation, plus feed-format rotation across video, GIF, still, text and Article |
| Every X format | Code cards, live page captures, polls, GIFs, AI key art, filmed reels, Articles ([formats.js](../api/_lib/x-content/formats.js)) |
| Highest-priority posts first | Volume model, learned lifts and the priority score; `plan` prints every part |
| More than one post a day | Five daily slots plus an Article every second evening |
| Live-page checks | Links resolved at review and again seconds before sending; probes and proof reels |
| Never silently stop | Quiet-account alert after 24 hours, missed-slot alerts, low-stock alerts |
| Unattended refill | Daily `advance --refresh --ship` in the partner job ([refresh.js](../api/_lib/x-content/refresh.js)) |
| Learn from results | Outcomes read back from X, lifts in the ranking ([outcomes.js](../api/_lib/x-content/outcomes.js)) |
| Which posts bring signups | First-touch X attribution per landing page, shown in `plan` ([acquisition.js](../api/_lib/acquisition.js)) |
| Fast owner approval | `x_post` requests in the approval inbox with a full preview ([owner-approval.js](../api/_lib/x-content/owner-approval.js)) |
| Mine existing content | Unshared blog posts, changelog news per page, re-cuts of past hits ([mining.js](../api/_lib/x-content/mining.js)) |

## Owner-gated steps, in order

1. **Push** the local commits: `git push threews main`.
2. **Deploy** (`npm run deploy:gcp:full`). That ships the acquisition middleware, the
   approval media route (`GET /api/approvals/:id?media=n`) and the inbox preview.
3. **Approval delivery.** The owner account has no web push subscription and no
   paired Telegram or Discord chat, so a request falls back to email, which needs
   `RESEND_API_KEY` on `three-ws-api`. Pairing Telegram from `/approvals`, or turning
   on push from the bell, gives one-tap approval on the phone.
4. **Alerts.** Set `TELEGRAM_ALERTS_CHAT_ID`, or `OPS_ALERT_EMAILS` together with
   `RESEND_API_KEY`, so the quiet, missed-slot and low-stock alerts reach someone.
5. **Refill job.** Create the scheduled Cloud Run Job:
   `node scripts/create-x-partners-job.mjs --job refill --apply` ([the script](../scripts/create-x-partners-job.mjs)).
6. **Stock.** Run `npm run x:content -- advance --ship` until `plan` shows at least
   three days of approved stock per tier. Then work through `backlog` for new drafts.
7. **Switch on**: `gcloud run services update three-ws-api --region us-central1 --update-env-vars X_CONTENT_AUTO_PUBLISH=true`.

## Known blockers

- Paid model providers are down for billing (Vertex since 2026-11-01; Groq, OpenAI and
  OpenRouter as well). The editor still runs on NVIDIA NIM, but stock builds slowly
  until billing is restored.
- `/api/tts/synthesize` answers 502, so narrated reels cannot be made until it is fixed.
- The account sends no automated replies, to stay inside X's automation rules.
