# Public-listing content safety

Every Forge model that appears on a public page (gallery, feeds, search, sitemaps, `/m/:id` indexing) passes a screen first. The screen gates LISTING only. What a person asks for or generates is never refused here (owner directive 2026-08-07); a model stays viewable by its maker and shareable by link whatever the verdict.

Code: `api/_lib/content-safety.js` (verdicts), `content-safety-store.js` (state changes and the publish gate), `content-safety-sweep.js` (recurring work), `api/cron/content-safety-sweep.js` (cron, every 5 minutes), `scripts/forge-safety.mjs` (the review CLI, `npm run forge:safety`). Schema: `api/_lib/migrations/20261120140000_content_safety.sql`.

## How it decides

Two signals run on the model: NemoGuard on the prompt text, and the platform vision chain on the preview render, which must answer a strict five-key boolean rubric (`sexual_explicit`, `sexual_minors`, `graphic_violence`, `hate_symbols`, `self_harm`). A reply missing any key fails that lane.

The verdict is `clear`, `blocked` or `undecided`. This gate fails closed: `undecided` (outage, timeout, unparseable reply, missing key) is never treated as clear. This is the opposite of `publish-safety.js`, which fails open on purpose.

## States (`forge_creations.safety_status`)

| Status | Meaning | Public? |
|---|---|---|
| null | never screened (private or unlisted models) | no |
| pending | publish requested, screen has not answered yet | no, retried by the sweep |
| clear | screened clean, or approved by an admin | yes, when the maker publishes |
| held | unscreenable for 6 hours, hidden by 3 or more reports, or requested by an account with repeat blocks | no, waits for an admin |
| blocked | unsafe verdict; forced private | no, maker cannot publish, and the model is viewable only by its maker (no share link, no social preview card) |

Born-public models (explicit public at creation, public reconstruction or selfie avatars) are inserted `unlisted` with `publish_requested_at` set and are promoted automatically once clear. Platform seeds (`internal`) are exempt.

The sweep also backfills models that were public before the screen existed. A blocked one goes private; an undecided one is left and retried.

## Repeat abuse

An account with 3 or more blocked models in 30 days (`REPEAT_BLOCK_THRESHOLD` and `REPEAT_BLOCK_WINDOW_DAYS` in `api/_lib/content-safety-store.js`) pages the operator (`Repeat content-screen blocks from one account`, naming the account id and the count, never a prompt). Its later publish requests are held for an operator even when the screen clears them, and the review row notes why. Only signed-in accounts count: the anonymous browser key is a shared bucket, so it never flags anyone. A block an admin approves stops counting, so a false positive clears itself. Generation is never refused; only public listing waits.

## Reports

Three or more distinct reporters with reason `harmful` or `likeness` set the model to `unlisted` and `held`. It is never deleted and never made private, so a pile-on cannot erase someone's model. An operator approves it back or removes it.

## Reading the queue

There is no admin page and no admin HTTP endpoint for this queue. An operator reviews it from a workstation with their own gcloud login, so the public server exposes nothing that can approve or delete a model.

```
npm run forge:safety -- --prod-env                      held and blocked (default)
npm run forge:safety -- --prod-env --status held
npm run forge:safety -- --prod-env --status blocked
npm run forge:safety -- --prod-env approve <id> --note "why it is fine"
npm run forge:takedown -- <id> --prod-env --apply --reason harmful --resolution "why"
```

`--prod-env` reads `DATABASE_URL` from the `three-ws-api` Cloud Run service into the process only; nothing is written to disk. The listing prints each model's link, prompt (as data, control characters stripped), preview, verdict and categories, followed by the command to approve or remove it. `approve` marks the model clear and writes an append-only row to `content_safety_reviews` with the operator (`admin:cli:<user>`) and the note. A held model then goes public on the next sweep; a blocked one stays private until its maker publishes it. Removal goes through `forge:takedown`, which refuses (exit 4) any model with a `csam: true` review row unless `--evidence-released` is passed (see below). Such models are marked `EVIDENCE HOLD` in the listing and get no remove command.

## Alerts

- `Content screen blocked a Forge model` (warn): forced private, review with `npm run forge:safety -- --prod-env`.
- `CSAM screen hit on a public Forge model` (critical): see the runbook below.
- `Repeat content-screen blocks from one account` (warn): see Repeat abuse above.
- `Forge model held for manual safety review` (warn): a publish waited 6 hours with no answer.
- `Content safety screen is not answering` (warn): a sweep run screened 3 or more models and every one came back undecided. Nothing will publish until a screen answers. Check `NVIDIA_API_KEY` and the vision chain in `api/_lib/vision.js`; the usual causes are a retired model, an exhausted key, or a GCP billing lock (see the Vertex billing note in memory).

## CSAM runbook

A `sexual_minors` rubric hit or a NemoGuard minor category sets `csam: true`. The code forces the model private, keeps it, and pages critically. It never deletes it automatically, because the evidence must survive for the legal report.

1. Do not delete the model, its files or its review rows. `npm run forge:takedown` refuses the model (exit 4, nothing changed) while any review row has `csam: true`.
2. The owner files the report (NCMEC CyberTipline or the applicable authority) from an ESP account registered to the owner. This step cannot be automated from the code.
3. Only after the report is filed and retention requirements are met, remove the model with `npm run forge:takedown -- <id> --prod-env --apply --reason harmful --resolution "..." --evidence-released "<report reference>"`. The release reference is appended to the removal record.

## What a takedown removes

`npm run forge:takedown` with no `--apply` prints everything it will touch first. With `--apply` it removes:

- the creation record and its stored GLB, preview, source images and the whole `forge/<id>/` prefix
- the display thumbnail (`forge/thumb/<id>.webp` and `.png`) and the game-ready exports, which live outside the model prefix (`forge/gameready/<hash of the mesh URL>/`, derived from every URL spelling the model has)
- every resized variant of those (`variants/...`)
- avatar copies saved from the model (`/api/avatars/from-forge`, found by `source_meta.source_glb_url`), including their stored files
- the Sketchfab listing, when the model was uploaded there
- the CDN cache for the model page, share page, social preview card, the gallery and explore feeds, and every `/cdn/` and `/cdn/_v/` key

A remix made from the model is listed but not removed: it is another maker's creation and needs its own request. Anything that could not be removed is printed as `COULD NOT REMOVE` and the script exits 1, so a half-finished takedown is never read as done. If object storage is down the keys go to the `forge_storage_purges` queue and are retried. The CSAM evidence hold above applies unchanged.

## Configuration

No new env vars. The text signal uses the existing publish-safety config (`NVIDIA_API_KEY`, `PUBLISH_SAFETY_*`). The image signal uses the vision chain. If neither answers, models stay pending then held; they are never published unscreened.

## Rollout

Apply migration `20261120140000` before the new code serves traffic. Read `npm run db:status` first; `npm run db:migrate` applies immediately. The new cron needs a Cloud Scheduler sync after deploy (`scripts/create-gcp-scheduler.mjs`).

## Tests

`tests/content-safety.test.js` (pure combiner and parsers) and `tests/content-safety-db.test.js` (gate, sweep, admin queue and report auto-hide against the real schema on PGlite). `tests/api/forge-safety-coverage.test.js` covers the publish gate with the provider down, refusal copy, the removal-request handler, repeat abuse, every surface that must honour visibility (Sketchfab showcase, social preview) and the takedown reach (stored copies, derived items, cache paths).
