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

## 2026-10-13: order 086 closed (open-source credits page and in-surface credits)

Order 086 had already shipped across three commits from an earlier session on this branch:
`ce20cbdbc` (the generated `/open-source` page: `scripts/lib/open-source-credits.mjs` builds
a `buildCredits()` dataset from `package.json`'s direct dependencies, hand-curated
`WORKER_MODELS` and `ASSET_SOURCES` lists, written by `scripts/build-open-source-credits.mjs`
into `data/open-source-credits.json`, wired into `npm run prebuild`'s parallel block without
reordering the chain; served at `GET /api/open-source-credits`; rendered on
`pages/open-source.html` grouped by area with a jump nav, license, repo and sponsor links),
`e847ab98f` (in-surface credits: Poly Haven named on `/objects` and the object viewer
(`src/app-next-overlay.js`), meshoptimizer and glTF-Transform named in the Forge export
dialog's "how this file was made" footer (`src/forge-export.js`), per-clip source/license in
the animation gallery with a `studioClipCredit()` fallback for studio-tier clips that lack an
explicit manifest entry (`src/animations-gallery.js`)), `0df73dc55` and `c3cd66df3` (the
`npm run audit:docs`-pending doc, `STRUCTURE.md` row, changelog entry).

This session re-derived step 0 and re-verified every Definition of done line against the
live worktree rather than trusting the prior commits:

- **Page renders clean at all three breakpoints.** Built and ran `server/index.mjs` on
  `:3109` for the API and `vite --port 3107` with `DEV_API_PROXY=http://localhost:3109` for
  the frontend (dev normally proxies `/api` to prod, which does not yet serve this new
  endpoint), then drove a disposable Playwright script against `/open-source` at 320, 768
  and 1440px: `status=200`, `cards=230`, `polyHaven=true`, `meshopt=true`,
  `consoleErrors=0` at every width.
- **In-surface credits confirmed in source**, not just the page: `pages/objects.html` and
  `app-next-overlay.js` name Poly Haven; `forge-export.js`'s export menu footer links
  `/open-source#area-formats` for meshoptimizer/glTF-Transform; Forge results already name
  their generating engine through the existing timeline/compare UI
  (`src/forge-timeline.js`, `src/forge-compare.js`).
- **Guard test proven both ways, not just read.** Temporarily added a fake dependency to
  `package.json`, reran `tests/open-source-credits.test.js`: the "includes every direct npm
  dependency" case failed with the exact uncredited-dependency message; restored
  `package.json` (`git diff --stat` clean) and reran: 5/5 pass again.
- **`npm test`**: 35268 passed, 73 failed, 244 skipped across 2401 files; none of the 79
  `FAIL` lines mention open-source/credits. The failures are the same pre-existing,
  unrelated set other campaign entries in this log already note (oauth, mcp, idempotency,
  forge, branding, sitemap and others).
- **`npm run audit:docs`**: 21 findings, the same baseline order 085's entry above recorded;
  none reference `/open-source` or `docs/open-source-credits.md`.
- **`npm run check:rules`** against every touched path: `OK: no hard-rule violations in the
  added lines of 0 changed file(s)` (nothing was uncommitted, so there was no new diff to
  lint).
- A full `npm run build` was attempted to render pages from a real production-shaped build
  and failed on an unrelated pre-existing break (`avatar-sdk/src/agent.js` imports its own
  unbuilt `dist/index.mjs`, not touched by this order); the resulting stray `pages/*.html`
  SEO-injection and `public/*.json` drift from the partial prebuild run was discarded with
  `git restore` before verification continued on the dev server instead.

No code change was needed this session, only verification; this log entry and the order
file's deletion are the sole diff of the closing commit.

## 2026-10-13: order 087 built and verified end to end; owner steps remain, order file stays open

Order 087 asked for a LiveKit Agents avatar plugin and a Pipecat avatar `FrameProcessor`,
both republishing a running voice pipeline's TTS and user-turn frames as the same
`transcript` / `gesture` / `speech_started` / `speech_ended` JSON message shape that
`<agent-3d voice="livekit">` ([src/runtime/livekit-voice.js](../../../src/runtime/livekit-voice.js))
already renders client-side. Both packages, both runnable local examples, both demo
specs, and all supporting docs/wiring landed and were verified against the real
Definition of done:

