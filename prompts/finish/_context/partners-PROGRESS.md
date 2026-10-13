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

## 2026-10-13: order 085 built and verified, not yet retired (owner action pending)

Order 085 (move the public animation library off Mixamo clips) is fully built, tested and
documented across four commits: `130ec84ca` (the CC0 fetch/enumerate/build/upload pipeline,
`scripts/cc0-animation-library.mjs`, plus the `canonicalizeBoneName` retarget fallback and
`source`/`license` passthrough in `scripts/build-animations.mjs`), `7867eab23` (the
`isPublishable()` defensive filter in `api/animations/library.js`, `scripts/mixamo-all.mjs`'s
upload phase permanently disabled, per-clip credit in the `/animations` gallery), `0a6e20cfd`
(the Licensing section in `docs/animations.md`, `animation-sources/README.md` rewritten,
`docs/ALL.md` regenerated), `482f33992` (the never-send Adobe permission draft at
`marketing/growth/submissions/adobe-mixamo-permission.md`, the changelog entry).

- **CC0 replacement set**: 219 clips enumerated from Quaternius's Universal Animation
  Library 2 and Mesh2Motion's human base/addon/mocap packs (both verified CC0 1.0
  Universal from their own LICENSE files), retargeted via the existing pipeline with 0
  failures, covering all 16 gallery categories, so no text-to-motion gap-filling was
  needed. `scripts/gcp/seed-motion.mjs`'s generated clips also now carry a `license` field.
- **Provenance on every entry**: `scripts/cc0-library.config.json` (committed, 219 entries)
  and the staged manifest both carry `source`/`license` per clip; the gallery renders them
  next to the category chip.
- **Public endpoints serve only what we may redistribute**: `isPublishable()` drops any
  manifest entry with no `license` or whose `source` names Mixamo, verified by 3 new tests
  in `tests/animations-library-endpoint.test.js` (21/21 passing). No Mixamo object was
  deleted (unrecoverable-data gate); the policy is unpublishing from the manifest, not
  deletion. Live production endpoint checked at draft time: `total: 0` (never populated, so
  trivially nothing Mixamo-derived is served today either).
- **Permission letter**: drafted, never sent, at
  `marketing/growth/submissions/adobe-mixamo-permission.md`; sending is owner order 938.
- **Docs**: Licensing section added to `docs/animations.md`; `animation-sources/README.md`
  updated; changelog entry landed; `npm run audit:docs` shows the same 21 pre-existing
  findings, nothing new.
- **Tests**: every animation/library/gallery-specific suite passes clean (21 + 158 + 662
  across the endpoint, retarget, categories, canonicalize and parametric suites). Full
  `npm test` has pre-existing, unrelated failures (oauth, mcp, grok, forge, branding,
  sitemap and others) not touched by this order.
- **Owner-gated remainder**, tracked in
  [production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md) row 50: running
  `node scripts/cc0-animation-library.mjs --upload` against production R2 to actually
  populate the live (currently empty) endpoint. This is a production-publish action under
  CLAUDE.md's gate 2, so the order file stays on disk with a dated Evolve status paragraph
  instead of being retired; retire it once the owner runs that command.

Re-run 2026-10-13: re-verified against the live state (`GET /api/animations/library?facets=1`
still `total: 0`, `scripts/mixamo-all.mjs`'s upload phase still disabled, 21/21
`tests/animations-library-endpoint.test.js` still passing, `audit:docs` still 21 pre-existing
findings), nothing had drifted. Found and fixed one stale doc comment:
`api/animations/library.js`'s top-of-file header still described the library as
"Mixamo-sourced motion library...baked by scripts/mixamo-all.mjs" from before the CC0
rebuild, which could mislead a future reader into thinking Mixamo redistribution was still
live (`39b98edfb`). Owner-action row 50 and the permission-letter draft are unchanged; still
waiting on the owner to run the upload command.
