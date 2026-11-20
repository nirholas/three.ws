# Public-listing content safety

Every Forge model that appears on a public page (gallery, feeds, search, sitemaps, `/m/:id` indexing) passes a screen first. The screen gates LISTING only. What a person asks for or generates is never refused here (owner directive 2026-08-07); a model stays viewable by its maker and shareable by link whatever the verdict.

Code: `api/_lib/content-safety.js` (verdicts), `content-safety-store.js` (state changes and the publish gate), `content-safety-sweep.js` (recurring work), `api/cron/content-safety-sweep.js` (cron, every 5 minutes), `api/admin/content-safety.js` (admin queue). Schema: `api/_lib/migrations/20261120140000_content_safety.sql`.

## How it decides

Two signals run on the model: NemoGuard on the prompt text, and the platform vision chain on the preview render, which must answer a strict five-key boolean rubric (`sexual_explicit`, `sexual_minors`, `graphic_violence`, `hate_symbols`, `self_harm`). A reply missing any key fails that lane.

The verdict is `clear`, `blocked` or `undecided`. This gate fails closed: `undecided` (outage, timeout, unparseable reply, missing key) is never treated as clear. This is the opposite of `publish-safety.js`, which fails open on purpose.

## States (`forge_creations.safety_status`)

| Status | Meaning | Public? |
|---|---|---|
| null | never screened (private or unlisted models) | no |
| pending | publish requested, screen has not answered yet | no, retried by the sweep |
| clear | screened clean, or approved by an admin | yes, when the maker publishes |
| held | unscreenable for 6 hours, or hidden by 3 or more reports | no, waits for an admin |
| blocked | unsafe verdict; forced private | no, maker cannot publish |

Born-public models (explicit public at creation, public reconstruction or selfie avatars) are inserted `unlisted` with `publish_requested_at` set and are promoted automatically once clear. Platform seeds (`internal`) are exempt.

The sweep also backfills models that were public before the screen existed. A blocked one goes private; an undecided one is left and retried.

## Reports

Three or more distinct reporters with reason `harmful` or `likeness` set the model to `unlisted` and `held`. It is never deleted and never made private, so a pile-on cannot erase someone's model. An admin approves it back or removes it.

## Reading the queue

```
GET  /api/admin/content-safety?status=attention   held and blocked (default)
GET  /api/admin/content-safety?status=held
GET  /api/admin/content-safety?status=blocked
POST /api/admin/content-safety  {"id": "...", "action": "approve" | "remove", "note": "why"}
```

Auth is the same ops session with MFA as `/api/admin/forge-removals`. Every decision writes an append-only row to `content_safety_reviews` with the actor and note. `approve` marks the model clear. `remove` deletes it through the takedown path, except when any review row has `csam: true`: that returns 409 `evidence_hold` (see below).

## Alerts

- `Content screen blocked a Forge model` (warn): forced private, review in the queue.
- `CSAM screen hit on a public Forge model` (critical): see the runbook below.
- `Forge model held for manual safety review` (warn): a publish waited 6 hours with no answer.
- `Content safety screen is not answering` (warn): a sweep run screened 3 or more models and every one came back undecided. Nothing will publish until a screen answers. Check `NVIDIA_API_KEY` and the vision chain in `api/_lib/vision.js`; the usual causes are a retired model, an exhausted key, or a GCP billing lock (see the Vertex billing note in memory).

## CSAM runbook

A `sexual_minors` rubric hit or a NemoGuard minor category sets `csam: true`. The code forces the model private, keeps it, and pages critically. It never deletes it automatically, because the evidence must survive for the legal report.

1. Do not delete the model, its files or its review rows. `remove` is refused with `evidence_hold` while any review row has `csam: true`.
2. The owner files the report (NCMEC CyberTipline or the applicable authority) from an ESP account registered to the owner. This step cannot be automated from the code.
3. Only after the report is filed and retention requirements are met, remove the model with the takedown CLI (`docs/ops/` forge takedown) and record the note.

## Configuration

No new env vars. The text signal uses the existing publish-safety config (`NVIDIA_API_KEY`, `PUBLISH_SAFETY_*`). The image signal uses the vision chain. If neither answers, models stay pending then held; they are never published unscreened.

## Rollout

Apply migration `20261120140000` before the new code serves traffic. Read `npm run db:status` first; `npm run db:migrate` applies immediately. The new cron needs a Cloud Scheduler sync after deploy (`scripts/create-gcp-scheduler.mjs`).

## Tests

`tests/content-safety.test.js` (pure combiner and parsers) and `tests/content-safety-db.test.js` (gate, sweep, admin queue and report auto-hide against the real schema on PGlite).