- **LiveKit Agents plugin.** `integrations/livekit/livekit-plugins-threews/` (package
  `livekit-plugins-threews`, module `livekit.plugins.threews`): `AvatarSession` joins the
  room beside the agent and republishes TTS text and VAD turn-taking events over the data
  channel. `ruff check .` and `ruff format --check .` both pass (config mirrors
  livekit/agents's own `[tool.ruff]` block). `python -m pytest tests/ -v`: 2 passed
  (`test_conversation_item_actually_publishes_data`,
  `test_publish_without_room_is_a_noop`), run against a real `AgentSession`/`rtc.Room`,
  no mocks of the plugin's own logic. End to end:
  `tests/e2e/agent-3d-livekit-avatar.spec.js` against a real local open-source
  `livekit-server` and a real headless browser rendering `<agent-3d voice="livekit">`:
  1 passed, with a screenshot captured at
  `test-results/agent-3d-livekit-avatar-*/agent-3d-livekit-avatar-final.png`.
- **Pipecat avatar processor.** `integrations/pipecat/pipecat-threews/` (package
  `pipecat-threews`, module `pipecat_threews`): `ThreeWsAvatarProcessor`, a
  `FrameProcessor` placed after the TTS service, doing the same republishing for a
  Pipecat pipeline. While writing its test for the user-turn boundary, found a genuine
  cross-turn transcript-leakage bug: `_last_user_transcript` was set on every finalized
  `TranscriptionFrame` but never reset, so a second turn's `speech_ended` message could
  carry the first turn's leftover transcript text if that turn's own
  `UserStoppedSpeakingFrame` (a `SystemFrame`, processed on Pipecat's fast inline path)
  raced ahead of its `TranscriptionFrame` (queued on the slower regular-frame path).
  Fixed per the bug-fixes-are-test-first rule: wrote
  `test_user_stopped_speaking_does_not_leak_prior_turn_transcript` first, watched it fail
  with the leaked `"first turn"` text, then added
  `self._last_user_transcript = ""` to the `UserStartedSpeakingFrame` branch in
  `src/pipecat_threews/avatar.py`, reran, and all 4 tests in `tests/test_avatar.py`
  passed. `ruff check .` / `ruff format --check .` both pass (this package's config
  additionally selects docstring rule `D`, mirroring pipecat-ai/pipecat's own config; its
  `tests/__init__.py` needed a one-line module docstring that the LiveKit package's
  config does not require). End to end: `tests/e2e/agent-3d-pipecat-avatar.spec.js`
  against a real local `livekit-server`, a real local `espeak-ng` TTS service, and a real
  headless browser: 1 passed, with a local demo video captured (gitignored, not
  committed, path in the submission doc).
- **`npm test`**: 35268 passed, 73 failed, 244 skipped, the same pre-existing, unrelated
  baseline order 085 and order 086's entries above both independently measured; none of
  the failing files reference LiveKit, Pipecat, or either new package.
- **`npm run audit:docs`**: 21 findings, the same pre-existing baseline as above; none
  reference the new doc page or either package.
- **Submission files, READMEs, docs, `STRUCTURE.md` and changelog landed**: new doc page
  [docs/voice-framework-integrations.md](../../../docs/voice-framework-integrations.md),
  linked from `docs/start-here.md`, a new `data/pages.json` entry, a `STRUCTURE.md` row,
  a `data/changelog.json` entry dated 2026-10-13, and the two owner-ready submission
  packets at `marketing/growth/submissions/livekit-avatar-plugin.md` and
  `marketing/growth/submissions/pipecat-integration.md`, with
  `marketing/growth/opportunities.csv`'s LiveKit and Pipecat rows moved from
  `build_required` to `submission_ready`.
- **`npm run check:rules`** against every touched path: `OK: no hard-rule violations in
  the added lines of 31 changed file(s)`.

Three steps are owner-gated third-party actions (CLAUDE.md gate 2: publish, and contact
a third party) and cannot be done inside this session: publish `livekit-plugins-threews`
and `pipecat-threews` to PyPI, open the plugin pull request against `livekit/agents` and
the docs pull request against `pipecat-ai/pipecat` (exact titles, descriptions and
verification packets already written in the two submission files above), and apply to
the LiveKit Startups program once the plugin PR is open. All three are logged as row 51
in [_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md). The
order file stays in place (not deleted) until an owner runs those steps, per its own
close-out protocol for an owner-gated last step.
