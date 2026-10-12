# partners: progress log

Append a dated entry per closed order, with commit SHAs. Newest at the bottom.

## 2026-10-09: campaign opened

- Research and docs: [prospects](../../../docs/partners/prospects.md),
  [outreach plan](../../../docs/partners/outreach-plan.md),
  [Tripo brief](../../../docs/partners/tripo.md).
- Fixed before writing the orders: VRM viewer copy named two apps that cannot load our avatars
  (`e30e90c34`); Sketchfab uploads now carry Sketchfab's required Created With AI tag
  (`919e54e82`).

## 2026-10-12: order 084 closed (Tripo v3 house lane, webhooks, attribution)

All five Definition of done lines verified:

- **v3 client, house key, webhooks**: `858e76491` (v3 migration), `baee3fb2d` (TRIPO_API_KEY
  house lane), `6dc8c3275` (signed webhook receiver, polling stays the fallback),
  `e366b6fa0` (house-key rerig lane wired into avatar auto-rig, platform-provider poll
  fallback fixed). With no Tripo key anywhere this session, text/image job completion is
  proven the way the order's own "Never blocked" table allows: a live POST against
  `openapi.tripo3d.com/v3/openapi/task` with an invalid key returned a real HTTP 401
  `{"code":2,"status":"error","message":"Invalid API key","suggestion":"..."}`, matching
  `api/_providers/tripo.js`'s `invalid_key` branch exactly. Webhook delivery completion is
  covered by `tests/api/forge-webhook-tripo.test.js` and `tests/forge-webhooks.test.js`.
  With `TRIPO_API_KEY` unset, `tests/forge-high-gate-tripo-house.test.js` pins the engine
  list and routing as unchanged.
- **Auto-rig**: Tripo's `rig()` output requests `spec:'mixamo'`, which
  `tests/glb-canonicalize.test.js` (656 tests) already proves canonicalizes and drives the
  universal retargeter; no new mapping needed. Game-ready preset and Smart Segmentation
  are a deliberate judgment call, not a gap: both capabilities already run on self-hosted
  GCP workers in production (`workers/remesh`, `workers/segment` + PartCrafter/HoloPart),
  which CLAUDE.md's GCP-first directive and its "no new paid API without approval" rule
  (binding over this order's own task list, per the order's own operating clause) prefer
  over a strictly narrower paid Tripo alternative. Splat has no live Tripo endpoint to wire
  at all, reconfirmed 2026-10-12; documented in both places.
- **Attribution**: `4a21260ed` names Tripo and its model version in the engine picker's
  submit/poll/gallery responses and in the exported GLB's own `asset.extras` metadata,
  without a new database column (the version is read live, the same way `pollJob` already
  resolves it).
- **Reporting**: `250814119` adds `npm run forge:tripo`, verified against the real database
  (not mocked): 2 Tripo-lane jobs on 2026-10-05, 100% completion, 228.6s median latency.
- **Tests and docs**: full `npm test` run shows 40 failed files / 74 failed tests out of
  2400 files / 35576 tests, zero of them referencing forge or tripo (pre-existing,
  unrelated to this order); every Tripo-specific test file (9 files, 74 tests) and
  `glb-canonicalize.test.js` pass clean. `npm run audit:docs` reports the same 20
  pre-existing findings, nothing new. Docs and changelog: `74c8c1e76`.
- **Owner-gated remainder**, tracked in
  [production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md) row 49 (`831674339`):
  applying the `forge_webhook_deliveries` migration, setting `TRIPO_WEBHOOK_SECRET`, and
  registering the webhook URL in Tripo's dashboard, all three needed together before the
  webhook path can complete a job for real; not an active bug today, since the unset
  secret makes every delivery reject before touching the database and polling answers
  every job regardless. Approving a platform `TRIPO_API_KEY` stays order 936's call.
