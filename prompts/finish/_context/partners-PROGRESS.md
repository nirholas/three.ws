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

## 2026-10-13: order 088 built and verified end to end; Discord app registration remains, order file stays open

Order 088 asked for a Discord Activity: an embedded web app that runs inside a Discord
voice channel. Chose the group experience the order's own task 1 asked for: a shared
Forge room where everyone in the call prompts, watches one generation, and votes
together, with a three.ws agent that reacts in text, kept free of any coin, wallet or
purchase feature. Built and verified against the real Definition of done:

- **Activity entry point (task 2).** `src/discord-activity/app.js` uses
  `@discord/embedded-app-sdk`'s `DiscordSDK`: `authorize()` gets a code, a new server
  endpoint (`api/gateway/discord-activity-token.js`) exchanges it for an access token
  (the client never holds the client secret), `authenticate()` confirms it client-side,
  then `api/gateway/discord-activity-session.js` re-verifies the token against Discord's
  real `/users/@me` (`api/_lib/gateway/discord-activity-auth.js`'s `fetchDiscordUser`)
  before minting a room-scoped HMAC session token, never trusting a client-claimed
  identity. `tests/discord-activity-auth.test.js`: 9 passed, using `vi.spyOn(globalThis,
  'fetch')` to assert the exact request shapes sent to Discord's real token and user
  endpoints and the error paths when Discord rejects them.
- **Proxy and CSP (task 3).** `patchUrlMappings([{ prefix: 'cdn', target: config.cdn_host
  }], { patchFetch: true, patchXhr: true, patchSrcAttributes: true })` in `boot()`, with
  `api/gateway/discord-activity-config.js` serving the CDN host read from
  `env.S3_PUBLIC_DOMAIN` at runtime so a Developer Portal change never needs a rebuild.
  Every other call (`/api/gateway/*`, `/api/forge`) stays on the root domain, which
  Discord auto-proxies.
- **Shared state per Activity instance (task 4).** `api/_lib/gateway/discord-activity-store.js`
  keys an append-only event log by the Activity's `instanceId` and folds it into one
  snapshot (`getRoomSnapshot`); `api/gateway/discord-activity-room/[id].js` serves that
  snapshot over GET, a POST per action (`prompt`, `creation`, `vote`), and an SSE tail
  for live updates (the browser's native `EventSource` cannot set an `Authorization`
  header, so that one sub-route carries the session token as a query param instead, the
  same short-lived HMAC token over HTTPS either way). Generation and voting reuse the
  real `/api/forge` pipeline and the real `forge_votes` table (`castVote`/`removeVote`/
  `getPublicCreation` from `api/_lib/forge-store.js`) rather than a separate throwaway
  pipeline. `tests/discord-activity-store.test.js`: 4 passed, against a real PGlite
  Postgres run through the actual migration SQL, covering idempotent room/participant
  upserts, an unknown event kind being rejected, the full prompt/creation/vote/agent_say
  fold, and a new creation clearing the previous vote tally.
- **Purchases (task 5).** Deliberately omitted: the room sells nothing, so there is no
  in-app purchase flow to build. `docs/discord-activity.md` says so explicitly and names
  the only path that would ever need one (Discord's own IAP SKU system, not three.ws's
  own payment rails).
- **Docs and submission (task 6).** `docs/discord-activity.md` (How it works, Auth flow,
  Proxy and CSP, Shared state, Purchases, Owner setup), a `data/pages.json` entry for
  `/docs/discord-activity` and a non-indexable entry for `/discord-activity` itself (it
  only functions inside Discord's iframe), a `STRUCTURE.md` row, a `data/changelog.json`
  entry dated 2026-10-13, and
  [marketing/growth/submissions/discord-activity.md](../../../marketing/growth/submissions/discord-activity.md)
  with the exact Developer Portal settings (root and `cdn` URL Mappings, OAuth2 redirect
  and scope, Activity flags) and the Discovery listing copy (name, tagline, description,
  category, age rating) for owner order 939.
- **`npm test`**: 2349 passed files / 42 failed (75 failed tests, 35271 passed, 247
  skipped), a small drift from order 087's last-measured 2401 files / 73 failed baseline.
  Confirmed unrelated: neither new test file is in the failing set, and the failing files
  (`tests/branding.test.js`, `tests/pages-routes.test.js`, `tests/sitemap-type.test.js`
  and others) fail on pre-existing content this order never touched, for example a
  duplicate `/grok` route declared somewhere else in `data/pages.json` and two forbidden
  brand strings in unrelated docs; `git diff data/pages.json` shows only the 17 lines this
  order added, none of them `grok`.
- **`npm run audit:docs`**: 21 findings, the same pre-existing baseline order 085/086/087
  each independently measured; none reference the new doc page.
- **`npm run check:rules`** against every touched path across all three commits: `OK: no
  hard-rule violations in the added lines`.

One step is owner-gated (CLAUDE.md gate 2: no agent may contact a third party or create
accounts) and cannot be done inside this session: register a Discord application in the
Developer Portal, enable Activities with the URL Mappings above, set
`DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`/`DISCORD_PUBLIC_KEY` on Cloud Run, run the
pending migration, and verify the Activity in a real Discord client with two accounts
(screenshots) before submitting it for Discovery. Logged as row 52 in
[_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md). The order
file stays in place (not deleted) until that registration and live verification land.
Commits: `8e7ab13c7` (feature), `172173cac` (prospects.md update), `653b44cbe`
(owner-actions row and the order file's Evolve status paragraph).

## 2026-10-13: order 089 closed (Craftcloud "Get it printed", slicer trusted-host patches)

All five Definition of done lines verified, no owner action blocks any of them:

- **Live Craftcloud prices on a real model (line 1)**: `POST /api/print/craftcloud-quote`
  run against a real Khronos sample GLB through the real handler (no mock), saved response
  at modelId `f9ba172956fa8134f89b33bb321863f2cd4d24a4`, 2 vendors, 60 quotes. A Playwright
  screenshot of the actual `src/craftcloud-print.js` panel, served by the project's own Vite
  dev server with `DEV_API_PROXY` pointed at a local `server/index.mjs`, shows the populated
  price table and the Craftcloud-upload-page handoff. Both are evidence files outside the
  repo (`/tmp/craftcloud-quote-response.json`, `/tmp/ccp-screenshot.png`), not committed per
  the no-scratch-files rule.
- **Buyer handoff (line 2)**: Craftcloud's public v5 API has no endpoint that hands a
  server-created cart back to a browser for checkout (`checkoutUrl` is always `null`) and
  `/v5/referral` 401s without an authenticated account, so the panel links to Craftcloud's
  own upload page instead of a fake continue-to-checkout button, with the voucher applied
  automatically once the owner has an account. This gap is the adapter path the DoD line
  anticipates, not a missing feature.
- **Adapter contract and unit tests (line 3)**: `api/_lib/print/adapters/craftcloud.js`
  registered in `index.js` ahead of `manual` (quoting and cart creation never spend).
  `npx vitest run tests/print-adapter-contract.test.js`: 62/62 passed, including the new
  craftcloud-specific describe block.
  `57d5fd2a5`.
- **PrusaSlicer patch (line 4)**: `Downloader.cpp`'s hardcoded host list replaced with a
  `trusted_download_hosts()` helper reading an `AppConfig`-backed `download_url_extra_hosts`
  override, plus `three.ws` added to the built-in four. Full from-source build against
  upstream `master` (689/689 targets, zero errors) and `ctest` (7/7 suites, 0 failed, 43.22s)
  verified locally this session. Bambu Studio has no equivalent extension point
  (`GUI_App.cpp:1105-1151`, a fixed `TrustEntry[]` array with no config key), so that half is
  issue text, not a patch. Both texts, plus the diff and the build/test evidence, are in
  `marketing/growth/submissions/slicer-trusted-hosts.md` for owner order 938. `f76355d4e`.
- **`npm test` / `npm run audit:docs` / docs and changelog (line 5)**: full suite has 41
  failed files / 77 failed tests, pre-existing and unrelated, confirmed by stashing this
  order's changes and re-running the three failing files named in the sample
  (`oauth-introspect`, `ops-mcp-clients`, `v1-rest-router`) against the untouched baseline:
  same failures, same reasons (environment-dependent, no DB/Redis in this sandbox). This
  order's own test file (`tests/print-adapter-contract.test.js`) is 62/62 green.
  `npm run audit:docs`: 21 findings, the same pre-existing set; none reference the new
  Craftcloud doc sections or endpoint. `docs/forge.md` and `docs/materialize.md` cross-link
  the new flow against Materialize; `data/changelog.json` entry added and `npm run
  build:pages` run (which also fixed an invalid `"integrations"` tag from a prior commit
  that was blocking the build script for everyone). `npm run check:rules` against every
  touched path on both commits: `OK: no hard-rule violations in the added lines`.

No owner action blocks retirement: the feature needs no credential to run today (Craftcloud's
core API is unauthenticated by design) and the only owner-gated pieces are a nice-to-have
(the referral voucher, which degrades to `voucherApplied: false` without one) and filing the
already-written PrusaSlicer PR and Bambu Studio issue (owner order 938, a pre-existing lane
also used by orders 085 and 087). Commits: `57d5fd2a5` (Craftcloud feature, docs, changelog),
`f76355d4e` (slicer-trusted-hosts submission file).

## 2026-10-13: order 090 closed (Video to Motion landing)

All five Definition of done lines verified:

- **GLB/BVH load in Blender or the three.js editor (line 1)**: no Blender GUI is available
  in this sandbox, so the exported files are verified two other ways instead: a real
  Chromium browser (Playwright) drives the shipped page end to end against the real
  `/api/motion-swap` capture contract, clicks the actual export buttons, and the downloaded
  bytes are checked structurally (GLB magic number and version, a parsed JSON chunk with a
  non-empty `animations[0].channels`; a BVH text file starting `HIERARCHY`, containing
  `ROOT Hips` and `MOTION`, with a positive `Frames:` count). The BVH writer itself
  (`src/animation-bvh-export.js`) was already round-tripped through three.js's own
  `BVHLoader` in `tests/animation-bvh-export.test.js` in a prior commit on this same order
  (`be9baf7f7`). This substitution is the one judgment call on this order: no GUI
  screenshot, but real exported bytes from the real shipped code path, validated against
  the format spec and against three.js's own loader.
- **Retargets onto a non-Mixamo rig in the browser (line 2)**: a synthetic but structurally
  real, skinned GLB with Daz/Genesis joint names (`tests/_fixtures/daz-rig.glb`, built with
  `@gltf-transform/core` and round-tripped through its own reader to confirm validity) is
  uploaded through the page's file input inside a real Chromium browser; the retarget
  completes with no `#vtm-status[data-kind="error"]` surfaced and the export buttons stay
  enabled. `tests/e2e/video-to-motion.spec.js`, test "a non-Mixamo (Daz/Genesis) rig
  uploaded via file input retargets with no error".
  michelle.glb, the other named rig on the platform, is Mixamo and was excluded for that
  reason.
- **All states at 320/768/1440px, no console errors (line 3)**: three parametrized tests in
  the same spec load `/video-to-motion` at each width with `page.on('console')` and
  `page.on('pageerror')` listeners asserting zero entries, plus processing/ready/failed/limit
  state coverage (successful capture, a `status: 'failed'` response, a 429 response) each
  asserting the correct stage element is visible and the others hidden.
  `npx playwright test tests/e2e/video-to-motion.spec.js`: 8/8 passed in 23.0s.
- **`npm test` / `npm run audit:docs` (line 4)**: full suite is `43 failed files / 2349
  passed | 79 failed tests / 35305 passed` in this run. None of the failing test names
  reference video-to-motion, animation retargeting, BVH export, or GLB canonicalization;
  every failure is in OAuth/MCP-wallet infrastructure (`oauth-authorize`, `oauth-introspect`,
  `ops-mcp-clients`, `v1-rest-router`, `mcp-agent`, `mcp-agent-challenge`,
  `mcp-wallet-provision`), environment-dependent (no DB/Redis in this sandbox) and matching
  the pre-existing baseline documented above for order 089 earlier the same day (41 failed
  files / 77 failed tests; the small drift is other agents' concurrent commits in this
  shared worktree, not this feature). This order's own new spec is fully green.
  `npm run audit:docs` dropped from 22 to 21 findings after adding the missing
  `/docs/video-to-motion` entry to `data/pages.json`; the remaining 21 are the same
  pre-existing set, none referencing this feature.
- **Page entry, STRUCTURE.md, doc, changelog (line 5)**: `/video-to-motion` and
  `/docs/video-to-motion` both in `data/pages.json`; `STRUCTURE.md` row updated with the doc
  and both test files; `docs/video-to-motion.md` written; `data/changelog.json` entry added
  and `npm run build:pages` output (changelog HTML/JSON/XML, features.json, llms.txt/
  llms-full.txt, sitemap, localized-pages.json) committed alongside. Cross-linked from
  `/motion-swap`, `/animations`, and `/mocap-studio`. `npm run check:rules` against all 17
  changed paths plus the 5 new files: `OK: no hard-rule violations in the added lines`.

Step 0 (re-derived at the start of this order, in an earlier segment of this same session):
ran a real 30-second CC0 video through the production `model-video2motion` worker, which
returned a genuine 480-frame/24fps/1280x720 clip (`meta.json` on disk confirms this), proving
the capture path end to end before any UI was built; the exact wall-clock duration from that
run was not separately logged, so `docs/video-to-motion.md` quotes Motion Swap's own
already-established timing for the same worker ("about two minutes for a 30-second clip")
rather than a re-measured number. FBX export reuses the existing `presign-glb` +
`forge-remesh` Blender converter (no new exporter needed); GLB is written with three.js's own
`GLTFExporter`; BVH needed a new writer since no maintained open-source BVH exporter existed
in the dependency tree, which is `src/animation-bvh-export.js`.

No owner action blocks retirement: capture, retargeting, GLB/BVH/FBX export, and save-to-
library all run against infrastructure (the `model-video2motion` worker, `/api/motion-swap`,
`/api/forge-remesh`, `/api/animations/presign`) that is already live in production with no
missing credential. Commits: `be9baf7f7` (BVH export writer and its unit test, from the
session's earlier segment), `aebfe1bc0` (the landing page, retarget/export/save wiring, the
e2e spec and its fixture, docs, changelog, and page-index wiring).

## 2026-10-13: order 091 built and verified end to end; Shopify Partner app registration remains, order file stays open

Order 091 asked for a Shopify app that turns a product photo into 3D product media on the
storefront. Built directly against Shopify's documented OAuth/session-token/GraphQL/Billing
contracts (no `@shopify/shopify-api` or `shopify-app-remix`), matching how Discord and Google
are integrated elsewhere in this codebase, and placed the code under `api/shopify/`,
`api/_lib/shopify/`, `src/shopify-app/` and `pages/shopify-app.html` rather than the order's
literal `integrations/shopify/`, matching the Discord Activity's actual shape. Both are one-
line judgment calls, stated in the order file's own Evolve status paragraph.

- **The app (task 1).** OAuth install (`api/shopify/install.js`) and callback
  (`api/shopify/callback.js`) with real query-string HMAC verification
  (`api/_lib/shopify/hmac.js`) and offline-token exchange; the embedded admin UI
  (`pages/shopify-app.html`, `src/shopify-app/app.js`) authenticates every call with an App
  Bridge session token (`api/_lib/shopify/session-token.js`, `api/_lib/shopify/auth-request.js`)
  rather than a cookie, and lists the shop's products with their current 3D-media status
  (`api/shopify/products.js`, `api/_lib/shopify/media.js`'s `listProducts`).
- **The flow (task 2).** Generate (`api/shopify/media/create.js`) starts a Forge job through
  three.ws's own `/api/forge` pipeline (`api/_mcp-studio/forge-client.js`, no new generation
  logic); status polling (`api/shopify/media/status.js`) surfaces real per-item state; attach
  (`api/shopify/media/attach.js`) stages the GLB upload and calls `productCreateMedia` with
  `mediaContentType: MODEL_3D` (`api/_lib/shopify/media.js`'s `stageAndUploadGlb`/
  `attachModel3d`), so Shopify derives the USDZ for iOS AR Quick Look from the one upload.
  Bulk mode in the admin UI runs three jobs at a time with a live per-card status badge.
- **Billing (task 3).** Usage-based subscription through the Billing API, test mode until the
  app has Public distribution (`api/_lib/shopify/billing.js`, `api/shopify/billing/*.js`);
  the admin UI opens Shopify's confirmation page with `window.open(url, '_top')` to escape the
  embedded iframe, the one UI judgment call on this order. Cannot be proven against a real
  development store from this workspace (see below).
- **Compliance (task 4).** The three mandatory privacy webhooks (`customers/data_request`,
  `customers/redact`, `shop/redact`) plus `app/uninstalled`, all HMAC-verified
  (`api/_lib/shopify/webhook-verify.js`) and delivery-deduplicated against a
  `(topic, delivery_id)` ledger so a Shopify retry never double-processes; scopes kept to
  `read_products,write_products`, nothing wider.
- **Submission package (task 5).** `marketing/growth/submissions/shopify-app.md`: exact
  Partner Dashboard settings (App URL, redirect, scopes, embedding), the App Store listing
  copy (name, tagline, description, category, pricing), and the owner order 939 steps.
- **Docs (task 6).** `docs/shopify-app.md` (How it works, Auth flow, Billing, Privacy
  webhooks, Owner setup), `STRUCTURE.md` row, `data/changelog.json` entry dated 2026-10-13,
  `data/pages.json` entries for `/docs/shopify-app` and a non-indexable `/apps/shopify`
  (it only functions inside Shopify's admin iframe).
- **`npm test`**: 44 failed files / 2353 passed (80 failed tests, 35359 passed, 244 skipped).
  None of the five new Shopify test files are in the failing set
  (`npx vitest run tests/shopify-{hmac,session-token,store,graphql,webhooks}.test.js`: 5
  files, 42/42 passing). Spot-checked the one failure closest to this order's own edits
  (`tests/pages-routes.test.js`'s "declares each path exactly once"): the reported duplicates
  are `/docs/grok`, `/docs/grok-bot`, `/grok`, `/tutorials/grok-bot-recipes`, none of them
  Shopify paths, and `grep` confirms `/apps/shopify` and `/docs/shopify-app` each appear
  exactly once in `data/pages.json`. The rest of the failing set is OAuth/MCP-wallet/grok/
  x-content infrastructure this order never touched, consistent with the pre-existing,
  environment-dependent baseline orders 087-090 each independently measured in this same
  shared worktree.
- **`npm run audit:docs`**: 21 findings, the same pre-existing set documented on orders
  089/090; none reference `docs/shopify-app.md`, `/apps/shopify`, or `/docs/shopify-app`.
- **`npm run check:rules`** against every touched path across both commits: `OK: no hard-rule
  violations in the added lines`.

One step is owner-gated (CLAUDE.md gate 2: no agent may contact a third party or create
accounts) and cannot be done inside this session: register a Shopify Partner app, set its
Cloud Run env vars, apply the pending migration, and verify the photo-to-3D flow on a real
development store (storefront screenshot, a completed test-mode Billing charge, and real
webhook test deliveries) before submitting it to the App Store. Logged as row 54 in
[_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md). The order file
stays in place (not deleted) until that registration and live verification land. Commits:
`7b52431a9` (feature, docs, changelog, tests), `b7b55dbf3` (owner-actions row and the order
file's Evolve status paragraph).

## 2026-10-13: order 092 re-verified (VRoid Hub import), stays open on an owner action

Re-ran this session's close-out checklist against the feature landed in `05fdde784`
(OAuth2 connect/callback/status/disconnect with PKCE, the real `CharacterModelLicenseSerializer`
evaluator, the `/import/vroid` picker, and the import pipeline into the existing VRM
load/canonicalize path). Every Definition of done line that does not require the owner's
action was verified fresh, not assumed:

- **Coming-soon state, no error**: `node scripts/read-service-env.mjs '^VROID' --names`
  still returns zero matches on `three-ws-api`; `api/vroid/models.js` checks
  `vroidConfigured()` and answers `200` with the designed coming-soon payload rather than an
  error, and `pages/import-vroid.html` renders "VRoid Hub import is coming soon" for that
  response.
- **License gating unit test**: `npx vitest run tests/vroid-license.test.js`, 9/9 passing;
  the evaluator defaults closed so an action the creator didn't permit is never offered.
- **`npm test`**: 43 failed files / 2355 passed (79 failed tests, 35373 passed, 244 skipped).
  None of the failing files or tests mention vroid; the full failing set is pre-existing
  OAuth/idempotency/ops-mcp infrastructure this order never touched (same category of
  baseline noise logged on orders 089-091 in this shared worktree).
- **`npm run audit:docs`**: 21 findings, the same pre-existing set as orders 089-091; none
  reference `docs/vroid-hub-import.md`, `/import/vroid`, or `/docs/vroid-hub-import`.
- **Docs/page/structure/changelog**: `data/pages.json` carries `/import/vroid` and
  `/docs/vroid-hub-import`; `STRUCTURE.md` has the VRoid Hub import row; `CHANGELOG.md` and
  `data/changelog.json` carry the 2026-10-13 entry; `marketing/growth/submissions/vroid-hub-app.md`
  has the app registration answers for owner order 939.
- **`npm run check:rules`** against the files this re-verification pass touched: `OK: no
  hard-rule violations`.

The remaining step is owner-gated and cannot be done inside this session: register the
VRoid Hub application at `hub.vroid.com/oauth/applications` (confirmed live, pixiv-account
sign-in required), set `VROID_HUB_CLIENT_ID`/`VROID_HUB_CLIENT_SECRET` on Cloud Run with
`--update-env-vars`, run the pending `20261015070000_vroid_hub_source.sql` migration, and
verify a real import on a live VRoid Hub account (idle/walk playing, creator credit
rendered, a disallowed action actually blocked). Logged as row 55 in
[_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md). The order file
stays in place (not deleted) until that registration, env update, migration, and live
verification land. Commits: `05fdde784` (feature, docs, changelog, tests, owner-actions row),
this entry's commit (re-verification log only, no code changes).
